import { clamp, PPQ, type Track, type PerformanceEvent } from "../music/types";
import { MACRO_IDS, MOD_TARGETS, modulationIssues, type ModScope, type ModSource, type ModulationPatch } from "../music/modulation-types";

/** A shared control clock keeps seeks, stems and offline windows sample-identical. */
export const MODULATION_HZ = 128;
/** Two render quanta keep newly arrived controls ahead of the audio thread. */
export function effectiveControlTime(requested:number,current:number,sampleRate:number) {
  return Math.max(requested,current+256/sampleRate);
}
/** Use the same integer musical tick live that the v1 take will persist and replay. */
export function musicalControlTime(at:number,tempo:number,audioOrigin:number,songOrigin=0) {
  const tickSeconds=60/(tempo*PPQ);
  const tick=Math.ceil((at-audioOrigin+songOrigin)/tickSeconds-1e-8);
  return audioOrigin+tick*tickSeconds-songOrigin;
}
export interface ModControlEvent {
  seconds: number; type: string; value: number; macroId?: string; cc?: number; channel?: number;
}
export interface ModControlLane { id: string; points: { seconds: number; value: number }[] }
export interface ModVoice { key: string; pitch: number; velocity: number; start: number; release?: number }
export interface ModSample { sources: Record<string, number>; targets: Record<string, number>; sourceParameters?: Record<string,number> }

export function emptyPatch(seed = 0): ModulationPatch {
  return {version:1,enabled:true,sources:[],routes:[],macros:[0,0,0,0],macroNames:["Motion","Tone","Space","Pulse"],seed};
}
export function makeSource(kind: ModSource["kind"], id: string, scope: ModScope = "track"): ModSource {
  return {id,name:kind === "lfo" ? "LFO" : kind[0].toUpperCase()+kind.slice(1),kind,scope,enabled:true,
    rate:1,sync:true,division:4,shape:"sine",phase:0,amplitude:1,
    attack:.1,decay:.3,sustain:.6,release:.5,steps:[1,0,-1,0],curve:[-1,0,1,0,-1]};
}
export function sourceTargetDescriptor(source: ModSource, parameter: "rate" | "amplitude") {
  return {label:source.name+" "+parameter,scope:source.scope,min:parameter==="rate"?.01:0,
    max:parameter==="rate"?40:1,depth:parameter==="rate"?3:1,unit:parameter==="rate"?"oct":""};
}
export function applyModTarget(target: string, base: number, delta: number): number {
  const descriptor=MOD_TARGETS[target as keyof typeof MOD_TARGETS];
  if(!descriptor)return base;
  return clamp(descriptor.scale==="log"?base*Math.pow(2,delta):base+delta,descriptor.min,descriptor.max);
}
export function trackModulationBase(track: Track, target: string): number {
  const sound=track.sound;
  const bases:Record<string,number>={"track.cutoff":sound.cutoff,"track.resonance":sound.resonance,
    "track.gain":0,"track.pan":track.pan,"track.low":track.low,"track.mid":track.mid,"track.high":track.high,
    "track.reverb":track.reverb,"track.delay":track.delay,"voice.pitch":0,"voice.gain":0,
    "voice.cutoff":sound.cutoff,"voice.resonance":sound.resonance,"voice.fmRatio":sound.fmRatio,
    "voice.fmIndex":sound.fmIndex,"voice.attack":sound.attack,"voice.decay":sound.decay,
    "voice.sustain":sound.sustain,"voice.release":sound.release};
  return bases[target]??0;
}
export function changedMacroEvents(previous:Track[],next:Track[]):{trackId:string;event:PerformanceEvent}[] {
  return next.flatMap(track=>{
    const before=previous.find(t=>t.id===track.id)?.modulation,after=track.modulation;
    if(!before&&!after)return [];
    return MACRO_IDS.flatMap((macroId,index)=>!before||!after||before.macros[index]!==after.macros[index]?
      [{trackId:track.id,event:{tick:0,type:"macro" as const,macroId,value:after?.macros[index]??0}}]:[]);
  });
}

