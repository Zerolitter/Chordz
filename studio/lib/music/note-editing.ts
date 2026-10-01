import {z} from "zod";
import {idSchema} from "./schema";
import {randomGenerator} from "./generate";
import {MAX_TICK} from "./arrangement";
import {PPQ,clamp,uid,type Clip,type NoteEvent} from "./types";

export const MAX_CLIP_NOTES=32000;
export type NoteScope=readonly string[]|"all";
export interface HumanizeNoteOptions {timingTicks:number;velocity:number;}
export interface NoteMarquee {startTick:number;endTick:number;lowPitch:number;highPitch:number;}
export const noteClipboardSchema=z.object({version:z.literal(1),ppq:z.literal(PPQ),notes:z.array(z.object({
  id:idSchema,pitch:z.number().int().min(0).max(127),tick:z.number().int().min(0).max(1_000_000_000),
  duration:z.number().int().min(1).max(1_000_000_000),velocity:z.number().min(0).max(1),articulation:z.string().max(40).optional(),
}).strict()).min(1).max(MAX_CLIP_NOTES)}).strict().superRefine((value,ctx)=>{
  if(new Set(value.notes.map(note=>note.id)).size!==value.notes.length)ctx.addIssue({code:"custom",message:"Copied note identities must be unique."});
});
export type NoteClipboard=z.infer<typeof noteClipboardSchema>;
export type NotePlacementResult={ok:true;clip:Clip;selectedIds:string[]}|{ok:false;error:string};

function selected(clip:Clip,scope:NoteScope):NoteEvent[]{
  if(scope==="all")return clip.notes;
  const ids=new Set(scope);return clip.notes.filter(note=>ids.has(note.id));
}
function changeNotes(clip:Clip,scope:NoteScope,update:(note:NoteEvent,index:number)=>NoteEvent):Clip {
  const ids=scope==="all"?null:new Set(scope);let changed=false;
  const notes=clip.notes.map((note,index)=>{
    if(ids&&!ids.has(note.id))return note;
    const next=update(note,index);
    if(next.tick===note.tick&&next.pitch===note.pitch&&next.duration===note.duration&&next.velocity===note.velocity)return note;
    changed=true;return next;
  });
  return changed?{...clip,notes}:clip;
}
function commonDelta(request:number,lower:number,upper:number):number {
  if(lower>upper)throw Error("The selected note group cannot fit within the source phrase. Choose fewer notes or a longer source.");
  return clamp(Math.round(request),lower,upper);
}
function sourceOnsets(clip:Clip,notes:NoteEvent[]){
  if(notes.some(note=>note.tick<0||note.tick>=clip.sourceLengthTick))throw Error("A selected note starts outside the loop source. Move it into the source or extend the loop source before changing its timing, length or pitch.");
}

/** All offsets are source ticks/pitches; arrangement timing and loop metadata remain intact. */
export function moveNotes(clip:Clip,scope:NoteScope,deltaTick:number,deltaPitch=0):Clip {
  if(!Number.isFinite(deltaTick)||!Number.isFinite(deltaPitch)||!Math.round(deltaTick)&&!Math.round(deltaPitch))return clip;
  const notes=selected(clip,scope);if(!notes.length)return clip;
  const tick=Math.round(deltaTick)?commonDelta(deltaTick,Math.max(...notes.map(note=>-note.tick)),Math.min(...notes.map(note=>clip.sourceLengthTick-1-note.tick))):0;
  if(!Math.round(deltaTick))sourceOnsets(clip,notes);
  const pitch=commonDelta(deltaPitch,Math.max(...notes.map(note=>-note.pitch)),Math.min(...notes.map(note=>127-note.pitch)));
  if(!tick&&!pitch)return clip;
  return changeNotes(clip,scope,note=>({...note,tick:note.tick+tick,pitch:note.pitch+pitch}));
}
export function resizeNotes(clip:Clip,scope:NoteScope,edge:"left"|"right",deltaTick:number):Clip {
  if(!Number.isFinite(deltaTick)||!Math.round(deltaTick))return clip;
  const notes=selected(clip,scope);if(!notes.length)return clip;
  if(edge==="right")sourceOnsets(clip,notes);
  const lower=edge==="left"?Math.max(...notes.map(note=>Math.max(-note.tick,note.duration-MAX_TICK))):Math.max(...notes.map(note=>1-note.duration));
  const upper=edge==="left"?Math.min(...notes.map(note=>Math.min(note.duration-1,clip.sourceLengthTick-1-note.tick))):
    Math.min(...notes.map(note=>Math.max(clip.sourceLengthTick,note.tick+note.duration)-note.tick-note.duration));
  const delta=commonDelta(deltaTick,lower,upper);if(!delta)return clip;
  return changeNotes(clip,scope,note=>edge==="left"?{...note,tick:note.tick+delta,duration:note.duration-delta}:{...note,duration:note.duration+delta});
}

