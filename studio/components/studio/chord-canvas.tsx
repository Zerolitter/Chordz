"use client";
import {useEffect,useEffectEvent,useRef,useState} from "react";
import {GripVertical,Play} from "lucide-react";
import {usePreference} from "./use-preference";
import {useStudio} from "./use-studio";
import {DraftInput} from "./draft-field";
import {ChordResizeHandle} from "./chord-resize-handle";
import {ChordPaletteCard,type PaletteDrag} from "./chord-palette-card";
import {chordCommand,chordGrid,ticksPerBeat,type ChordCommand,type ChordSnap} from "../../lib/music/chord-commands";
import {chordMoveDestination,chordPlacement} from "../../lib/music/chord-placement";
import {ticksPerBar} from "../../lib/music/project";
import {chordNotes,noteName,recognizeChords,suggestChords,voiceLead} from "../../lib/music/theory";
import {uid} from "../../lib/music/types";
import {Range} from "./primitives";

type CardDrag=PaletteDrag|{kind:"move";projectId:string;sectionId:string;id:string;remainderId:string};
export function ChordCanvas({tension,setTension,onProgression}:{tension:number;setTension:(n:number)=>void;onProgression:()=>void}){
  const s=useStudio(),section=s.selectedSection,beat=ticksPerBeat(s.project),bar=ticksPerBar(s.project);
  const [snap,setSnap]=usePreference<ChordSnap>("chord-snap","beat",(v):v is ChordSnap=>typeof v==="string"&&["beat","half","quarter","bar"].includes(v)),[cursor,setCursor]=useState(0),[symbol,setSymbol]=useState("Dm"),[error,setError]=useState("");
  const [drag,setDrag]=useState<CardDrag|null>(null),[drop,setDrop]=useState<number|null>(null),[dropLabel,setDropLabel]=useState(""),[dropError,setDropError]=useState<string|null>(null),[proposal,setProposal]=useState<ChordCommand|null>(null);
  const lane=useRef<HTMLDivElement>(null),dragRef=useRef<CardDrag|null>(null);
  const chords=s.project.chords.filter(c=>c.sectionId===section.id).sort((a,b)=>a.tick-b.tick),selected=chords.find(c=>c.id===s.selectedChordId);
  const grid=chordGrid(s.project,snap),position=Math.min(Math.max(0,cursor),section.lengthTick-grid);
  const previous=selected?.notes??chords.filter(c=>c.tick<=section.startTick+position).at(-1)?.notes??s.selectedNotes;
  const suggestions=suggestChords(previous,s.project.key,s.project.mode,tension).slice(0,6);
  let customNotes:number[]=[];try{customNotes=voiceLead(previous,chordNotes(symbol,s.octave)).notes;}catch{}
  const performAuto=useEffectEvent(()=>{if(selected&&s.mode==="write")void s.audition(selected.notes,.9,true);});
  const selectedIdentity=JSON.stringify([selected?.id,selected?.notes]);useEffect(()=>{performAuto();},[selectedIdentity]);
  function startDrag(next:CardDrag|null){dragRef.current=next;setDrag(next);}
  function cancel(){const d=dragRef.current;if(d?.kind==="move")s.cancelEdit("chord-drag:"+d.id);startDrag(null);setDrop(null);}
  const cancelDrag=useEffectEvent(cancel);
  const registerInteraction=s.registerInteraction;
  useEffect(()=>{if(drag)return registerInteraction(()=>{cancelDrag();return true;});},[drag,registerInteraction]);
  useEffect(()=>{if(!drag)return;const esc=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!(drag.kind==="palette"&&drag.input==="keyboard")){e.preventDefault();e.stopPropagation();cancelDrag();}};window.addEventListener("keydown",esc,true);return()=>window.removeEventListener("keydown",esc,true);},[drag]);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)cancelDrag();});return()=>{active=false;};},[s.project.id,section.id]);
  function apply(command:ChordCommand){setProposal(command);const result=s.applyChord(command);if(!result.ok){setError(result.error);return false;}setProposal(null);setError("");return true;}
  function replace(name:string,notes:number[]){if(selected)apply({type:"replace",sectionId:section.id,chordId:selected.id,symbol:name,notes});}
  function notesChanged(notes:number[]){if(!selected)return;const name=recognizeChords(notes,s.project.key)[0]?.symbol??"Custom";s.edit(p=>({...p,chords:p.chords.map(c=>c.id===selected.id&&c.sectionId===section.id?{...c,notes,symbol:name}:c)}),"Edit voicing");}
  function moveStep(direction:number){
    if(!selected)return;
    const other=direction<0?chords.filter(c=>c.tick<selected.tick).at(-1):chords.find(c=>c.tick>selected.tick);
    const tick=other?(direction<0?other.tick:other.tick+other.duration-1):Math.max(section.startTick,Math.min(section.startTick+section.lengthTick-1,selected.tick+direction*grid));
    const result=chordMoveDestination(s.committedRef.current,section.id,selected.id,tick,uid());if(result.ok)apply(result.command);else setError(result.error);
  }
  function atX(x:number){const box=lane.current!.getBoundingClientRect();return section.startTick+Math.min(section.lengthTick-grid,Math.max(0,Math.round((x-box.left)/box.width*section.lengthTick/grid)*grid));}
  function candidate(d:CardDrag,tick:number){
    if(d.projectId!==s.project.id||d.sectionId!==section.id)return {ok:false as const,error:"Keep this card inside its original section."};
    if(d.kind==="palette")return chordPlacement(s.committedRef.current,section.id,tick,d.chord,d.remainderId);
    return chordMoveDestination(s.committedRef.current,section.id,d.id,tick,d.remainderId);
  }
  function hover(d:CardDrag,tick:number){
    if(dragRef.current!==d)return;
    if(d.kind==="move"&&!s.ownsEdit("chord-drag:"+d.id)){cancel();return;}
    const r=candidate(d,tick);setDrop(r.ok&&"tick" in r&&typeof r.tick==="number"?r.tick:tick);setDropError(r.ok?null:r.error);setDropLabel(r.ok?r.label:"");
    if(d.kind==="move"){s.invalidateEdit(r.ok?null:r.error,"chord-drag:"+d.id);if(r.ok){const result=chordCommand(s.committedRef.current,r.command);if(result.ok)s.edit(()=>result.document,"Move chord");}}
  }
  function place(d:CardDrag,tick:number){
    if(dragRef.current!==d)return;
    const r=candidate(d,tick);
    if(!r.ok){setError(r.error);if(d.kind==="move")s.cancelEdit("chord-drag:"+d.id);}
    else if(d.kind==="palette")apply(r.command);
    else if(s.ownsEdit("chord-drag:"+d.id)){const result=chordCommand(s.committedRef.current,r.command);if(result.ok){s.invalidateEdit(null,"chord-drag:"+d.id);s.edit(()=>result.document,"Move chord");if(s.finishEdit("chord-drag:"+d.id))s.setSelectedChordId(d.id);}}
    cancel();
  }
  function paletteCard(name:string,notes:number[]):PaletteDrag|null{if(!s.finishEdit())return null;return {kind:"palette",projectId:s.project.id,sectionId:section.id,remainderId:uid(),chord:{id:uid(),sectionId:section.id,tick:0,duration:bar,symbol:name,notes:[...notes]}};}
  const rests:{start:number;end:number}[]=[];let covered=section.startTick;for(const c of chords){if(c.tick>covered)rests.push({start:covered,end:Math.min(c.tick,section.startTick+section.lengthTick)});covered=Math.max(covered,c.tick+c.duration);}if(covered<section.startTick+section.lengthTick)rests.push({start:covered,end:section.startTick+section.lengthTick});
  return <section className="harmony-panel">
    <div className="subheading"><h3>Chord canvas</h3><button className="secondary-button" onClick={onProgression}><Play size={13}/>Audition progression</button></div>
    <div className="canvas-tools"><label>Snap <select aria-label="Chord snap" value={snap} onChange={e=>setSnap(e.target.value as ChordSnap)}><option value="beat">Beat</option><option value="half">Half beat</option><option value="quarter">Quarter beat</option><option value="bar">Bar</option></select></label><span className="tiny">Drop onto a chord to replace it. Drop into a rest to add one bar.</span></div>
    <div className="chord-scroll"><div className="chord-ruler">{Array.from({length:Math.ceil(section.lengthTick/bar)},(_,i)=><button key={i} style={{left:i*bar/section.lengthTick*100+"%"}} onClick={()=>setCursor(i*bar)}>Bar {i+1}</button>)}</div>
    <div ref={lane} className={"chord-lane "+(drag?"accepting-card":"")} aria-label="Editable chord timeline" style={{backgroundSize:bar/section.lengthTick*100+"% 100%"}}
      onDragOver={e=>{const d=dragRef.current;if(d){e.preventDefault();e.dataTransfer.dropEffect=d.kind==="palette"?"copy":"move";hover(d,atX(e.clientX));}}}
      onDrop={e=>{e.preventDefault();const d=dragRef.current;if(d)place(d,atX(e.clientX));}}>
      {Array.from({length:Math.ceil(section.lengthTick/bar)},(_,i)=><button type="button" className={"chord-bar "+(Math.floor(position/bar)===i?"current":"")} key={i} aria-label={"Place at bar "+(i+1)} style={{left:i*bar/section.lengthTick*100+"%",width:Math.min(bar,section.lengthTick-i*bar)/section.lengthTick*100+"%"}} onClick={()=>{setCursor(i*bar);const d=dragRef.current;if(d?.kind==="palette")place(d,section.startTick+i*bar);}}><span>+</span></button>)}
      {rests.map((r,i)=><span className="chord-rest" key={i} style={{left:(r.start-section.startTick)/section.lengthTick*100+"%",width:(r.end-r.start)/section.lengthTick*100+"%"}}>Rest</span>)}
      {chords.map((c,i)=><div className={"chord-card "+(s.selectedChordId===c.id?"selected":"")} key={chords.filter(x=>x.id===c.id).length===1?c.id:c.id+":duplicate:"+i} style={{left:Math.max(0,(c.tick-section.startTick)/section.lengthTick*100)+"%",width:Math.min(c.duration,section.startTick+section.lengthTick-c.tick)/section.lengthTick*100+"%",top:(i>0&&chords[i-1].tick+chords[i-1].duration>c.tick?24:0)}}>
        <button className="chord-handle" draggable aria-label={"Move "+c.symbol+" chord "+(i+1)} onDragStart={e=>{if(!s.beginEdit("chord-drag:"+c.id)){e.preventDefault();return;}e.dataTransfer.setData("text/plain",c.id);e.dataTransfer.effectAllowed="move";startDrag({kind:"move",projectId:s.project.id,id:c.id,sectionId:section.id,remainderId:uid()});}} onDragEnd={cancel}><GripVertical size={14}/></button>
        <button className="chord-select" aria-pressed={selected?.id===c.id} title={c.symbol+" · "+c.duration/beat+" beats"} onClick={()=>{if(s.finishEdit()){s.setSelectedChordId(c.id);setCursor(c.tick-section.startTick);}}}><strong>{c.symbol}</strong><small>{c.duration/beat} beats</small><span>{c.notes.map(n=>noteName(n,s.project.key)).join(" · ")}</span></button>
        <ChordResizeHandle chord={c} grid={grid} bar={bar} beat={beat} sectionLength={section.lengthTick} onError={(message,command)=>{setError(message);setProposal(command??null);}}/>
      </div>)}
      {drag&&<span className={"insertion-marker "+(dropError?"invalid":"")} style={{left:((drop??(section.startTick+position))-section.startTick)/section.lengthTick*100+"%"}}/>}
      {drag?.kind==="palette"&&drop!==null&&<span className={"chord-drop-preview "+(dropError?"invalid":"")} style={{left:(drop-section.startTick)/section.lengthTick*100+"%"}}>{drag.chord.symbol}</span>}
    </div></div>
    {drag&&<p className={"helper "+(dropError?"error":"")} role="status">{dropError??(drop!==null?dropLabel:"Drag into a bar · Escape cancels")}</p>}
    {error&&<div className="action-error" role="alert">{error}{proposal&&<button onClick={()=>apply(proposal)}>Retry proposal</button>}</div>}
    {selected&&<section className="chord-inspector" key={selected.id} aria-label="Chord voicing editor">
      <div className="chord-inspector-heading"><div><span className="eyebrow">Voicing</span><h4>{selected.symbol}<small>{selected.notes.length} notes · {selected.duration/beat} beats</small></h4></div><button className="secondary-button" onClick={()=>void s.audition(selected.notes)}><Play size={13}/>Hear chord</button></div>
      <div className="chord-inspector-fields"><label>Chord symbol<DraftInput aria-label="Selected chord symbol" value={selected.symbol} onChange={e=>{try{const name=e.target.value,pitches=chordNotes(name,s.octave);s.edit(p=>({...p,chords:p.chords.map(c=>c.id===selected.id&&c.sectionId===section.id?{...c,symbol:name,notes:pitches}:c)}),"Edit chord symbol");setError("");}catch{const message="Enter a recognised chord symbol, or press Escape to restore the voicing.";s.invalidateEdit(message);setError(message);}}}/></label><label>Length · beats<DraftInput aria-label="Selected chord duration in beats" type="number" min={grid/beat} step={grid/beat} value={selected.duration/beat} onChange={e=>{const result=chordCommand(s.committedRef.current,{type:"resize",sectionId:section.id,chordId:selected.id,duration:Math.round(Number(e.target.value)*beat)});if(result.ok){s.edit(()=>result.document,"Resize chord");setError("");}else{s.invalidateEdit(result.error);setError(result.error);}}}/></label></div>
      <div className="voicing-notes">{selected.notes.map((n,i)=><div className="voicing-note" key={i}><label>Note<select aria-label={"Chord note "+(i+1)} value={n%12} onChange={e=>notesChanged(selected.notes.map((p,j)=>j===i?p-p%12+Number(e.target.value):p))}>{Array.from({length:12},(_,pc)=><option key={pc} value={pc} disabled={n-n%12+pc>127}>{noteName(pc,s.project.key,false)}</option>)}</select></label><label>Octave<DraftInput aria-label={"Chord note "+(i+1)+" octave"} type="number" min={-1} max={Math.floor((127-n%12)/12)-1} value={Math.floor(n/12)-1} onChange={e=>notesChanged(selected.notes.map((p,j)=>j===i?(Number(e.target.value)+1)*12+p%12:p))}/></label><button className="icon-button" aria-label={"Remove note "+(i+1)} title={"Remove "+noteName(n,s.project.key)} disabled={selected.notes.length<=2} onClick={()=>notesChanged(selected.notes.filter((_,j)=>j!==i))}>×</button></div>)}</div>
      <div className="voicing-actions"><div className="button-group"><button onClick={()=>{const notes=[...selected.notes].sort((a,b)=>a-b);notes.push(notes.shift()!+12);notesChanged(notes);}} disabled={Math.min(...selected.notes)>115}>Next inversion</button><button disabled={Math.min(...selected.notes)<12} onClick={()=>notesChanged(selected.notes.map(n=>n-12))}>Lower voicing</button><button disabled={Math.max(...selected.notes)>115} onClick={()=>notesChanged(selected.notes.map(n=>n+12))}>Raise voicing</button></div><button className="secondary-button" disabled={s.selectedNotes.length<2} onClick={()=>replace(recognizeChords(s.selectedNotes,s.project.key)[0]?.symbol??"Custom",[...s.selectedNotes])}>Use played notes</button></div>
      <details className="chord-detail-actions"><summary>More chord options</summary><div className="button-row"><button className="secondary-button" disabled={selected.notes.length>=12||selected.notes.at(-1)!>115} onClick={()=>notesChanged([...selected.notes,selected.notes.at(-1)!+12])}>Double top note</button><button className="secondary-button" onClick={()=>moveStep(-1)}>Move earlier</button><button className="secondary-button" onClick={()=>moveStep(1)}>Move later</button><button className="secondary-button" onClick={()=>apply({type:"remove",sectionId:section.id,chordId:selected.id})}>Remove · leave rest</button><button className="secondary-button" onClick={()=>apply({type:"deleteTime",sectionId:section.id,chordId:selected.id})}>Delete time · shift later</button></div><div className="voicing-midi">{selected.notes.map((n,i)=><label key={i}>Note {i+1} · MIDI<DraftInput aria-label={"Chord note "+(i+1)+" MIDI pitch"} type="number" min={0} max={127} value={n} onChange={e=>notesChanged(selected.notes.map((p,j)=>j===i?Math.round(Number(e.target.value)):p))}/></label>)}</div></details>
    </section>}
    <div className="subheading spaced"><h3>Where could it go?</h3><span className="tiny">Click to hear · drag into a bar</span></div>
    <div className="compact-suggestions">{suggestions.map(c=><ChordPaletteCard key={c.symbol} name={c.symbol} notes={c.notes} detail={c.common.length+" shared · "+c.movement+" steps"} laneRef={lane} grid={grid} bar={bar} start={section.startTick} end={section.startTick+section.lengthTick} initialTick={section.startTick+position} onPrepare={paletteCard} onStart={startDrag} onHover={hover} onPlace={place} onCancel={cancel} onHear={notes=>void s.audition(notes)} toTick={atX}/> )}</div>
    <details className="custom-chord-cards"><summary>Custom chord card</summary><div><label>Chord symbol <input aria-label="New chord symbol" value={symbol} onChange={e=>setSymbol(e.target.value)} placeholder="Dm9, Fmaj7, C/E…"/></label>{customNotes.length?<ChordPaletteCard name={symbol} notes={customNotes} detail={"1 bar · "+customNotes.map(n=>noteName(n,s.project.key,false)).join(" · ")} laneRef={lane} grid={grid} bar={bar} start={section.startTick} end={section.startTick+section.lengthTick} initialTick={section.startTick+position} onPrepare={paletteCard} onStart={startDrag} onHover={hover} onPlace={place} onCancel={cancel} onHear={notes=>void s.audition(notes)} toTick={atX}/>:<span role="status">Enter a recognised chord symbol.</span>}</div></details>
    <p className="helper palette-keyboard">Keyboard: focus a card, D to pick up, arrows to position, Enter to drop.</p>
    <Range label="Harmonic tension" value={tension} onChange={setTension}/>
  </section>;
}
