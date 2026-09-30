import { PPQ,type ChordEvent,type ProjectDocument } from "./types";
import { ticksPerBar } from "./project";
import {projectSchema} from "./schema";
export type ChordCommand =
  | {type:"insert";sectionId:string;tick:number;chord:ChordEvent;remainderId:string}
  | {type:"move";sectionId:string;chordId:string;tick:number;remainderId:string}
  | {type:"resize";sectionId:string;chordId:string;duration:number}
  | {type:"remove"|"deleteTime";sectionId:string;chordId:string}
  | {type:"replace";sectionId:string;chordId:string;symbol:string;notes:number[]};
export type ChordResult={ok:true;document:ProjectDocument;selectedId:string|null}|{ok:false;error:string};
export const ticksPerBeat=(p:Pick<ProjectDocument,"timeSignature">)=>PPQ*4/p.timeSignature[1];
export type ChordSnap="beat"|"half"|"quarter"|"bar";
export const chordGrid=(p:ProjectDocument,snap:ChordSnap)=>snap==="bar"?ticksPerBar(p):ticksPerBeat(p)*(snap==="half"?.5:snap==="quarter"?.25:1);

export function chordCommand(project:ProjectDocument,command:ChordCommand):ChordResult{
  try{
    const sections=project.sections.filter(s=>s.id===command.sectionId);if(sections.length!==1)throw Error("Choose a section with a unique identity.");const section=sections[0];
    const start=section.startTick,end=start+section.lengthTick;
    let chords=[...project.chords],selectedId:string|null=null;
    const local=()=>chords.filter(c=>c.sectionId===section.id);
    const target=(id:string)=>{const matches=local().filter(c=>c.id===id);if(matches.length!==1)throw Error("This chord identity is ambiguous. Remove the duplicate in a recovered copy before editing its timing.");return matches[0];};
    const replace=(old:ChordEvent,next:ChordEvent)=>{chords=chords.map(c=>c===old?next:c);};
    const bounds=(c:ChordEvent)=>{if(c.tick<start||c.tick+c.duration>end)throw Error("An affected chord crosses this section boundary. Shorten or remove it before shifting time.");};
    const unique=(id:string)=>{if(chords.some(c=>c.id===id))throw Error("A new chord needs a unique identity.");};
    const validateNotes=(notes:number[])=>{if(notes.length<2||notes.length>12||notes.some(n=>!Number.isInteger(n)||n<0||n>127))throw Error("Choose 2–12 notes between MIDI 0 and 127.");};
    const shift=(cut:number,delta:number)=>{for(const c of local().filter(c=>c.tick>=cut)){bounds(c);target(c.id);replace(c,{...c,tick:c.tick+delta});}};
    const close=(c:ChordEvent)=>{
      bounds(c);
      if(local().some(other=>other!==c&&other.tick<c.tick+c.duration&&other.tick+other.duration>c.tick))throw Error("This chord overlaps another. Remove it while keeping timing, or edit its voicing first.");
      chords=chords.filter(other=>other!==c);shift(c.tick+c.duration,-c.duration);
    };
    const insert=(c:ChordEvent,tick:number,remainderId:string)=>{
      if(!Number.isInteger(tick)||tick<start||tick>=end)throw Error("Choose an insertion point inside this section.");
      if(!Number.isInteger(c.duration)||c.duration<1)throw Error("Chord duration must be a positive number of ticks.");
      validateNotes(c.notes);unique(c.id);
      const crossing=local().filter(other=>other.tick<tick&&other.tick+other.duration>tick);
      if(crossing.length>1)throw Error("Several chords cross this insertion point. Choose another point or remove an overlapping chord while keeping timing.");
      for(const other of crossing)bounds(other);
      shift(tick,c.duration);
      if(crossing.length){const old=crossing[0];target(old.id);unique(remainderId);if(remainderId===c.id)throw Error("Split and inserted chords need different identities.");replace(old,{...old,duration:tick-old.tick});chords.push({...old,id:remainderId,tick:tick+c.duration,duration:old.tick+old.duration-tick});}
      chords.push({...c,sectionId:section.id,tick});selectedId=c.id;
    };
    if(command.type==="insert")insert(command.chord,command.tick,command.remainderId);
    else{
      const c=target(command.chordId);selectedId=c.id;
      if(command.type==="replace"){validateNotes(command.notes);replace(c,{...c,symbol:command.symbol,notes:[...command.notes]});}
      if(command.type==="remove"){chords=chords.filter(other=>other!==c);selectedId=null;}
      if(command.type==="deleteTime"){close(c);selectedId=null;}
      if(command.type==="move"){if(command.tick===c.tick)return {ok:true,document:project,selectedId:c.id};close(c);insert(c,command.tick,command.remainderId);}
      if(command.type==="resize"){
        if(!Number.isInteger(command.duration)||command.duration<1)throw Error("Choose a positive chord duration.");
        bounds(c);if(local().some(other=>other!==c&&other.tick<c.tick+c.duration&&other.tick+other.duration>c.tick))throw Error("Resize is ambiguous while this chord overlaps another. Its voicing can still be edited.");
        shift(c.tick+c.duration,command.duration-c.duration);replace(c,{...c,duration:command.duration});
      }
    }
    if(!projectSchema.safeParse({...project,chords}).success)throw Error("The proposed chord fields or collection exceed the supported project limits.");
    if(command.type==="replace"||command.type==="remove")return {ok:true,document:{...project,chords},selectedId};
    // Only touched events are checked; unrelated legacy regions remain unchanged.
    const touched=chords.filter(c=>c.sectionId===section.id&&!project.chords.includes(c));
    const furthest=Math.max(start,...touched.map(c=>c.tick+c.duration));
    if(furthest>end)throw Error("Needs "+((furthest-end)/ticksPerBeat(project)).toFixed(2).replace(/\.00$/,"")+" more beats. Shorten a chord or delete guide time to make room; existing phrases keep their timing.");
    for(const c of touched)if(c.tick<start)throw Error("This edit would move a chord before the section.");
    return {ok:true,document:{...project,chords},selectedId};
  }catch(error){return {ok:false,error:error instanceof Error?error.message:"Chord edit failed."};}
}
