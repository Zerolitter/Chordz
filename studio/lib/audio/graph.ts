import {isDrumInstrument} from "./catalog";
import {
  clamp,
  type InstrumentManifest,
  type ProjectDocument,
  type SampleZone,
  type Track,
} from "../music/types";
import { randomGenerator } from "../music/generate";
import { tickToSeconds } from "../music/project";
import { automationValue, type ScheduledNote } from "./compile";
import { applyModTarget, compileModulation, ModulationEvaluator, MODULATION_HZ, type ModControlEvent, type ModVoice } from "./modulation";
import { MOD_TARGETS, type ModTarget } from "../music/modulation-types";

export interface Voice {
  start: number;
  end: number;
  trackId: string;
  pitch: number;
  bend: AudioParam[];
  baseBend: number[];
  gain: GainNode;
  sources: (AudioBufferSourceNode | OscillatorNode)[];
  release: (time: number) => void;
  cancel: (time: number) => void;
  updateSound?: (track: Track, time: number) => void;
  output?: GainNode;
  modulation?: { context: ModVoice; pitch: ConstantSourceNode; level: GainNode;
    filter?: BiquadFilterNode; fmMod?: OscillatorNode; fmAmount?: GainNode; sound: Track["sound"]; frequency: number; activeTargets: Set<string> };
  enableModulation?: () => void;
}
export interface TrackGraph {
  input: GainNode;
  volume: GainNode;
  expression: GainNode;
  pan: StereoPannerNode;
  filter: BiquadFilterNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  reverb: GainNode;
  delay: GainNode;
  drive: WaveShaperNode;
  analyser: AnalyserNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  nodes: AudioNode[];
  matrixGain?: GainNode;
}
export interface SongGraph {
  context: BaseAudioContext;
  tracks: Map<string, TrackGraph>;
  master: GainNode;
  output: GainNode;
  analyser: AnalyserNode;
  noise: AudioBuffer;
  nodes: AudioNode[];
  dispose: () => void;
  reverbState?: {input:GainNode;current:{convolver:ConvolverNode;level:GainNode};decay:number;seed:number;
    pending:{decay:number;seed:number}|null;timer:ReturnType<typeof setTimeout>|null;
    retired?:{convolver:ConvolverNode;level:GainNode};retireTimer:ReturnType<typeof setTimeout>|null;transitionUntil:number;disposed:boolean};
  modulation?: { project: ProjectDocument; audioOrigin: number; songOrigin: number;
    tracks: Map<string,{track:Track;evaluator:ModulationEvaluator;signature:string;activeTrackTargets:ReadonlySet<string>}> };
}
const dbGain = (db: number) => Math.pow(10, db / 20);
function reverbImpulse(context:BaseAudioContext,decay:number,seed:number) {
  const impulse=context.createBuffer(2,Math.ceil(context.sampleRate*decay),context.sampleRate),random=randomGenerator(seed+47);
  for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=(random()*2-1)*Math.pow(1-i/data.length,2.5)*.28;}
  return impulse;
}
/** Coalesce a drag into bounded parallel wet returns; the dry graph and voices stay connected. */
export function updateReverbDecay(graph:SongGraph,decay:number,seed:number) {
  const wet=graph.reverbState;if(!wet||wet.disposed)return;
  if(wet.decay===decay&&wet.seed===seed){wet.pending=null;return;}
  wet.pending={decay,seed};if(wet.timer)return;
  const retire=()=>{
    if(!wet.retired)return;
    if(graph.context.currentTime<wet.transitionUntil){wet.retireTimer=setTimeout(retire,Math.max(100,(wet.transitionUntil-graph.context.currentTime)*1000));return;}
    try{wet.input.disconnect(wet.retired.convolver);}catch{}
    wet.retired.convolver.disconnect();wet.retired.level.disconnect();
    const obsolete=new Set<AudioNode>([wet.retired.convolver,wet.retired.level]);
    graph.nodes.splice(0,graph.nodes.length,...graph.nodes.filter(node=>!obsolete.has(node)));
    wet.retired=undefined;wet.retireTimer=null;
  };
  const apply=()=>{
    wet.timer=null;if(wet.disposed||!wet.pending)return;
    const now=graph.context.currentTime;
    if(wet.retired&&now<wet.transitionUntil){wet.timer=setTimeout(apply,Math.max(5,(wet.transitionUntil-now)*1000));return;}
    if(wet.retireTimer){clearTimeout(wet.retireTimer);wet.retireTimer=null;}retire();
    const next=wet.pending;wet.pending=null;
    const convolver=graph.context.createConvolver(),level=graph.context.createGain();
    convolver.buffer=reverbImpulse(graph.context,next.decay,next.seed);level.gain.setValueAtTime(0,now);
    wet.input.connect(convolver);convolver.connect(level);level.connect(graph.master);
    wet.current.level.gain.cancelAndHoldAtTime(now);wet.current.level.gain.linearRampToValueAtTime(0,now+.1);
    level.gain.linearRampToValueAtTime(1,now+.1);
    wet.retired=wet.current;wet.current={convolver,level};wet.decay=next.decay;wet.seed=next.seed;wet.transitionUntil=now+.1;
    graph.nodes.push(convolver,level);wet.retireTimer=setTimeout(retire,110);
  };
  wet.timer=setTimeout(apply,100);
}
interface ModulationKnot { at: number; value: number }
const modulationCurves=new WeakMap<AudioParam,ModulationKnot[]>();
function curveValue(curve:ModulationKnot[],at:number) {
  let low=0,high=curve.length;
  while(low<high){const mid=(low+high)>>>1;if(curve[mid].at<=at+1e-9)low=mid+1;else high=mid;}
  const before=curve[Math.max(0,low-1)],after=curve[low];
  return after?before.value+(after.value-before.value)*clamp((at-before.at)/(after.at-before.at||1),0,1):before.value;
}
/** Preserve already submitted ramps, including ramps on unrelated live controls. */
function submitModulationCurve(param:AudioParam,curve:ModulationKnot[],reset:boolean) {
  if(!curve.length)return;
  const prior=modulationCurves.get(param),start=curve[0].at;
  let replace=0,append=false;
  if(prior?.length&&start>=prior[0].at-1e-9&&start<=prior[prior.length-1].at+1e-9) {
    const end=prior[prior.length-1].at;
    const changed=curve.findIndex(point=>point.at<=end+1e-9&&
      Math.abs(curveValue(prior,point.at)-point.value)>1e-10*Math.max(1,Math.abs(point.value)));
    if(changed<0){replace=curve.findIndex(point=>point.at>end+1e-9);append=true;}
    else replace=Math.max(0,changed-1);
    if(replace<0)return;
  }
  const submitted=curve.slice(replace),first=submitted[0];
  if(!append) {
    if(reset)param.cancelAndHoldAtTime(first.at);
    param.setValueAtTime(first.value,first.at);
  } else param.linearRampToValueAtTime(first.value,first.at);
  for(const point of submitted.slice(1))param.linearRampToValueAtTime(point.value,point.at);
  const history=prior?.filter(point=>point.at<first.at-1e-9)??[];
  const combined=history.concat(submitted);
  // Each graph submits short lookahead windows; retain enough history for offline windows too.
  modulationCurves.set(param,combined.length>1024?combined.slice(-1024):combined);
}

