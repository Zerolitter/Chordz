import {chordCommand, ticksPerBeat, type ChordCommand} from "./chord-commands";
import type {ChordEvent, ProjectDocument} from "./types";

/** A palette drop changes one occupied chord, or inserts into actual empty guide time. */
export function chordPlacement(project: ProjectDocument, sectionId: string, tick: number, chord: ChordEvent, remainderId: string):
  {ok: true; command: ChordCommand; label: string} | {ok: false; error: string} {
  const section=project.sections.find(s=>s.id===sectionId);
  if(!section||!Number.isInteger(tick)||tick<section.startTick||tick>=section.startTick+section.lengthTick)
    return {ok:false,error:"Choose a bar inside this section."};
  const active=project.chords.filter(c=>c.sectionId===sectionId&&c.tick<=tick&&tick<c.tick+c.duration);
  if(active.length>1)return {ok:false,error:"Several chords overlap here. Choose a clear chord or a rest."};
  const command:ChordCommand=active.length
    ? {type:"replace",sectionId,chordId:active[0].id,symbol:chord.symbol,notes:chord.notes}
    : {type:"insert",sectionId,tick,chord,remainderId};
  const validation=chordCommand(project,command);
  if(!validation.ok)return validation;
  return {ok:true,command,label:active.length
    ? `Replace ${active[0].symbol} with ${chord.symbol} · keep ${active[0].duration/ticksPerBeat(project)} beats`
    : `Add ${chord.symbol} · ${chord.duration/ticksPerBeat(project)} beats · shift later guide chords`};
}

/** Canvas coordinates refer to the original guide. Reorder before a whole target,
 * then convert its position to the command's after-removal coordinate space. */
export function chordMoveDestination(project: ProjectDocument, sectionId: string, chordId: string, tick: number, remainderId: string):
  {ok: true; command: ChordCommand; tick: number; label: string} | {ok: false; error: string} {
  const section=project.sections.find(s=>s.id===sectionId);
  const sources=project.chords.filter(c=>c.sectionId===sectionId&&c.id===chordId);
  if(!section||sources.length!==1||!Number.isInteger(tick)||tick<section.startTick||tick>=section.startTick+section.lengthTick)
    return {ok:false,error:"Choose a clear chord inside its original section."};
  const source=sources[0],targets=project.chords.filter(c=>c.sectionId===sectionId&&c.tick<=tick&&tick<c.tick+c.duration);
  if(targets.length>1)return {ok:false,error:"Several chords overlap here. Choose a clear chord or a rest."};
  const target=targets[0],after=target&&tick>=target.tick+target.duration/2;
  const anchor=target?.id===source.id?source.tick:target?(after?target.tick+target.duration:target.tick):tick;
  const destination=anchor>=source.tick+source.duration?anchor-source.duration:anchor;
  const command:ChordCommand={type:"move",sectionId,chordId,tick:destination,remainderId};
  const validation=chordCommand(project,command);
  if(!validation.ok)return validation;
  return {ok:true,command,tick:anchor,label:target?.id===source.id?"Keep "+source.symbol+" here":target
    ? `Move ${source.symbol} ${after?"after":"before"} ${target.symbol}`
    : `Move ${source.symbol} into the rest · beat ${(tick-section.startTick)/ticksPerBeat(project)+1}`};
}
