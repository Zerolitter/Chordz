import { MOD_TARGETS, type ModulationPatch } from "./modulation-types";
import type { InstrumentManifest, Track } from "./types";

/** Shared by the rack and every native graph, including audition and export. */
export function modulationTargetReason(track:Pick<Track,"kind"|"sound"|"modulation">,instrument:InstrumentManifest,target:string,patch=track.modulation):string {
  if(target.startsWith("source:")){
    const [,id,parameter]=target.split(":");const source=patch?.sources.find(s=>s.id===id);
    return !source?"Source no longer exists":parameter==="rate"&&source.kind==="envelope"?"Envelope rate is unavailable":"";
  }
  const descriptor=MOD_TARGETS[target as keyof typeof MOD_TARGETS];
  if(!descriptor)return "Parameter no longer exists";
  if(descriptor.scope==="voice"&&track.kind==="audio")return "Instrument tracks only";
  if(descriptor.synthOnly&&instrument.kind!=="synth")return "Synth instruments only";
  if(target.startsWith("voice.fm")&&track.sound.algorithm!=="fm")return "Select the FM engine";
  return "";
}
export function resolvedModulationPatch(track:Track,instrument:InstrumentManifest,patch:ModulationPatch|undefined=track.modulation){
  if(!patch)return undefined;
  const unsupported=patch.routes.some(route=>route.enabled&&!!modulationTargetReason(track,instrument,route.target,patch));
  return unsupported?{...patch,routes:patch.routes.map(route=>modulationTargetReason(track,instrument,route.target,patch)?{...route,enabled:false}:route)}:patch;
}
export function inactiveAutomationBindings(track:Track,instrument:InstrumentManifest){
  const patch=resolvedModulationPatch(track,instrument);
  const activeDestination=(root:string)=>{
    if(!patch?.enabled)return false;
    const pending=[root],seen=new Set<string>();
    while(pending.length){
      const source=pending.pop()!;if(seen.has(source))continue;seen.add(source);
      for(const route of patch.routes.filter(r=>r.enabled&&r.sourceId===source)){
        if(!route.target.startsWith("source:"))return true;
        const target=route.target.split(":")[1];
        if(patch.sources.some(s=>s.id===target&&s.enabled))pending.push(target);
      }
    }
    return false;
  };
  return track.automation.flatMap(lane=>{
    const macro=/^M[1-4]$/.test(lane.parameter);
    const reason=lane.parameter==="pitchBend"&&track.kind==="audio"?"Instrument tracks only":
      macro&&!activeDestination(lane.parameter)?"No active destination for this macro":"";
    return reason?[{target:lane.parameter,reason}]:[];
  });
}