export interface CompiledModulation {
  patch: ModulationPatch; trackId: string; tempo: number; order: ModSource[];
  incoming: Map<string, ModulationPatch["routes"]>; events: Map<string, ModControlEvent[]>; lanes: Map<string, ModControlLane["points"]>;
}
export function controlEventId(event: ModControlEvent): string | undefined {
  if(event.type==="macro")return event.macroId;
  if(event.type==="controlChange"&&event.cc!==undefined)return `cc:${event.channel??0}:${event.cc}`;
  if(["expression","modulation","pressure","pitchBend","sustain"].includes(event.type))return event.type;
}
export function compileModulation(patch: ModulationPatch, trackId: string, tempo: number,
  events: ModControlEvent[] = [], lanes: ModControlLane[] = []): CompiledModulation {
  const issues=modulationIssues(patch);
  if(patch.sources.length>8||patch.routes.length>32)issues.push("The modulation matrix is too large.");
  if(issues.length)throw new Error(issues.join(" "));
  const incoming=new Map<string,ModulationPatch["routes"]>();
  for(const route of patch.routes.filter(r=>r.enabled)) {
    const key=route.target.startsWith("source:")?route.target.split(":")[1]:route.target;
    incoming.set(key,[...(incoming.get(key)??[]),route]);
  }
  const order:ModSource[]=[],visited=new Set<string>();
  const visit=(source:ModSource)=>{
    if(visited.has(source.id))return;visited.add(source.id);
    for(const route of incoming.get(source.id)??[]) {
      const prior=patch.sources.find(s=>s.id===route.sourceId);if(prior)visit(prior);
    }
    order.push(source);
  };
  [...patch.sources].sort((a,b)=>a.id.localeCompare(b.id)).forEach(visit);
  const grouped=new Map<string,ModControlEvent[]>();
  for(const event of [...events].sort((a,b)=>a.seconds-b.seconds)) {
    const key=controlEventId(event);if(!key)continue;
    const values=grouped.get(key)??[];values.push(event);grouped.set(key,values);
    if(event.type==="controlChange") {
      const all=`cc:all:${event.cc}`,allValues=grouped.get(all)??[];allValues.push(event);grouped.set(all,allValues);
    }
  }
  return {patch,trackId,tempo,order,incoming,events:grouped,
    lanes:new Map(lanes.map(l=>[l.id,[...l.points].sort((a,b)=>a.seconds-b.seconds)]))};
}

interface ModState { frame: number; phases: Record<string,number>; rates: Record<string,number>; slews: Record<string,number>; sample: ModSample }
interface ModRuntime { state: ModState; checkpoints: Map<number,ModState>; samples: Map<number,ModSample> }
const freshState=():ModState=>({frame:-1,phases:{},rates:{},slews:{},sample:{sources:{},targets:{}}});
const freshRuntime=():ModRuntime=>({state:freshState(),checkpoints:new Map(),samples:new Map()});
const copyState=(s:ModState):ModState=>({...s,phases:{...s.phases},rates:{...s.rates},slews:{...s.slews}});
function lastAt<T>(values:T[],seconds:number,time:(value:T)=>number):number {
  let low=0,high=values.length;
  while(low<high){const mid=(low+high)>>>1;if(time(values[mid])<=seconds+1e-10)low=mid+1;else high=mid;}
  return low-1;
}
function randomValue(seed:number,key:string,cycle:number):number {
  let h=(seed^2166136261)>>>0;
  for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),16777619);
  h=Math.imul(h^cycle,0x85ebca6b);h=Math.imul(h^(h>>>16),0xc2b2ae35);h^=h>>>16;
  return (h>>>0)/0xffffffff*2-1;
}
function sourceValue(source:ModSource,phase:number,elapsed:number,voice:ModVoice|undefined,seconds:number,key:string,seed:number):number {
  const cycle=Math.floor(phase),fraction=phase-cycle;
  if(source.kind==="lfo") {
    if(source.shape==="triangle")return 1-4*Math.abs(fraction-.5);
    if(source.shape==="saw")return fraction*2-1;
    if(source.shape==="square")return fraction<.5?1:-1;
    return Math.sin(phase*Math.PI*2);
  }
  if(source.kind==="random")return randomValue(seed,key,cycle);
  if(source.kind==="step")return source.steps.length?source.steps[Math.min(source.steps.length-1,Math.floor(fraction*source.steps.length))]:0;
  if(source.kind==="reference") {
    if(!source.curve.length)return 0;
    const position=fraction*(source.curve.length-1),index=Math.floor(position);
    return source.curve[index]+((source.curve[index+1]??source.curve[index])-source.curve[index])*(position-index);
  }
  const held=(age:number)=>age<0?0:age<source.attack?age/Math.max(.0001,source.attack):
    age<source.attack+source.decay?1+(source.sustain-1)*(age-source.attack)/Math.max(.0001,source.decay):source.sustain;
  if(voice?.release!==undefined&&seconds>=voice.release) {
    return held(voice.release-voice.start)*Math.max(0,1-(seconds-voice.release)/Math.max(.0001,source.release));
  }
  return held(elapsed);
}

