"use client";
import {useEffect,useRef,useState} from "react";
/** Small browser preferences stay outside the versioned musical document. */
export function usePreference<T>(key:string,initial:T,valid:(value:unknown)=>value is T){
  const [value,setValue]=useState(initial),ready=useRef(false),validate=useRef(valid);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(!active)return;try{const stored=JSON.parse(localStorage.getItem("chordz-ui-v1:"+key)??"null");if(stored?.version===1&&validate.current(stored.value))setValue(stored.value);}catch{/* Defaults remain usable. */}ready.current=true;});return()=>{active=false;};},[key]);
  useEffect(()=>{if(!ready.current)return;try{localStorage.setItem("chordz-ui-v1:"+key,JSON.stringify({version:1,value}));}catch{/* Music recovery has its own visible storage status. */}},[key,value]);
  return [value,setValue] as const;
}
export const numericPreference=(min:number,max:number)=>(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>=min&&value<=max;