/** Bind the exact same evaluator to transport, audition, live input and offline graphs. */
export function configureModulation(graph:SongGraph,project:ProjectDocument,events:(ModControlEvent&{trackId:string})[],
  audioOrigin:number,songOrigin=0) {
  const previous=graph.modulation;
  const tracks=new Map<string,{track:Track;evaluator:ModulationEvaluator;signature:string;activeTrackTargets:ReadonlySet<string>}>();
  for(const track of project.tracks) {
    const strip=graph.tracks.get(track.id);if(!strip)continue;
    const prior=previous?.tracks.get(track.id);
    const oldTargets=prior?.activeTrackTargets??new Set<string>();
    const nextTargets=new Set<string>(track.modulation?.enabled?track.modulation.routes.filter(r=>r.enabled).map(r=>r.target):[]);
    const seconds=Math.max(0,graph.context.currentTime-audioOrigin+songOrigin);
    const restoreAt=Math.max(graph.context.currentTime,audioOrigin+(Math.ceil(seconds*MODULATION_HZ-1e-8)+1)/MODULATION_HZ-songOrigin);
    for(const target of oldTargets)if(target.startsWith("track.")&&!nextTargets.has(target))restoreTrackTarget(graph,track,project,target,restoreAt,audioOrigin,songOrigin);
    if(!track.modulation||(!track.modulation.enabled&&!prior)) {
      continue;
    }
    const lanes=track.automation.filter(l=>l.points.length).map(l=>({id:l.parameter,points:l.points.map(p=>({seconds:tickToSeconds(p.tick,project.tempo),value:p.value}))}));
    const trackEvents=events.filter(e=>e.trackId===track.id);
    const signature=JSON.stringify([track.modulation,project.tempo,trackEvents,lanes]);
    const sameClock=previous?.audioOrigin===audioOrigin&&previous.songOrigin===songOrigin;
    const evaluator=prior&&sameClock?prior.evaluator:new ModulationEvaluator(compileModulation(track.modulation,track.id,project.tempo,trackEvents,lanes));
    if(prior&&sameClock&&prior.signature!==signature)evaluator.reconfigure(compileModulation(track.modulation,track.id,project.tempo,trackEvents,lanes),
      Math.max(0,graph.context.currentTime-audioOrigin+songOrigin));
    tracks.set(track.id,{track,evaluator,signature,activeTrackTargets:nextTargets});
    if(!strip.matrixGain) {
      const level=graph.context.createGain();level.gain.value=1;
      strip.volume.disconnect();strip.volume.connect(level);level.connect(strip.pan);
      strip.matrixGain=level;strip.nodes.push(level);graph.nodes.push(level);
    }
    if(!prior&&(!track.modulation.enabled||!track.modulation.routes.some(r=>r.enabled&&r.target==="track.gain"))){
      modulationCurves.delete(strip.matrixGain.gain);
      strip.matrixGain.gain.cancelScheduledValues(graph.context.currentTime);strip.matrixGain.gain.setValueAtTime(1,graph.context.currentTime);
    }
  }
  graph.modulation={project,audioOrigin,songOrigin,tracks};
}
/** Restore only a removed bus destination, retaining every other native schedule. */
function restoreTrackTarget(graph:SongGraph,track:Track,project:ProjectDocument,target:string,at:number,audioOrigin:number,songOrigin:number) {
  const strip=graph.tracks.get(track.id);if(!strip)return;
  const mapping:Record<string,{param:AudioParam;base:number;parameter?:Parameters<typeof automationValue>[1];convert?:(v:number)=>number}>={
    "track.gain":{param:strip.matrixGain!.gain,base:0,convert:dbGain},
    "track.cutoff":{param:strip.filter.frequency,base:track.sound.cutoff,parameter:"cutoff"},
    "track.resonance":{param:strip.filter.Q,base:track.sound.resonance},
    "track.pan":{param:strip.pan.pan,base:track.pan,parameter:"pan"},
    "track.low":{param:strip.low.gain,base:track.low},"track.mid":{param:strip.mid.gain,base:track.mid},"track.high":{param:strip.high.gain,base:track.high},
    "track.reverb":{param:strip.reverb.gain,base:track.reverb,parameter:"reverb"},"track.delay":{param:strip.delay.gain,base:track.delay,parameter:"delay"},
  };
  const binding=mapping[target];if(!binding)return;
  const {param,parameter,base}=binding,convert=binding.convert??((value:number)=>value);
  const settle=at+.02,tick=(settle-audioOrigin+songOrigin)*project.tempo/60*960;
  const held=modulationCurves.has(param)?curveValue(modulationCurves.get(param)!,at):param.value;
  modulationCurves.delete(param);param.cancelScheduledValues(at);param.setValueAtTime(held,at);
  param.linearRampToValueAtTime(convert(parameter?automationValue(track,parameter,tick,base):base),settle);
  if(parameter)for(const point of track.automation.find(l=>l.parameter===parameter)?.points??[]) {
    const pointAt=audioOrigin+tickToSeconds(point.tick,project.tempo)-songOrigin;
    if(pointAt>settle)param.linearRampToValueAtTime(convert(point.value),pointAt);
  }
}
/** Intrinsic native control values, in destination units, including automation and held onset settings. */
export function modulationEffectiveTargets(graph:SongGraph,trackId:string,at:number,voice?:Voice):Readonly<Record<string,number>> {
  const strip=graph.tracks.get(trackId);if(!strip)return Object.freeze({});
  const value=(param:AudioParam)=>{const curve=modulationCurves.get(param);return curve&&at>=curve[0].at&&at<=curve[curve.length-1].at?curveValue(curve,at):param.value;};
  const result:Record<string,number>={"track.cutoff":value(strip.filter.frequency),"track.resonance":value(strip.filter.Q),
    "track.gain":strip.matrixGain?20*Math.log10(Math.max(1e-12,value(strip.matrixGain.gain))):0,"track.pan":value(strip.pan.pan),
    "track.low":value(strip.low.gain),"track.mid":value(strip.mid.gain),"track.high":value(strip.high.gain),
    "track.reverb":value(strip.reverb.gain),"track.delay":value(strip.delay.gain)};
  const binding=voice?.modulation;
  if(binding){
    result["voice.pitch"]=value(binding.pitch.offset);result["voice.gain"]=20*Math.log10(Math.max(1e-12,value(binding.level.gain)));
    if(binding.filter){result["voice.cutoff"]=value(binding.filter.frequency);result["voice.resonance"]=value(binding.filter.Q);}
    if(binding.fmMod)result["voice.fmRatio"]=value(binding.fmMod.frequency)/binding.frequency;
    if(binding.fmAmount)result["voice.fmIndex"]=value(binding.fmAmount.gain)/binding.frequency;
    for(const field of ["attack","decay","sustain","release"] as const)result[`voice.${field}`]=binding.sound[field];
  }
  return Object.freeze(result);
}
export function modulationEvent(graph:SongGraph,trackId:string,event:Omit<ModControlEvent,"seconds">,at:number) {
  const mod=graph.modulation;mod?.tracks.get(trackId)?.evaluator.addEvent({...event,seconds:Math.max(0,at-mod.audioOrigin+mod.songOrigin)});
}
function restoreVoiceTarget(voice:Voice,target:string,at:number,graph:SongGraph) {
  const binding=voice.modulation;if(!binding)return;
  const sound=binding.sound;
  const restoreEnd=voice.start>=at?at:at+.02;
  const set=(param:AudioParam,value:number)=>{const prior=modulationCurves.get(param),held=prior?curveValue(prior,at):param.value;modulationCurves.delete(param);param.cancelScheduledValues(at);
    if(voice.start>=at)param.setValueAtTime(value,at);else{param.setValueAtTime(held,at);param.linearRampToValueAtTime(value,at+.02);}};
  if(target==="voice.pitch")set(binding.pitch.offset,0);
  if(target==="voice.gain")set(binding.level.gain,1);
  if(target==="voice.fmRatio"&&binding.fmMod)set(binding.fmMod.frequency,sound.fmRatio*binding.frequency);
  if(target==="voice.fmIndex"&&binding.fmAmount)set(binding.fmAmount.gain,sound.fmIndex*binding.frequency);
  if(target==="voice.resonance"&&binding.filter)set(binding.filter.Q,sound.resonance);
  if(target==="voice.cutoff"&&binding.filter) {
    const onset=(graph.modulation?.audioOrigin??0)+binding.context.start-(graph.modulation?.songOrigin??0);
    const age=Math.max(0,restoreEnd-onset),attack=Math.max(.0001,sound.attack),decay=Math.max(.0001,sound.decay);
    const initial=1-sound.filterEnvelope*.85,settled=1-sound.filterEnvelope*.65;
    const phase=age<attack?initial+(1-initial)*age/attack:age<attack+decay?1+(settled-1)*(age-attack)/decay:settled;
    set(binding.filter.frequency,Math.max(20,sound.cutoff*phase));
    if(onset+attack>restoreEnd)binding.filter.frequency.linearRampToValueAtTime(sound.cutoff,onset+attack);
    if(onset+attack+decay>restoreEnd)binding.filter.frequency.linearRampToValueAtTime(Math.max(20,sound.cutoff*settled),onset+attack+decay);
  }
}
function modulationValue(evaluator:ModulationEvaluator,target:string,seconds:number,base:(seconds:number)=>number,
  convert:(value:number)=>number=(value)=>value,voice?:ModVoice) {
  let left=Math.floor(seconds*MODULATION_HZ+1e-8)/MODULATION_HZ;
  const right=left+1/MODULATION_HZ;
  if(voice&&voice.start>left)left=voice.start;
  // One control frame of interpolation latency keeps live input causal: an unknown
  // controller change can never alter samples that have already reached the speakers.
  const value=(at:number)=>convert(applyModTarget(target,base(at),evaluator.audioSample(Math.max(voice?.start??0,at-1/MODULATION_HZ),voice).targets[target]??0));
  if(seconds<=left+1e-9)return value(left);
  // Window edges lie on the same native parameter ramp as a single complete pass.
  return value(left)+(value(right)-value(left))*clamp((seconds-left)/(right-left),0,1);
}
export function scheduleModulation(graph:SongGraph,from:number,to:number,voices:Voice[]=[],reset=false) {
  const mod=graph.modulation;if(!mod||(!mod.tracks.size&&!voices.some(voice=>voice.modulation)))return;
  from=Math.max(0,from);to=Math.max(from,to);
  const points:number[]=[from];
  const songFrom=Math.max(0,from-mod.audioOrigin+mod.songOrigin);
  for(let frame=Math.floor(songFrom*MODULATION_HZ)+1;;frame++) {
    const at=mod.audioOrigin+frame/MODULATION_HZ-mod.songOrigin;if(at>=to-1e-9)break;points.push(at);
  }
  if(to>from)points.push(to);
  const curves=new Map<AudioParam,ModulationKnot[]>();
  const schedule=(param:AudioParam,value:number,at:number)=>{
    const curve=curves.get(param)??[];curve.push({at,value});curves.set(param,curve);
  };
  for(const [id,binding]of mod.tracks) {
    const {track,evaluator}=binding,strip=graph.tracks.get(id)!;
    const active=new Set<string>(track.modulation!.enabled?track.modulation!.routes.filter(r=>r.enabled).map(r=>r.target):[]);
    for(let i=0;i<points.length;i++) {
      const at=points[i],seconds=Math.max(0,at-mod.audioOrigin+mod.songOrigin);
      for(const target of active) {
        if(!target.startsWith("track."))continue;
        const auto=(parameter:Parameters<typeof automationValue>[1],fallback:number)=>(time:number)=>automationValue(track,parameter,time*mod.project.tempo/60*960,fallback);
        const mapping:Record<string,{param:AudioParam;base:(time:number)=>number;convert?:(v:number)=>number}>={
          "track.cutoff":{param:strip.filter.frequency,base:auto("cutoff",track.sound.cutoff)},
          "track.resonance":{param:strip.filter.Q,base:()=>track.sound.resonance},
          "track.gain":{param:strip.matrixGain!.gain,base:()=>0,convert:dbGain},
          "track.pan":{param:strip.pan.pan,base:auto("pan",track.pan)},
          "track.low":{param:strip.low.gain,base:()=>track.low},"track.mid":{param:strip.mid.gain,base:()=>track.mid},
          "track.high":{param:strip.high.gain,base:()=>track.high},
          "track.reverb":{param:strip.reverb.gain,base:auto("reverb",track.reverb)},
          "track.delay":{param:strip.delay.gain,base:auto("delay",track.delay)},
        };
        const targetBinding=mapping[target];if(!targetBinding)continue;
        schedule(targetBinding.param,modulationValue(evaluator,target,seconds,targetBinding.base,targetBinding.convert),at);
      }
    }
  }
  for(const voice of voices) {
    const binding=mod.tracks.get(voice.trackId);
    if(!binding) {
      if(voice.modulation){for(const target of voice.modulation.activeTargets)restoreVoiceTarget(voice,target,from,graph);voice.modulation.activeTargets.clear();}
      continue;
    }
    voice.enableModulation?.();const targets=voice.modulation;if(!targets)continue;
    const {track,evaluator}=binding;
    const active=new Set<string>(track.modulation!.enabled?track.modulation!.routes.filter(r=>r.enabled).map(r=>r.target):[]);
    for(const target of targets.activeTargets)if(!active.has(target))restoreVoiceTarget(voice,target,from,graph);
    targets.activeTargets=new Set([...active].filter(t=>t.startsWith("voice.")));
    if(!active.has("voice.pitch")&&!modulationCurves.has(targets.pitch.offset))targets.pitch.offset.setValueAtTime(0,from);
    if(!active.has("voice.gain")&&!modulationCurves.has(targets.level.gain))targets.level.gain.setValueAtTime(1,from);
    const voicePoints=[...new Set(points.concat(voice.start>=from&&voice.start<=to?[voice.start]:[]))].sort((a,b)=>a-b);
    for(let i=0;i<voicePoints.length;i++) {
      const at=voicePoints[i];if(at<voice.start-1e-9||at>=voice.end)continue;
      const seconds=Math.max(0,at-mod.audioOrigin+mod.songOrigin);
      for(const target of active) {
        const descriptor=MOD_TARGETS[target as keyof typeof MOD_TARGETS];
        if(!descriptor||descriptor.scope!=="voice"||descriptor.noteOnOnly)continue;
        const sound=targets.sound;
        const attack=Math.max(.0001,sound.attack),decay=Math.max(.0001,sound.decay);
        const initial=1-sound.filterEnvelope*.85,settled=1-sound.filterEnvelope*.65;
        const envelope=(time:number)=>{const elapsed=Math.max(0,time-targets.context.start);return elapsed<attack?initial+(1-initial)*elapsed/attack:elapsed<attack+decay?1+(settled-1)*(elapsed-attack)/decay:settled;};
        const mappings:Partial<Record<ModTarget,{param:AudioParam;base:(time:number)=>number;convert?:(v:number)=>number}>>={
          "voice.pitch":{param:targets.pitch.offset,base:()=>0},"voice.gain":{param:targets.level.gain,base:()=>0,convert:dbGain},
          ...(targets.filter?{"voice.cutoff":{param:targets.filter.frequency,base:(time:number)=>Math.max(20,sound.cutoff*envelope(time))},"voice.resonance":{param:targets.filter.Q,base:()=>sound.resonance}}:{}),
          ...(targets.fmMod?{"voice.fmRatio":{param:targets.fmMod.frequency,base:()=>sound.fmRatio,convert:(v:number)=>v*targets.frequency}}:{}),
          ...(targets.fmAmount?{"voice.fmIndex":{param:targets.fmAmount.gain,base:()=>sound.fmIndex,convert:(v:number)=>v*targets.frequency}}:{}),
        };
        const targetBinding=mappings[target as ModTarget];if(!targetBinding)continue;
        schedule(targetBinding.param,modulationValue(evaluator,target,seconds,targetBinding.base,targetBinding.convert,targets.context),at);
      }
    }
  }
  for(const [param,curve]of curves)submitModulationCurve(param,curve,reset);
}
export function makeGraph(
  context: BaseAudioContext,
  project: ProjectDocument,
  onlyTrack?: string,
  destination: AudioNode = context.destination,
  mastering = true,
  initializeImmediately = false,
): SongGraph {
  const master = context.createGain();
  master.gain.value = dbGain(!mastering || onlyTrack ? 0 : project.master.volume);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = mastering && project.master.limiter && !onlyTrack ? -2 : 0;
  limiter.knee.value = mastering && project.master.limiter && !onlyTrack ? 2 : 0;
  limiter.ratio.value = mastering && project.master.limiter && !onlyTrack ? 18 : 1;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  master.connect(limiter);
  limiter.connect(analyser);
  const output = context.createGain();
  analyser.connect(output);
  output.connect(destination);
  const reverb = context.createConvolver(),reverbInput=context.createGain(),reverbLevel=context.createGain();
  reverb.buffer = reverbImpulse(context,project.master.reverbDecay,project.seed);
  reverbInput.connect(reverb);reverb.connect(reverbLevel);reverbLevel.connect(master);
  const reverbState:NonNullable<SongGraph["reverbState"]>={input:reverbInput,current:{convolver:reverb,level:reverbLevel},
    decay:project.master.reverbDecay,seed:project.seed,pending:null,timer:null,retireTimer:null,transitionUntil:0,disposed:false};
  const delay = context.createDelay(3);
  delay.delayTime.value = (60 / project.tempo) * 0.75;
  const feedback = context.createGain();
  feedback.gain.value = 0.34;
  const delayFilter = context.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 4200;
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delayFilter.connect(master);
  const noise = context.createBuffer(
    1,
    context.sampleRate * 2,
    context.sampleRate,
  );
  const nd = noise.getChannelData(0),
    nr = randomGenerator(project.seed);
  for (let i = 0; i < nd.length; i++) nd[i] = nr() * 2 - 1;
  const tracks = new Map<string, TrackGraph>(),
    nodes: AudioNode[] = [
      master,
      limiter,
      analyser,
      reverb,
      reverbInput,
      reverbLevel,
      delay,
      feedback,
      delayFilter,
    ];
  for (const track of project.tracks) {
    if (onlyTrack && track.id !== onlyTrack) continue;
    const input = context.createGain(),
      expression = context.createGain(),
      filter = context.createBiquadFilter(),
      low = context.createBiquadFilter(),
      mid = context.createBiquadFilter(),
      high = context.createBiquadFilter(),
      drive = context.createWaveShaper(),
      volume = context.createGain(),
      pan = context.createStereoPanner(),
      rv = context.createGain(),
      dl = context.createGain(),
      meter = context.createAnalyser(),
      lfo = context.createOscillator(),
      lfoGain = context.createGain();
    filter.type = "lowpass";
    low.type = "lowshelf";
    low.frequency.value = 180;
    mid.type = "peaking";
    mid.frequency.value = 1400;
    mid.Q.value = 0.7;
    high.type = "highshelf";
    high.frequency.value = 6000;
    meter.fftSize = 512;
    input.connect(filter);
    filter.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(drive);
    drive.connect(expression);
    expression.connect(volume);
    volume.connect(pan);
    pan.connect(meter);
    meter.connect(master);
    pan.connect(rv);
    rv.connect(reverbInput);
    pan.connect(dl);
    dl.connect(delay);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    const graph = {
      input,
      expression,
      filter,
      low,
      mid,
      high,
      drive,
      volume,
      pan,
      reverb: rv,
      delay: dl,
      analyser: meter,
      lfo,
      lfoGain,
      nodes: [
        input,
        expression,
        filter,
        low,
        mid,
        high,
        drive,
        volume,
        pan,
        rv,
        dl,
        meter,
        lfo,
        lfoGain,
      ],
    };
    tracks.set(track.id, graph);
    nodes.push(...graph.nodes);
    applyTrack(graph, track, project, context.currentTime, 0, onlyTrack, initializeImmediately);
  }
  return {
    context,
    tracks,
    master,
    output,
    analyser,
    noise,
    nodes,
    reverbState,
    dispose: () => {
      reverbState.disposed=true;reverbState.pending=null;
      if(reverbState.timer)clearTimeout(reverbState.timer);if(reverbState.retireTimer)clearTimeout(reverbState.retireTimer);
      reverbState.timer=null;reverbState.retireTimer=null;
      output.disconnect();
      for (const t of tracks.values()) {
        try {
          t.lfo.stop();
        } catch {}
      }
      for (const n of nodes) n.disconnect();
    },
  };
}
function laneChanged(track:Track,previous:Track,parameter:string) {
  return JSON.stringify(track.automation.find(l=>l.parameter===parameter)?.points??[])!==JSON.stringify(previous.automation.find(l=>l.parameter===parameter)?.points??[]);
}
function automatedChanged(track:Track,previous:Track,parameter:string,base:number,oldBase:number) {
  return laneChanged(track,previous,parameter)||(!track.automation.some(l=>l.parameter===parameter&&l.points.length)&&base!==oldBase);
}
function trackMuted(track:Track,project:ProjectDocument,onlyTrack?:string) {
  return track.mute||(!onlyTrack&&project.tracks.some(t=>t.solo&&!t.mute)&&!track.solo);
}
export function applyTrack(
  graph: TrackGraph,
  track: Track,
  project: ProjectDocument,
  time: number,
  tick: number,
  onlyTrack?: string,
  immediately = false,
  previous?: Track,
  previousProject?: ProjectDocument,
) {
  const muted = trackMuted(track,project,onlyTrack);
  const changed=(parameter:string,base:number,oldBase:number)=>!previous||automatedChanged(track,previous,parameter,base,oldBase);
  const set = (param: AudioParam, value: number, shouldChange = true) => {
    if(!shouldChange)return;
    modulationCurves.delete(param);
    param.cancelScheduledValues(time);
    if(immediately)param.setValueAtTime(value,time);
    else param.setTargetAtTime(value, time, 0.012);
  };
  set(
    graph.volume.gain,
    muted ? 0 : dbGain(automationValue(track, "volume", tick, track.volume)),
    changed("volume",track.volume,previous?.volume??track.volume)||!!previousProject&&muted!==trackMuted(previous!,previousProject,onlyTrack),
  );
  set(
    graph.pan.pan,
    clamp(automationValue(track, "pan", tick, track.pan), -1, 1),
    changed("pan",track.pan,previous?.pan??track.pan),
  );
  set(
    graph.filter.frequency,
    clamp(
      automationValue(track, "cutoff", tick, track.sound.cutoff),
      20,
      20000,
    ),
    changed("cutoff",track.sound.cutoff,previous?.sound.cutoff??track.sound.cutoff),
  );
  set(graph.filter.Q, track.sound.resonance,!previous||track.sound.resonance!==previous.sound.resonance);
  set(
    graph.expression.gain,
    clamp(automationValue(track, "expression", tick, 1), 0, 1),
    changed("expression",1,1),
  );
  set(graph.low.gain, track.low,!previous||track.low!==previous.low);
  set(graph.mid.gain, track.mid,!previous||track.mid!==previous.mid);
  set(graph.high.gain, track.high,!previous||track.high!==previous.high);
  set(
    graph.reverb.gain,
    clamp(automationValue(track, "reverb", tick, track.reverb), 0, 1),
    changed("reverb",track.reverb,previous?.reverb??track.reverb),
  );
  set(
    graph.delay.gain,
    clamp(automationValue(track, "delay", tick, track.delay), 0, 1),
    changed("delay",track.delay,previous?.delay??track.delay),
  );
  set(graph.lfo.frequency, track.sound.lfoRate,!previous||track.sound.lfoRate!==previous.sound.lfoRate);
  set(
    graph.lfoGain.gain,
    track.sound.cutoff *
      0.35 *
      clamp(
        track.sound.lfoDepth + automationValue(track, "modulation", tick, 0),
        0,
        1,
      ),
    !previous||track.sound.cutoff!==previous.sound.cutoff||track.sound.lfoDepth!==previous.sound.lfoDepth||laneChanged(track,previous,"modulation"),
  );
  if(previous&&track.drive===previous.drive)return;
  if (track.drive > 0) {
    const curve = new Float32Array(2048);
    const amount = 1 + track.drive * 20;
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    graph.drive.curve = curve;
    graph.drive.oversample = "2x";
  } else graph.drive.curve = null;
}
export function scheduleAutomation(
  graph: TrackGraph,
  track: Track,
  project: ProjectDocument,
  audioStart: number,
  startTick: number,
  previous?:Track,
  previousProject?:ProjectDocument,
) {
  for (const lane of track.automation) {
    if (!lane.points.length) continue;
    if(previous&&!laneChanged(track,previous,lane.parameter)&&
      !(lane.parameter==="modulation"&&(track.sound.cutoff!==previous.sound.cutoff||track.sound.lfoDepth!==previous.sound.lfoDepth))&&
      !(lane.parameter==="volume"&&previousProject&&trackMuted(track,project)!==trackMuted(previous,previousProject)))continue;
    if (
      lane.parameter === "volume" &&
      (track.mute ||
        (project.tracks.some((t) => t.solo && !t.mute) && !track.solo))
    )
      continue;
    const params: Partial<
      Record<string, { param: AudioParam; convert: (n: number) => number }>
    > = {
      volume: { param: graph.volume.gain, convert: dbGain },
      pan: { param: graph.pan.pan, convert: (n) => clamp(n, -1, 1) },
      cutoff: {
        param: graph.filter.frequency,
        convert: (n) => clamp(n, 20, 20000),
      },
      expression: {
        param: graph.expression.gain,
        convert: (n) => clamp(n, 0, 1),
      },
      reverb: { param: graph.reverb.gain, convert: (n) => clamp(n, 0, 1) },
      delay: { param: graph.delay.gain, convert: (n) => clamp(n, 0, 1) },
      modulation: {
        param: graph.lfoGain.gain,
        convert: (n) =>
          track.sound.cutoff * 0.35 * clamp(track.sound.lfoDepth + n, 0, 1),
      },
    };
    const mapping = params[lane.parameter];
    if (!mapping) continue;
    const { param, convert } = mapping;
    const defaultValue =
      lane.parameter === "volume"
        ? track.volume
        : lane.parameter === "pan"
          ? track.pan
          : lane.parameter === "cutoff"
            ? track.sound.cutoff
            : lane.parameter === "expression"
              ? 1
              : 0;
    modulationCurves.delete(param);
    param.cancelScheduledValues(audioStart);
    param.setValueAtTime(
      convert(automationValue(track, lane.parameter, startTick, defaultValue)),
      audioStart,
    );
    for (const point of [...lane.points].sort((a, b) => a.tick - b.tick))
      if (point.tick > startTick)
        param.linearRampToValueAtTime(
          convert(point.value),
          audioStart + tickToSeconds(point.tick - startTick, project.tempo),
        );
  }
}
export function selectZone(
  instrument: InstrumentManifest,
  pitch: number,
  velocity: number,
  articulation: string,
  variation: number,
): SampleZone | undefined {
  const actual = instrument.articulations.includes(articulation)
    ? articulation
    : instrument.articulations[0];
  const matching = instrument.zones.filter(
    (z) =>
      z.articulation === actual &&
      pitch >= z.low &&
      pitch <= z.high &&
      velocity >= z.velocityLow &&
      velocity <= z.velocityHigh,
  );
  if (!matching.length) return undefined;
  const closest = Math.min(...matching.map((z) => Math.abs(z.root - pitch)));
  const group = matching
    .filter((z) => Math.abs(z.root - pitch) === closest)
    .sort((a, b) => a.roundRobin - b.roundRobin);
  return group[Math.abs(variation) % group.length];
}
function envelope(
  param: AudioParam,
  start: number,
  duration: number | undefined,
  peak: number,
  track: Track,
) {
  const sound = track.sound;
  const attack = duration
    ? Math.min(sound.attack, duration * 0.45)
    : sound.attack;
  const decay = duration ? Math.min(sound.decay, duration * 0.4) : sound.decay;
  param.setValueAtTime(0.00001, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.linearRampToValueAtTime(peak * sound.sustain, start + attack + decay);
  if (duration !== undefined) {
    param.setValueAtTime(peak * sound.sustain, start + duration);
    param.exponentialRampToValueAtTime(
      0.00001,
      start + duration + sound.release,
    );
  }
}
export function makeVoice(
  graph: SongGraph,
  track: Track,
  instrument: InstrumentManifest,
  note: ScheduledNote,
  time: number,
  duration: number | undefined,
  buffers: Map<string, AudioBuffer>,
  offset = 0,
  motion?: {songStart?:number;key?:string},
): Voice {
  const context = graph.context,
    tg = graph.tracks.get(track.id);
  if (!tg) throw new Error("This track is unavailable.");
  const songStart=motion?.songStart??Math.max(0,time-(graph.modulation?.audioOrigin??time)+(graph.modulation?.songOrigin??0)-offset);
  const noteId=(note as ScheduledNote&{id?:string}).id;
  const modContext:ModVoice={key:motion?.key??(noteId?`${noteId}:${note.tick}`:`${note.index}:${note.tick}:${note.pitch}`),pitch:note.pitch,velocity:note.velocity,start:songStart,
    ...(duration!==undefined?{release:songStart+duration+offset}:{})};
  let onset=graph.modulation?.tracks.get(track.id)?.evaluator.audioSample(songStart,modContext);
  const onsetSound=(settings:Track["sound"])=>{
    if(!onset)return {...settings};
    const sound={...settings};
    for(const key of ["attack","decay","sustain","release"] as const)
      if(onset.targets[`voice.${key}`]!==undefined)sound[key]=applyModTarget(`voice.${key}`,settings[key],onset.targets[`voice.${key}`]);
    return sound;
  };
  if(onset)track={...track,sound:onsetSound(track.sound)};
  const gain = context.createGain(),
    sources: (AudioBufferSourceNode | OscillatorNode)[] = [],
    bend: AudioParam[] = [];
  gain.connect(tg.input);
  const sound = track.sound;
  let currentSound=sound;
  let release = sound.release;
  let synthFilter: BiquadFilterNode | undefined;
  let fmMod: OscillatorNode | undefined, fmAmount: GainNode | undefined;
  const waveformOscillators: OscillatorNode[] = [];
  let peak = note.velocity * 0.75;
  let actualDuration = duration;
  const percussion =
    isDrumInstrument(instrument);
  const zone =
    instrument.kind === "sample"
      ? selectZone(
          instrument,
          note.pitch,
          note.velocity,
          note.articulation ?? sound.articulation,
          note.index,
        )
      : undefined;
  if (zone) {
    const buffer = buffers.get(zone.assetId ?? zone.url!);
    if (!buffer) throw new Error(instrument.name + " samples are not loaded.");
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, (note.pitch - zone.root) / 12);
    source.detune.value = sound.detune;
    if (
      zone.loopStart !== undefined &&
      zone.loopEnd !== undefined &&
      zone.loopEnd > zone.loopStart
    ) {
      source.loop = true;
      source.loopStart = zone.loopStart;
      source.loopEnd = Math.min(zone.loopEnd, buffer.duration);
    }
    source.connect(gain);
    bend.push(source.detune);
    sources.push(source);
    let seekOffset = offset * source.playbackRate.value;
    if (source.loop && seekOffset > source.loopEnd)
      seekOffset =
        source.loopStart +
        ((seekOffset - source.loopStart) % (source.loopEnd - source.loopStart));
    source.start(
      time,
      Math.min(seekOffset, Math.max(0, buffer.duration - 0.002)),
    );
    if (percussion) {
      actualDuration = Math.min(buffer.duration, duration ?? buffer.duration);
      gain.gain.setValueAtTime(peak, time);
    }
  } else if (percussion) {
    const pitch = note.pitch;
    actualDuration =
      pitch === 36
        ? 0.4
        : pitch === 38
          ? 0.22
          : pitch === 46
            ? 0.3
            : pitch === 49
              ? 1.4
              : 0.07;
    peak = note.velocity * 0.5;
    if (pitch === 36) {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(155, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.15);
      osc.connect(gain);
      osc.start(time);
      sources.push(osc);
    } else {
      const noise = context.createBufferSource();
      noise.buffer = graph.noise;
      const filter = context.createBiquadFilter();
      filter.type = pitch === 38 ? "bandpass" : "highpass";
      filter.frequency.value = pitch === 38 ? 1800 : pitch === 39 ? 2200 : 6500;
      filter.Q.value = 0.7;
      noise.connect(filter);
      filter.connect(gain);
      noise.start(time, (note.index % 50) * 0.02);
      sources.push(noise);
      if (pitch === 38) {
        const osc = context.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = 180;
        const body = context.createGain();
        body.gain.value = 0.3;
        osc.connect(body);
        body.connect(gain);
        osc.start(time);
        sources.push(osc);
      }
    }
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.00001, time + actualDuration);
  } else {
    if (instrument.kind === "sample")
      throw new Error("No sample zone is mapped for this note.");
    const filter = context.createBiquadFilter();
    synthFilter = filter;
    filter.type = "lowpass";
    filter.Q.value = sound.resonance;
    filter.frequency.setValueAtTime(
      Math.max(20, sound.cutoff * (1 - sound.filterEnvelope * 0.85)),
      time,
    );
    filter.frequency.linearRampToValueAtTime(sound.cutoff, time + sound.attack);
    filter.frequency.linearRampToValueAtTime(
      Math.max(20, sound.cutoff * (1 - sound.filterEnvelope * 0.65)),
      time + sound.attack + sound.decay,
    );
    filter.connect(gain);
    const frequency = 440 * Math.pow(2, (note.pitch - 69) / 12);
    if (sound.algorithm === "fm") {
      const carrier = context.createOscillator(),
        mod = context.createOscillator(),
        index = context.createGain();
      fmMod = mod; fmAmount = index;
      carrier.type = "sine";
      carrier.frequency.value = frequency;
      carrier.detune.value = sound.detune;
      mod.frequency.value = frequency * sound.fmRatio;
      index.gain.value = frequency * sound.fmIndex;
      mod.connect(index);
      index.connect(carrier.frequency);
      carrier.connect(filter);
      carrier.start(time);
      mod.start(time);
      sources.push(carrier, mod);
      bend.push(carrier.detune, mod.detune);
      peak *= 0.45;
    } else
      for (const detune of [-sound.detune, 0, sound.detune]) {
        const osc = context.createOscillator();
        waveformOscillators.push(osc);
        osc.type = sound.wave;
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        const level = context.createGain();
        level.gain.value = 0.16;
        osc.connect(level);
        level.connect(filter);
        osc.start(time);
        sources.push(osc);
        bend.push(osc.detune);
      }
  }
  if (!percussion) envelope(gain.gain, time, actualDuration, peak, track);
  if (actualDuration !== undefined)
    for (const source of sources)
      source.stop(
        time + actualDuration + (percussion ? 0.05 : release) + 0.025,
      );
  let ended = 0;
  for (const source of sources)
    source.onended = () => {
      source.disconnect();
      if (++ended === sources.length) {
        gain.disconnect();voice.modulation?.level.disconnect();
        if(voice.modulation){try{voice.modulation.pitch.stop();}catch{}voice.modulation.pitch.disconnect();}
        graph.modulation?.tracks.get(track.id)?.evaluator.forgetVoice(voice.modulation?.context.key??modContext.key);
      }
    };
  const voice: Voice = {
    start: time,
    end:
      actualDuration === undefined
        ? Infinity
        : time + actualDuration + release + 0.1,
    trackId: track.id,
    pitch: note.pitch,
    gain,
    sources,
    bend,
    baseBend: bend.map((p) => p.value),
    enableModulation:()=>{
      if(voice.modulation)return;
      const level=context.createGain(),pitch=context.createConstantSource();
      level.gain.value=1;pitch.offset.value=0;
      gain.disconnect();gain.connect(level);level.connect(graph.tracks.get(track.id)!.input);
      for(const param of bend)pitch.connect(param);
      pitch.start(Math.max(context.currentTime,time));
      voice.output=level;
      voice.modulation={context:modContext,pitch,level,filter:synthFilter,fmMod,fmAmount,sound:currentSound,frequency:440*Math.pow(2,(note.pitch-69)/12),activeTargets:new Set()};
    },
    updateSound: (next, at) => {
      if (percussion || at >= voice.end) return;
      if(time>at)onset=graph.modulation?.tracks.get(next.id)?.evaluator.audioSample(songStart,voice.modulation?.context??modContext);
      const prior=currentSound,queued=time>at;
      const settings=onsetSound(next.sound), when=Math.max(at,time), elapsed=Math.max(0,when-time);
      if(!queued){settings.attack=prior.attack;settings.decay=prior.decay;settings.filterEnvelope=prior.filterEnvelope;}
      // A held voice retains its synthesis topology and onset timing until note-off.
      settings.algorithm=sound.algorithm;settings.articulation=sound.articulation;currentSound=settings;
      next={...next,sound:settings};if(voice.modulation)voice.modulation.sound=settings;
      release=settings.release;
      if(settings.detune!==prior.detune)for(let i=0;i<bend.length;i++){
        const base=waveformOscillators.length?(i-1)*settings.detune:fmMod&&i===1?0:settings.detune;
        const expressionBend=bend[i].value-voice.baseBend[i];
        voice.baseBend[i]=base;bend[i].setTargetAtTime(base+expressionBend,when,.008);
      }
      if(settings.wave!==prior.wave)for(const osc of waveformOscillators)osc.type=settings.wave;
      if(fmMod&&fmAmount){const frequency=440*Math.pow(2,(note.pitch-69)/12);
        if(settings.fmRatio!==prior.fmRatio){modulationCurves.delete(fmMod.frequency);fmMod.frequency.cancelAndHoldAtTime(when);fmMod.frequency.setTargetAtTime(frequency*settings.fmRatio,when,.012);}
        if(settings.fmIndex!==prior.fmIndex){modulationCurves.delete(fmAmount.gain);fmAmount.gain.cancelAndHoldAtTime(when);fmAmount.gain.setTargetAtTime(frequency*settings.fmIndex,when,.012);}
      }
      if(synthFilter){
        const attack=Math.max(.0001,settings.attack),decay=Math.max(.0001,settings.decay);
        const initial=1-settings.filterEnvelope*.85,settled=1-settings.filterEnvelope*.65;
        const phase=elapsed<attack?initial+(1-initial)*elapsed/attack:elapsed<attack+decay?1+(settled-1)*(elapsed-attack)/decay:settled;
        if(settings.resonance!==prior.resonance){modulationCurves.delete(synthFilter.Q);synthFilter.Q.cancelAndHoldAtTime(when);synthFilter.Q.setTargetAtTime(settings.resonance,when,.012);}
        if(queued||settings.cutoff!==prior.cutoff){
          modulationCurves.delete(synthFilter.frequency);synthFilter.frequency.cancelAndHoldAtTime(when);synthFilter.frequency.setTargetAtTime(Math.max(20,settings.cutoff*phase),when,.012);
          if(time+attack>when+.015)synthFilter.frequency.linearRampToValueAtTime(settings.cutoff,time+attack);
          if(time+attack+decay>when+.015)synthFilter.frequency.linearRampToValueAtTime(Math.max(20,settings.cutoff*settled),time+attack+decay);
        }
      }
      if(queued){gain.gain.cancelScheduledValues(time);envelope(gain.gain,time,actualDuration,peak,next);}
      else if(settings.sustain!==prior.sustain&&elapsed>=settings.attack+settings.decay&&(actualDuration===undefined||when<time+actualDuration)){
        gain.gain.cancelAndHoldAtTime(when);gain.gain.setTargetAtTime(Math.max(.00001,peak*settings.sustain),when,.012);
      }
      if(actualDuration!==undefined&&when<time+actualDuration&&(queued||settings.sustain!==prior.sustain||settings.release!==prior.release)){
        // Keep the current attack/decay, but replace its future release as one envelope.
        gain.gain.cancelAndHoldAtTime(time+actualDuration);
        gain.gain.exponentialRampToValueAtTime(.00001,time+actualDuration+release);
        for(const source of sources){try{source.stop(time+actualDuration+release+.025);}catch{}}voice.end=time+actualDuration+release+.1;
      }
    },
    cancel: (at) => {
      if(voice.modulation)voice.modulation.context.release=at-(graph.modulation?.audioOrigin??0)+(graph.modulation?.songOrigin??0);
      gain.gain.cancelAndHoldAtTime(at);
      gain.gain.linearRampToValueAtTime(0, at + 0.02);
      for (const source of sources) { try { source.stop(at + 0.02); } catch {} }
      voice.end = at + 0.02;
    },
    release: (at: number) => {
      const t = Math.max(at, context.currentTime);
      if(voice.modulation)voice.modulation.context.release=t-(graph.modulation?.audioOrigin??0)+(graph.modulation?.songOrigin??0);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.00001, t, Math.max(0.008, release / 4));
      for (const source of sources) {
        try {
          source.stop(t + release + 0.04);
        } catch {}
      }
      voice.end = t + release + 0.05;
    },
  };
  if(graph.modulation?.tracks.has(track.id))voice.enableModulation?.();
  return voice;
}
export function scheduleAudio(
  graph: SongGraph,
  trackId: string,
  buffer: AudioBuffer,
  time: number,
  duration: number,
  offset: number,
  gain: number,
  fadeIn: number,
  fadeOut: number,
): Voice {
  const context = graph.context,
    input = graph.tracks.get(trackId)?.input;
  if (!input) throw new Error("This audio track is unavailable.");
  const source = context.createBufferSource(),
    level = context.createGain();
  source.buffer = buffer;
  source.connect(level);
  level.connect(input);
  const length = Math.min(duration, buffer.duration - offset);
  if (length <= 0)
    throw new Error("The audio trim is past the end of this take.");
  const fi = Math.min(fadeIn, length / 2),
    fo = Math.min(fadeOut, length / 2);
  level.gain.setValueAtTime(fi > 0 ? 0 : gain, time);
  if (fi) level.gain.linearRampToValueAtTime(gain, time + fi);
  if (fo) {
    level.gain.setValueAtTime(gain, time + length - fo);
    level.gain.linearRampToValueAtTime(0, time + length);
  }
  source.start(time, Math.max(0, offset), length);
  source.onended = () => {
    source.disconnect();
    level.disconnect();
  };
  const voice: Voice = {
    start: time,
    end: time + length,
    trackId,
    pitch: -1,
    gain: level,
    sources: [source],
    bend: [],
    baseBend: [],
    cancel: (at) => {
      level.gain.cancelAndHoldAtTime(at);
      level.gain.linearRampToValueAtTime(0, at + 0.02);
      try { source.stop(at + 0.02); } catch {}
      voice.end = at + 0.02;
    },
    release: (at) => {
      level.gain.cancelScheduledValues(at);
      level.gain.setTargetAtTime(0, at, 0.008);
      source.stop(at + 0.04);
      voice.end = at + 0.05;
    },
  };
  return voice;
}