export class ModulationEvaluator {
  private track=freshRuntime();
  private voices=new Map<string,{runtime:ModRuntime;voice:ModVoice}>();
  constructor(readonly compiled:CompiledModulation) {}
  /** A recorded lane has precedence over its controller events. */
  control(id:string,seconds:number):number {
    const lane=this.compiled.lanes.get(id);
    if(lane?.length) {
      const index=lastAt(lane,seconds,p=>p.seconds);
      if(index<0)return lane[0].value;
      const before=lane[index],after=lane[index+1];
      return after?before.value+(after.value-before.value)*clamp((seconds-before.seconds)/(after.seconds-before.seconds||1),0,1):before.value;
    }
    const events=this.compiled.events.get(id)??[],index=lastAt(events,seconds,e=>e.seconds);
    if(index>=0)return events[index].value;
    const macro=MACRO_IDS.indexOf(id as typeof MACRO_IDS[number]);
    return macro>=0?this.compiled.patch.macros[macro]:id==="expression"?1:0;
  }
  /** Live event insertion invalidates only future checkpoints, preserving canonical history. */
  addEvent(event:ModControlEvent) {
    const id=controlEventId(event);if(!id)return;
    for(const key of event.type==="controlChange"?[id,`cc:all:${event.cc}`]:[id]) {
      const list=this.compiled.events.get(key)??[];list.push(event);list.sort((a,b)=>a.seconds-b.seconds);this.compiled.events.set(key,list);
    }
    const invalidate=(runtime:ModRuntime,origin:number)=>{
      const frame=Math.floor((event.seconds-origin)*MODULATION_HZ);
      for(const f of runtime.checkpoints.keys())if(f>=frame)runtime.checkpoints.delete(f);
      for(const f of runtime.samples.keys())if(f>=frame)runtime.samples.delete(f);
      if(runtime.state.frame>=frame)runtime.state=freshState();
    };
    invalidate(this.track,0);for(const {runtime,voice}of this.voices.values())invalidate(runtime,voice.start);
  }
  forgetVoice(key:string){this.voices.delete(key);}
  sample(seconds:number,voice?:ModVoice):ModSample {
    if(!this.compiled.patch.enabled)return {sources:{},targets:{}};
    seconds=Math.max(0,seconds);
    if(!voice)return this.evaluate(this.track,seconds);
    let binding=this.voices.get(voice.key);
    if(!binding||binding.voice.start!==voice.start) {
      binding={runtime:freshRuntime(),voice:{...voice}};this.voices.set(voice.key,binding);
      // Active voices are explicitly forgotten by the graph; cap audition-only callers too.
      if(this.voices.size>256)this.voices.delete(this.voices.keys().next().value!);
    }
    if(binding.voice.release!==voice.release) {
      binding.voice={...voice};binding.runtime=freshRuntime();
    }
    const local=this.evaluate(binding.runtime,seconds,voice),shared=this.sample(seconds);
    return {sources:{...local.sources,...shared.sources,velocity:clamp(voice.velocity,0,1),key:clamp(voice.pitch/127,0,1)},
      targets:{...local.targets,...shared.targets},sourceParameters:{...local.sourceParameters,...shared.sourceParameters}};
  }
  private evaluate(runtime:ModRuntime,seconds:number,voice?:ModVoice):ModSample {
    const origin=voice?.start??0,frame=Math.max(0,Math.floor((seconds-origin)*MODULATION_HZ+1e-8));
    const cached=runtime.samples.get(frame);if(cached)return cached;
    if(runtime.state.frame>frame) {
      let prior:ModState|undefined;
      for(const [f,state]of runtime.checkpoints)if(f<=frame&&(!prior||f>prior.frame))prior=state;
      runtime.state=prior?copyState(prior):freshState();
    }
    while(runtime.state.frame<frame) {
      const state=runtime.state,at=origin+(state.frame+1)/MODULATION_HZ;
      const trackSample=voice?this.sample(at):undefined;
      const sources:Record<string,number>=trackSample?{...trackSample.sources}:{};
      const sourceParameters:Record<string,number>={...trackSample?.sourceParameters};
      for(const id of [...MACRO_IDS,"expression","modulation","pressure","pitchBend"])sources[id]=this.control(id,at);
      for(const id of this.compiled.events.keys())if(id.startsWith("cc:"))sources[id]=this.control(id,at);
      // Unused CCs still expose their default to routes.
      for(const route of this.compiled.patch.routes)if(route.sourceId.startsWith("cc:"))sources[route.sourceId]=this.control(route.sourceId,at);
      sources.velocity=voice?clamp(voice.velocity,0,1):0;sources.key=voice?clamp(voice.pitch/127,0,1):0;
      const routed=(route:ModulationPatch["routes"][number])=>{
        const value=sources[route.sourceId]??0,curved=route.curve==="exponential"?value*Math.abs(value):value;
        const raw=curved*route.amount;
        const previous=state.slews[route.id]??0;
        const result=route.slew>0?previous+(raw-previous)*(1-Math.exp(-1/(MODULATION_HZ*route.slew))):raw;
        state.slews[route.id]=result;return result;
      };
      for(const source of this.compiled.order) {
        if(source.scope==="track"&&voice)continue;
        if(source.scope==="voice"&&!voice)continue;
        if(!source.enabled){sources[source.id]=0;sourceParameters[`source:${source.id}:rate`]=0;sourceParameters[`source:${source.id}:amplitude`]=0;continue;}
        const oldPhase=state.phases[source.id]??source.phase;
        const phase=oldPhase+(state.frame>=0?(state.rates[source.id]??0)/MODULATION_HZ:0);
        let rateDelta=0,amplitudeDelta=0;
        for(const route of this.compiled.incoming.get(source.id)??[]) {
          const delta=routed(route);if(route.target.endsWith(":rate"))rateDelta+=delta;else amplitudeDelta+=delta;
        }
        const hz=source.sync?this.compiled.tempo/60/source.division:source.rate;
        state.rates[source.id]=clamp(hz*Math.pow(2,clamp(rateDelta,-3,3)),.01,40);
        const amplitude=clamp(source.amplitude+amplitudeDelta,0,1);
        sourceParameters[`source:${source.id}:rate`]=state.rates[source.id];sourceParameters[`source:${source.id}:amplitude`]=amplitude;
        state.phases[source.id]=phase;
        sources[source.id]=clamp(sourceValue(source,phase,at-origin,voice,at,
          `${this.compiled.trackId}:${source.id}:${source.scope==="voice"?voice!.key:"track"}`,this.compiled.patch.seed)
          *amplitude,-1,1);
      }
      const targets:Record<string,number>=trackSample?{...trackSample.targets}:{};
      for(const [target,routes]of this.compiled.incoming) {
        if(!target.includes("."))continue;
        const descriptor=MOD_TARGETS[target as keyof typeof MOD_TARGETS];
        if(!descriptor||descriptor.scope!== (voice?"voice":"track"))continue;
        targets[target]=routes.reduce((sum,r)=>sum+routed(r),0);
      }
      state.frame++;state.sample={sources,targets,sourceParameters};runtime.samples.set(state.frame,state.sample);
      if(state.frame%32===0)runtime.checkpoints.set(state.frame,copyState(state));
      if(runtime.samples.size>512)runtime.samples.delete(runtime.samples.keys().next().value!);
      if(runtime.checkpoints.size>512)runtime.checkpoints.delete(runtime.checkpoints.keys().next().value!);
    }
    return runtime.state.sample;
  }
}
