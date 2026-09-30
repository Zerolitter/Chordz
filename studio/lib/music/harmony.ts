import {chordNotes} from "./theory";
import {uid,type NoteEvent,type ProjectDocument,type Section} from "./types";
export interface HarmonySpan {startTick:number;endTick:number;notes:readonly number[]|null;sourceIndex:number|null;}
export const tonicHarmony=(project:ProjectDocument)=>chordNotes(project.key+(["minor","dorian","harmonic-minor"].includes(project.mode)?"m":""),4);
export function resolveHarmony(project:ProjectDocument,section:Section):HarmonySpan[]{
  const guide=project.chords.map((c,index)=>({c,index})).filter(({c})=>c.sectionId===section.id),start=section.startTick,end=start+section.lengthTick;
  if(!guide.length)return [{startTick:start,endTick:end,sourceIndex:null,notes:tonicHarmony(project)}];
  const clipped=guide.filter(({c})=>c.tick<end&&c.tick+c.duration>start);
  const cuts=[...new Set([start,end,...clipped.flatMap(({c})=>[Math.max(start,c.tick),Math.min(end,c.tick+c.duration)])])].sort((a,b)=>a-b);
  const spans:HarmonySpan[]=[];
  for(let i=0;i<cuts.length-1;i++){
    const a=cuts[i],b=cuts[i+1],winner=clipped.filter(({c})=>c.tick<=a&&c.tick+c.duration>a).sort((x,y)=>y.c.tick-x.c.tick||x.index-y.index)[0];
    const previous=spans.at(-1),sourceIndex=winner?.index??null,notes=winner?.c.notes??null;
    if(previous&&previous.sourceIndex===sourceIndex&&previous.notes===notes)previous.endTick=b;
    else spans.push({startTick:a,endTick:b,sourceIndex,notes});
  }return spans;
}
export function harmonyAt(spans:HarmonySpan[],tick:number){let lo=0,hi=spans.length-1;while(lo<=hi){const mid=(lo+hi)>>1,s=spans[mid];if(tick<s.startTick)hi=mid-1;else if(tick>=s.endTick)lo=mid+1;else return s;}return undefined;}
export function progressionNotes(project:ProjectDocument,section:Section):NoteEvent[]{return resolveHarmony(project,section).flatMap(span=>(span.notes??[]).map(pitch=>({id:uid(),pitch,tick:span.startTick-section.startTick,duration:span.endTick-span.startTick,velocity:.7})));}
export const harmonyIdentity=(project:ProjectDocument,section:Section)=>resolveHarmony(project,section).map(s=>[s.startTick,s.endTick,s.notes]);
