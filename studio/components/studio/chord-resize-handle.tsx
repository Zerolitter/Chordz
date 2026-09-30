"use client";
import {useEffect,useEffectEvent,useRef} from "react";
import {MoveHorizontal} from "lucide-react";
import {chordCommand, type ChordCommand} from "../../lib/music/chord-commands";
import type {ChordEvent} from "../../lib/music/types";
import {useStudio} from "./use-studio";

export function ChordResizeHandle({chord,grid,bar,beat,sectionLength,onError}:{chord:ChordEvent;grid:number;bar:number;beat:number;sectionLength:number;onError:(error:string,command?:ChordCommand)=>void}){
  const s=useStudio(),gesture=useRef<{owner:string;x:number;duration:number;desired:number;scale:number;invalid:string|null;pointer:boolean}|null>(null),blocked=useRef(false);
  function begin(x:number,scale:number,pointer:boolean){
    if(blocked.current)return false;
    const owner="chord-resize:"+chord.id;if(!s.beginEdit(owner))return false;
    gesture.current={owner,x,duration:chord.duration,desired:chord.duration,scale,invalid:null,pointer};s.setSelectedChordId(chord.id);return true;
  }
  function preview(duration:number){
    const g=gesture.current;if(!g||!s.ownsEdit(g.owner))return;
    g.desired=Math.max(grid,Math.round(duration/grid)*grid);
    const command:ChordCommand={type:"resize",sectionId:chord.sectionId,chordId:chord.id,duration:g.desired};
    const result=chordCommand(s.committedRef.current,command);g.invalid=result.ok?null:result.error;
    s.invalidateEdit(g.invalid,g.owner);
    if(result.ok){s.edit(()=>result.document,"Resize chord");onError("");}else onError(result.error,command);
  }
  function finish(){const g=gesture.current;gesture.current=null;if(!g||!s.ownsEdit(g.owner))return;if(g.invalid)s.cancelEdit(g.owner);else s.finishEdit(g.owner);}
  function cancel(){const g=gesture.current;gesture.current=null;if(g)s.cancelEdit(g.owner);}
  const cancelPointer=useEffectEvent(()=>{if(!gesture.current?.pointer)return false;cancel();return true;});
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&cancelPointer()){e.preventDefault();e.stopPropagation();}};window.addEventListener("keydown",escape,true);return()=>window.removeEventListener("keydown",escape,true);},[]);
  return <button type="button" className="chord-resize" role="slider" aria-label={"Resize "+chord.symbol+" chord"} aria-valuemin={grid/beat} aria-valuemax={sectionLength/beat} aria-valuenow={chord.duration/beat} aria-valuetext={chord.duration/beat+" beats"} title="Drag the end to change length · arrow keys adjust, Shift adjusts a bar"
    onPointerDown={e=>{e.preventDefault();e.stopPropagation();const lane=e.currentTarget.closest(".chord-lane")!.getBoundingClientRect();if(begin(e.clientX,lane.width/sectionLength,true))e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const g=gesture.current;if(g?.pointer)preview(g.duration+(e.clientX-g.x)/g.scale);}}
    onPointerUp={e=>{e.preventDefault();e.stopPropagation();finish();}}
    onPointerCancel={cancel} onLostPointerCapture={()=>{if(gesture.current?.pointer)cancel();}}
    onKeyDown={e=>{if(e.key==="Escape"&&gesture.current){e.preventDefault();e.stopPropagation();blocked.current=true;cancel();return;}if(!["ArrowLeft","ArrowRight"].includes(e.key))return;e.preventDefault();e.stopPropagation();if(!gesture.current&&(e.repeat||!begin(0,1,false)))return;const g=gesture.current;if(g&&!g.pointer)preview(g.desired+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?bar:grid));}}
    onKeyUp={e=>{if(["ArrowLeft","ArrowRight"].includes(e.key)){e.stopPropagation();if(gesture.current&&!gesture.current.pointer)finish();blocked.current=false;}}}
    onBlur={()=>{if(gesture.current&&!gesture.current.pointer)finish();}}><MoveHorizontal size={12}/></button>;
}
