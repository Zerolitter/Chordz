"use client";
import {useRef,type RefObject} from "react";
import {GripVertical} from "lucide-react";
import type {ChordEvent} from "../../lib/music/types";

export type PaletteDrag={kind:"palette";projectId:string;sectionId:string;chord:ChordEvent;remainderId:string;input?:"keyboard"};
export function ChordPaletteCard({name,notes,detail,laneRef,grid,bar,start,end,initialTick,onPrepare,onStart,onHover,onPlace,onCancel,onHear,toTick}:{
  name:string;notes:number[];detail:string;laneRef:RefObject<HTMLDivElement|null>;grid:number;bar:number;start:number;end:number;initialTick:number;
  onPrepare:(name:string,notes:number[])=>PaletteDrag|null;onStart:(card:PaletteDrag)=>void;onHover:(card:PaletteDrag,tick:number)=>void;onPlace:(card:PaletteDrag,tick:number)=>void;onCancel:()=>void;onHear:(notes:number[])=>void;toTick:(x:number)=>number;
}){
  const suppress=useRef(0),keyboard=useRef<{card:PaletteDrag;tick:number}|null>(null),touch=useRef<{x:number;y:number;started:boolean;card:PaletteDrag}|null>(null);
  function finishDrag(){suppress.current=Date.now()+300;keyboard.current=null;touch.current=null;onCancel();}
  return <button type="button" className="suggestion-card" draggable={false} aria-label={"Chord card "+name} title="Click to hear · drag into a bar · D to place with the keyboard"
    onClick={()=>{if(Date.now()>suppress.current)onHear(notes);}}
    onKeyDown={e=>{
      if(e.key.toLowerCase()==="d"&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();e.stopPropagation();const prepared=onPrepare(name,notes);if(prepared){const card:PaletteDrag={...prepared,input:"keyboard"};keyboard.current={card,tick:initialTick};onStart(card);onHover(card,initialTick);}return;}
      const g=keyboard.current;if(!g)return;
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();finishDrag();}
      else if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();e.stopPropagation();g.tick=Math.max(start,Math.min(end-grid,g.tick+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?bar:grid)));onHover(g.card,g.tick);}
      else if(e.key==="Enter"&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();e.stopPropagation();onPlace(g.card,g.tick);suppress.current=Date.now()+300;keyboard.current=null;}
    }}
    onPointerDown={e=>{if(e.button!==0)return;const card=onPrepare(name,notes);if(card){touch.current={x:e.clientX,y:e.clientY,started:false,card};e.currentTarget.setPointerCapture(e.pointerId);}}}
    onPointerMove={e=>{const g=touch.current;if(!g)return;if(!g.started&&Math.hypot(e.clientX-g.x,e.clientY-g.y)>8){g.started=true;onStart(g.card);}const box=laneRef.current?.getBoundingClientRect();if(g.started&&box&&e.clientX>=box.left&&e.clientX<=box.right&&e.clientY>=box.top&&e.clientY<=box.bottom)onHover(g.card,toTick(e.clientX));}}
    onPointerUp={e=>{const g=touch.current;if(g?.started){e.preventDefault();const box=laneRef.current?.getBoundingClientRect();if(box&&e.clientX>=box.left&&e.clientX<=box.right&&e.clientY>=box.top&&e.clientY<=box.bottom)onPlace(g.card,toTick(e.clientX));else onCancel();suppress.current=Date.now()+300;}touch.current=null;}}
    onPointerCancel={finishDrag} onLostPointerCapture={()=>{if(touch.current?.started)finishDrag();}} onBlur={()=>{if(keyboard.current)finishDrag();}}><span className="suggestion-heading"><strong>{name}</strong><GripVertical size={13}/></span><small>{detail}</small></button>;
}