function snappedOnset(tick:number,sourceLength:number,grid:number,swing:number):number {
  const last=Math.floor((sourceLength-1)/grid),near=Math.floor(tick/grid);
  const steps=new Set([0,last,last-1,near-1,near,near+1,near+2].map(step=>clamp(step,0,last)));
  let best=0,distance=Infinity;
  for(const step of steps){
    const target=Math.round(step*grid+(step%2?swing*grid:0));if(target>=sourceLength)continue;
    const difference=Math.abs(target-tick);
    if(difference<distance||difference===distance&&target>best){best=target;distance=difference;}
  }
  return best;
}
/** Quantize starts by default; changing duration requires the explicit option. */
export function quantizeNotes(clip:Clip,scope:NoteScope,grid:number,swing=0,options:{durations?:boolean}={}):Clip {
  if(!Number.isFinite(grid)||grid<1||!Number.isFinite(swing))return clip;
  sourceOnsets(clip,selected(clip,scope));
  grid=Math.round(grid);swing=clamp(swing,0,.75);
  return changeNotes(clip,scope,note=>({...note,tick:snappedOnset(note.tick,clip.sourceLengthTick,grid,swing),
    duration:options.durations?Math.max(1,Math.min(Math.round(note.duration/grid),Math.floor(MAX_TICK/grid))*grid):note.duration}));
}
function sourceSeed(seed:number,note:NoteEvent,index:number):number {
  let value=seed>>>0;
  for(const character of `${index}:${note.id}`)value=Math.imul(value^character.charCodeAt(0),16777619)>>>0;
  return value;
}
/** Each source note has its own deterministic draw, so scope does not change the proposal. */
export function humanizeNotes(clip:Clip,scope:NoteScope,seed:number,options:HumanizeNoteOptions):Clip {
  if(!Number.isFinite(seed)||!Number.isFinite(options.timingTicks)||!Number.isFinite(options.velocity))return clip;
  const timing=Math.max(0,Math.round(options.timingTicks)),velocity=clamp(options.velocity,0,1);if(!timing&&!velocity)return clip;
  if(timing)sourceOnsets(clip,selected(clip,scope));
  return changeNotes(clip,scope,(note,index)=>{
    const random=randomGenerator(sourceSeed(seed,note,index)),timingDraw=random(),velocityDraw=random();
    return {...note,tick:timing?clamp(note.tick+Math.round((timingDraw*2-1)*timing),0,clip.sourceLengthTick-1):note.tick,
      velocity:velocity?clamp(note.velocity+(velocityDraw*2-1)*velocity,0,1):note.velocity};
  });
}

export function copyNotes(clip:Clip,scope:NoteScope):NoteClipboard|null {
  const notes=selected(clip,scope);if(!notes.length)return null;
  const origin=Math.min(...notes.map(note=>note.tick));
  return {version:1,ppq:PPQ,notes:notes.map(note=>({...structuredClone(note),tick:note.tick-origin}))};
}
export function pasteNotes(clip:Clip,clipboard:unknown,startTick:number,allocateId:()=>string=uid):NotePlacementResult {
  const parsed=noteClipboardSchema.safeParse(clipboard);
  if(!parsed.success)return {ok:false,error:"The copied notes are invalid or use a different source timing."};
  if(!Number.isInteger(startTick)||!Number.isFinite(startTick)||parsed.data.notes.some(note=>startTick+note.tick<0||startTick+note.tick>=clip.sourceLengthTick))
    return {ok:false,error:"The complete note group does not fit at that source position. Choose another position or a longer source."};
  if(clip.notes.length+parsed.data.notes.length>MAX_CLIP_NOTES)return {ok:false,error:`This phrase supports up to ${MAX_CLIP_NOTES.toLocaleString("en-US")} notes.`};
  const ids=new Set(clip.notes.map(note=>note.id)),notes:NoteEvent[]=[];
  for(const source of parsed.data.notes){
    const id=allocateId();if(!idSchema.safeParse(id).success||ids.has(id))return {ok:false,error:"A fresh note identity could not be allocated. Try again."};
    ids.add(id);notes.push({...structuredClone(source),id,tick:source.tick+startTick});
  }
  return {ok:true,clip:{...clip,notes:[...clip.notes,...notes]},selectedIds:notes.map(note=>note.id)};
}
export function duplicateNotes(clip:Clip,scope:NoteScope,startTick?:number,allocateId:()=>string=uid):NotePlacementResult {
  const notes=selected(clip,scope),copied=copyNotes(clip,scope);
  if(!copied)return {ok:false,error:"Select notes to duplicate."};
  return pasteNotes(clip,copied,startTick??Math.max(...notes.map(note=>note.tick+note.duration)),allocateId);
}
export function reconcileNoteSelection(clip:Clip,ids:readonly string[]):string[]{
  const present=new Set(clip.notes.map(note=>note.id));return [...new Set(ids)].filter(id=>present.has(id));
}
export function marqueeNoteIds(clip:Clip,bounds:NoteMarquee):string[]{
  if(!Object.values(bounds).every(Number.isFinite))return [];
  const start=Math.min(bounds.startTick,bounds.endTick),end=Math.max(bounds.startTick,bounds.endTick),low=Math.min(bounds.lowPitch,bounds.highPitch),high=Math.max(bounds.lowPitch,bounds.highPitch);
  if(start===end)return [];
  return clip.notes.filter(note=>note.tick<end&&note.tick+note.duration>start&&note.pitch>=low&&note.pitch<=high).map(note=>note.id);
}
export function notePitchRows(clip:Clip,fold=false):number[]{
  return fold&&clip.notes.length?[...new Set(clip.notes.map(note=>note.pitch))].sort((a,b)=>b-a):Array.from({length:128},(_,index)=>127-index);
}
