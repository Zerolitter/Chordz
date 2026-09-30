export type MacroId = "M1" | "M2" | "M3" | "M4";
export const MACRO_IDS: MacroId[] = ["M1", "M2", "M3", "M4"];
export type ModScope = "track" | "voice";
export interface ModSource {
  id: string; name: string; kind: "lfo" | "envelope" | "random" | "step" | "reference";
  scope: ModScope; enabled: boolean; rate: number; sync: boolean; division: number;
  shape: "sine" | "triangle" | "saw" | "square"; phase: number; amplitude: number;
  attack: number; decay: number; sustain: number; release: number;
  steps: number[]; curve: number[];
}
export type ModTarget = `track.${"cutoff" | "resonance" | "gain" | "pan" | "low" | "mid" | "high" | "reverb" | "delay"}`
  | `voice.${"pitch" | "gain" | "cutoff" | "resonance" | "fmRatio" | "fmIndex" | "attack" | "decay" | "sustain" | "release"}`
  | `source:${string}:${"rate" | "amplitude"}`;
export interface ModRoute {
  id: string; sourceId: string; target: ModTarget; amount: number;
  curve: "linear" | "exponential"; slew: number; enabled: boolean;
}
export interface ModulationPatch {
  version: 1; enabled: boolean; sources: ModSource[]; routes: ModRoute[];
  macros: [number, number, number, number]; macroNames: [string, string, string, string]; seed: number;
  reference?: { name: string; fingerprint: string; startSec: number; endSec: number; tempo?: number; key?: string; mode?: "major" | "minor" };
}
export interface ChordMovementSettings {
  version: 1; enabled: boolean; liveEnabled: boolean; hold: boolean;
  inversion: number; spread: number; strum: number; gate: number; octaves: number;
  swing: number; division: number; pattern: "chord" | "up" | "down" | "upDown" | "random"; seed: number;
}
export interface ModTargetDescriptor {
  label: string; scope: ModScope; min: number; max: number; depth: number; unit: string;
  scale?: "log"; synthOnly?: boolean; noteOnOnly?: boolean;
}
export const MOD_TARGETS: Record<Exclude<ModTarget, `source:${string}:${"rate" | "amplitude"}`>, ModTargetDescriptor> = {
  "track.cutoff": {label:"Track filter",scope:"track",min:20,max:20000,depth:8,unit:"oct",scale:"log"},
  "track.resonance": {label:"Track resonance",scope:"track",min:0,max:24,depth:24,unit:"Q"},
  "track.gain": {label:"Track pulse / level",scope:"track",min:-60,max:12,depth:60,unit:"dB"},
  "track.pan": {label:"Track pan",scope:"track",min:-1,max:1,depth:2,unit:""},
  "track.low": {label:"Low EQ",scope:"track",min:-18,max:18,depth:36,unit:"dB"},
  "track.mid": {label:"Mid EQ",scope:"track",min:-18,max:18,depth:36,unit:"dB"},
  "track.high": {label:"High EQ",scope:"track",min:-18,max:18,depth:36,unit:"dB"},
  "track.reverb": {label:"Reverb send",scope:"track",min:0,max:1,depth:1,unit:""},
  "track.delay": {label:"Delay send",scope:"track",min:0,max:1,depth:1,unit:""},
  "voice.pitch": {label:"Voice pitch",scope:"voice",min:-2400,max:2400,depth:2400,unit:"cents"},
  "voice.gain": {label:"Voice pulse / level",scope:"voice",min:-60,max:12,depth:60,unit:"dB"},
  "voice.cutoff": {label:"Voice filter",scope:"voice",min:20,max:20000,depth:8,unit:"oct",scale:"log",synthOnly:true},
  "voice.resonance": {label:"Voice resonance",scope:"voice",min:0,max:24,depth:24,unit:"Q",synthOnly:true},
  "voice.fmRatio": {label:"FM ratio",scope:"voice",min:.1,max:20,depth:20,unit:"ratio",synthOnly:true},
  "voice.fmIndex": {label:"FM index",scope:"voice",min:0,max:30,depth:30,unit:"index",synthOnly:true},
  "voice.attack": {label:"Attack (next note)",scope:"voice",min:.001,max:10,depth:10,unit:"s",noteOnOnly:true},
  "voice.decay": {label:"Decay (next note)",scope:"voice",min:.001,max:10,depth:10,unit:"s",noteOnOnly:true},
  "voice.sustain": {label:"Sustain (next note)",scope:"voice",min:0,max:1,depth:1,unit:"",noteOnOnly:true},
  "voice.release": {label:"Release (next note)",scope:"voice",min:.01,max:15,depth:15,unit:"s",noteOnOnly:true},
};

/** Pure boundary validation, also used by the audio compiler and editor. */
export function modulationIssues(patch: ModulationPatch): string[] {
  const issues: string[] = [];
  const ids = new Set(patch.sources.map(s=>s.id));
  if(ids.size!==patch.sources.length || new Set(patch.routes.map(r=>r.id)).size!==patch.routes.length) issues.push("Duplicate modulation identifiers.");
  const builtIn = /^(M[1-4]|velocity|key|modulation|expression|pressure|pitchBend|cc:(all|[0-9]|1[0-5]):([0-9]|[1-9][0-9]|1[01][0-9]))$/;
  if(patch.sources.some(s=>builtIn.test(s.id))) issues.push("Source identifiers must differ from built-in controls.");
  const edges = new Map<string,string[]>();
  for(const route of patch.routes) {
    const source=patch.sources.find(s=>s.id===route.sourceId);
    if(!source&&!builtIn.test(route.sourceId)) issues.push("Route source does not exist.");
    const match=/^source:([a-zA-Z0-9_-]{1,96}):(rate|amplitude)$/.exec(route.target);
    const destination=match?patch.sources.find(s=>s.id===match[1]):undefined;
    const descriptor=MOD_TARGETS[route.target as keyof typeof MOD_TARGETS];
    if(match&&!destination || !match&&!descriptor) {issues.push("Route destination does not exist.");continue;}
    const scope=source?.scope??(["velocity","key"].includes(route.sourceId)?"voice":"track");
    if(scope==="voice"&&(destination?.scope??descriptor?.scope)==="track") issues.push("Voice sources can only affect voice destinations.");
    if(match&&match[2]==="rate"&&destination?.kind==="envelope") issues.push("Envelope rate cannot be routed; use its amplitude.");
    const depth=match?(match[2]==="rate"?3:1):descriptor.depth;
    if(Math.abs(route.amount)>depth) issues.push("Route depth exceeds this destination's range.");
    if(match&&source){edges.set(source.id,[...(edges.get(source.id)??[]),match[1]]);}
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string):boolean=>{if(visiting.has(id))return false;if(visited.has(id))return true;visiting.add(id);for(const next of edges.get(id)??[])if(!visit(next))return false;visiting.delete(id);visited.add(id);return true;};
  if(patch.sources.some(s=>!visit(s.id))) issues.push("Modulation feedback loops are not allowed.");
  return [...new Set(issues)];
}
