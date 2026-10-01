import {type ProjectDocument} from "../music/types";
import {projectEnd,tickToSeconds} from "../music/project";
import {automationValue,compileSong,type ScheduledNote,type ScheduledAudio,type ScheduledExpression} from "./compile";

export type ExportRange={startTick:number;endTick:number};
export type RenderExportOptions={range?:ExportRange;includeTails?:boolean;signal?:AbortSignal};

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
export function exportRenderPlan(project:ProjectDocument,range=exportRange(project),includeTails=true){
  if(!Number.isSafeInteger(range.startTick)||!Number.isSafeInteger(range.endTick)||range.startTick<0||range.endTick<=range.startTick)
    throw new Error("Choose a valid export range.");
  const startFrame=Math.round(tickToSeconds(range.startTick,project.tempo)*48000),
    endFrame=Math.round(tickToSeconds(range.endTick,project.tempo)*48000),
    renderFrames=endFrame+(includeTails?Math.ceil(exportTailSeconds(project)*48000):0);
  return {startFrame,renderFrames,outputFrames:renderFrames-startFrame};
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
