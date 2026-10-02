import {type ProjectDocument} from "../music/types";
import {projectEnd,tickToSeconds} from "../music/project";
import {automationValue,compileSong,type ScheduledNote,type ScheduledAudio,type ScheduledExpression} from "./compile";
import {instrumentFor,isDrumInstrument} from "./catalog";
import {resolvedModulationPatch} from "../music/automation-bindings";

export type ExportRange={startTick:number;endTick:number};
export type RenderExportOptions={range?:ExportRange;includeTails?:boolean;signal?:AbortSignal;preMaster?:boolean};

export function checkExportActive(signal?:AbortSignal){
  if(signal?.aborted)throw new DOMException("Export cancelled.","AbortError");
}
export function waitForExport<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener("abort",abort);reject(new DOMException("Export cancelled.","AbortError"));};
    signal.addEventListener("abort",abort,{once:true});
    if(signal.aborted)abort();
    promise.then(value=>{signal.removeEventListener("abort",abort);resolve(value);},error=>{signal.removeEventListener("abort",abort);reject(error);});
  });
}
/** A cancelled picker can still return a writable later; abort its temporary file. */
export function acquireExportWriter<T extends {abort:()=>Promise<void>}>(acquisition:Promise<T>,signal:AbortSignal):Promise<T>{
  let writer:T|undefined,aborting:Promise<void>|undefined;
  const abort=()=>writer?(aborting??=writer.abort().catch(()=>{})):Promise.resolve();
  const guarded=acquisition.then(async value=>{
    writer=value;
    if(signal.aborted){await abort();checkExportActive(signal);}
    return value;
  });
  return waitForExport(guarded,signal).catch(error=>{if(signal.aborted)void abort();throw error;});
}
export function exportRange(project:ProjectDocument,sectionId?:string):ExportRange{
  if(sectionId){
    const section=project.sections.find(s=>s.id===sectionId);
    if(!section)throw new Error("The selected section is no longer available.");
    return {startTick:section.startTick,endTick:section.startTick+section.lengthTick};
  }
  return {startTick:0,endTick:projectEnd(project)};
}
export function exportTailSeconds(project:ProjectDocument){
  return Math.max(project.master.reverbDecay*2,4,...project.tracks.map(t=>t.modulation?.enabled&&t.modulation.routes.some(r=>r.enabled&&r.target==="voice.release")?15:0));
}
/** Finite attenuation budget for printing source releases, filters and reachable effects. */
export function bounceTailSeconds(project:ProjectDocument){
  let voiceTail=0,reverb=false,delay=false;
  for(const track of project.tracks){
    const instrument=instrumentFor(project,track),patch=resolvedModulationPatch(track,instrument),
      routed=(target:string)=>!!patch?.enabled&&patch.routes.some(route=>route.enabled&&route.target===target),
      send=(parameter:"reverb"|"delay")=>track[parameter]>0||track.automation.some(lane=>lane.parameter===parameter&&lane.points.some(point=>point.value>0))||routed(`track.${parameter}`);
    voiceTail=Math.max(voiceTail,track.sound.release,routed("voice.release")?15:0,isDrumInstrument(instrument)?1.4:0);
    reverb||=send("reverb");delay||=send("delay");
  }
  // Low resonant filters can continue after voices stop. Delay is infinite
  // feedback; twenty periods include a conservative attenuation margin.
  return voiceTail+.1+8+Math.max(reverb?project.master.reverbDecay:0,delay?20*(60/project.tempo)*.75:0);
}
function renderPlan(project:ProjectDocument,range:ExportRange,includeTails:boolean,tailSeconds:number){
  if(!Number.isSafeInteger(range.startTick)||!Number.isSafeInteger(range.endTick)||range.startTick<0||range.endTick<=range.startTick)
    throw new Error("Choose a valid export range.");
  const startFrame=Math.round(tickToSeconds(range.startTick,project.tempo)*48000),
    endFrame=Math.round(tickToSeconds(range.endTick,project.tempo)*48000),
    renderFrames=endFrame+(includeTails?Math.ceil(tailSeconds*48000):0);
  return {startFrame,renderFrames,outputFrames:renderFrames-startFrame};
}
export function exportRenderPlan(project:ProjectDocument,range=exportRange(project),includeTails=true){
  return renderPlan(project,range,includeTails,exportTailSeconds(project));
}
export function bounceRenderPlan(project:ProjectDocument,range=exportRange(project),includeTails=true){
  return renderPlan(project,range,includeTails,bounceTailSeconds(project));
}

/** Keep the absolute song timeline so preroll establishes voices, effects and control state. */
export function compileExportSong(project:ProjectDocument,onlyTrack?:string,range?:ExportRange):{notes:ScheduledNote[];audio:(ScheduledAudio&{sourceDuration?:number})[];events:ScheduledExpression[]}{
  const song=compileSong(project,onlyTrack);
  if(!range)return song;
  const beforeEnd=<T extends {tick:number;duration:number}>(items:T[])=>items
    .filter(item=>item.tick<range.endTick)
    .map(item=>({...item,duration:Math.min(item.duration,range.endTick-item.tick)}));
  return {notes:beforeEnd(song.notes),audio:beforeEnd(song.audio.map(clip=>({...clip,sourceDuration:clip.duration}))),events:song.events.filter(e=>e.tick<range.endTick)};
}

/** A section's tail keeps its final control values, never the following section's automation. */
export function holdExportAutomation(project:ProjectDocument,endTick:number):ProjectDocument{
  return {...project,tracks:project.tracks.map(track=>({...track,automation:track.automation.map(lane=>{
    if(!lane.points.some(point=>point.tick>endTick))return lane;
    const points=lane.points.filter(point=>point.tick<endTick);
    return {...lane,points:[...points,{tick:endTick,value:automationValue(track,lane.parameter,endTick,0)}]};
  })}))};
}
