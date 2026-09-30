"use client";
import {useId,useRef,useState,type InputHTMLAttributes,type TextareaHTMLAttributes} from "react";
import {useStudio} from "./use-studio";
export function DraftInput(props:InputHTMLAttributes<HTMLInputElement>){
  if(props.type==="range")return <BufferedRange {...props}/>;
  if(["checkbox","radio","file"].includes(props.type??""))return <input {...props}/>;
  return <BufferedInput {...props}/>;
}
function BufferedRange(props:InputHTMLAttributes<HTMLInputElement>){
  const s=useStudio(),id=useId(),gesture=useRef(false);
  return <input {...props} onPointerDown={e=>{gesture.current=true;s.beginEdit(id);props.onPointerDown?.(e);}} onPointerUp={e=>{gesture.current=false;s.finishEdit(id);props.onPointerUp?.(e);}} onPointerCancel={e=>{gesture.current=false;s.cancelEdit(id);props.onPointerCancel?.(e);}} onChange={e=>{if(s.ownsEdit(id)||!gesture.current&&s.beginEdit(id))props.onChange?.(e);}} onKeyDown={e=>{if(e.key.startsWith("Arrow")||["Home","End","PageUp","PageDown"].includes(e.key)){if(!gesture.current){gesture.current=true;s.beginEdit(id);}}if(e.key==="Escape"){e.preventDefault();e.stopPropagation();s.cancelEdit(id);}props.onKeyDown?.(e);}} onKeyUp={e=>{if(e.key.startsWith("Arrow")||["Home","End","PageUp","PageDown"].includes(e.key)){gesture.current=false;s.finishEdit(id);}props.onKeyUp?.(e);}}/>;
}
function BufferedInput(props:InputHTMLAttributes<HTMLInputElement>){
  const s=useStudio(),id=useId(),[raw,setRaw]=useState<string|null>(null);
  return <input {...props} value={raw!==null&&s.transaction?.owner===id?raw:props.value} onFocus={e=>{if(!s.ownsEdit(id)&&s.beginEdit(id))setRaw(null);props.onFocus?.(e);}} onChange={e=>{
    if(!s.ownsEdit(id)&&!s.beginEdit(id))return;
    const value=e.target.value;setRaw(value);
    if(props.type==="number"&&(value.trim()===""||!Number.isFinite(Number(value))||(props.min!==undefined&&Number(value)<Number(props.min))||(props.max!==undefined&&Number(value)>Number(props.max)))){s.invalidateEdit("Enter a valid value for "+(props["aria-label"]??"this field")+", or press Escape to restore it.",id);return;}
    s.invalidateEdit(null,id);props.onChange?.(e);
  }} onBlur={e=>{if(s.finishEdit(id))setRaw(null);props.onBlur?.(e);}} onKeyDown={e=>{
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();s.cancelEdit(id);setRaw(null);}
    if(e.key==="Enter"&&!e.nativeEvent.isComposing){if(s.finishEdit(id)){setRaw(null);e.currentTarget.blur();}else e.preventDefault();}
    props.onKeyDown?.(e);
  }}/>;
}
export function DraftTextarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>){
  const s=useStudio(),id=useId();
  return <textarea {...props} onChange={e=>{if(s.ownsEdit(id)||s.beginEdit(id)){s.invalidateEdit(null,id);props.onChange?.(e);}}} onFocus={e=>{s.beginEdit(id);props.onFocus?.(e);}} onBlur={e=>{s.finishEdit(id);props.onBlur?.(e);}} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();s.cancelEdit(id);}props.onKeyDown?.(e);}}/>;
}
