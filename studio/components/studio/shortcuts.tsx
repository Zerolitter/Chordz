"use client";
import { useEffect,useLayoutEffect,useRef,useState } from "react";
import { Keyboard,Square } from "lucide-react";
import { useStudio } from "./use-studio";
import { Modal } from "./primitives";
import { ACTION_LABELS,DEFAULT_SHORTCUTS,PIANO_CODES,STOP_BINDING,bindingError,bindingLabel,eventBinding,readShortcuts,sameBinding,type ShortcutAction,type ShortcutPreferences } from "../../lib/client/shortcuts";

export function Shortcuts(){
  const s=useStudio(),[open,setOpen]=useState(false),[prefs,setPrefs]=useState<ShortcutPreferences>(DEFAULT_SHORTCUTS),[capture,setCapture]=useState<ShortcutAction|null>(null),[error,setError]=useState("");
  const current=useRef({s,prefs,capture,open});const pressed=useRef(new Map<string,number>());
  useLayoutEffect(()=>{current.current={s,prefs,capture,open};});
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active){try{setPrefs(readShortcuts(localStorage.getItem("chordz-shortcuts-v1")));}catch{setError("Shortcut storage is unavailable; defaults remain active.");}}});return()=>{active=false;};},[]);
  function save(next:ShortcutPreferences){setPrefs(next);try{localStorage.setItem("chordz-shortcuts-v1",JSON.stringify(next));}catch{setError("Shortcut storage is unavailable; these preferences last for this session.");}s.releaseSource("computer:");pressed.current.clear();}
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{
      const {s,prefs,capture}=current.current;
      if(capture){e.preventDefault();e.stopPropagation();if(e.isComposing||e.repeat)return;if(e.code==="Escape"){setCapture(null);setError("");return;}
        const b=eventBinding(e),problem=bindingError(capture,b,prefs);if(problem){setError(problem);return;}
        const next={...prefs,bindings:{...prefs.bindings,[capture]:b}};setPrefs(next);setError("");try{localStorage.setItem("chordz-shortcuts-v1",JSON.stringify(next));}catch{setError("Shortcut storage is unavailable; this binding lasts for this session.");}setCapture(null);return;}
      if(e.isComposing||e.repeat)return;
      const b=eventBinding(e),target=e.target as HTMLElement;
      const typing=!!target.closest('input,textarea,select,[contenteditable="true"]');
      const nativeControl=!!target.closest('button,[role="button"],[role="slider"]');
      const nativeActivation=nativeControl&&(e.code==="Space"||e.code==="Enter")&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey;
      if(sameBinding(STOP_BINDING,b)){e.preventDefault();s.stop();return;}
      if(e.code==="Escape"){
        if(e.defaultPrevented)return;
        if(target.closest('[role="dialog"],[data-state="open"]'))return;
        if(s.cancelEdit()){e.preventDefault();return;}
        s.stop();return;
      }
      const action=(Object.keys(prefs.bindings) as ShortcutAction[]).find(key=>sameBinding(prefs.bindings[key],b));
      if(action && (action==="save"||(!typing&&!nativeActivation&&!target.closest('[role="dialog"]')))){
        e.preventDefault();if(!s.hydrated)return;
        if(action==="save")void s.saveNow();else if(action==="stop")s.stop();else if(action==="undo"||action==="redo")s.dispatch({type:action});
        else if(action==="record")void s.beginRecording();else if(action==="togglePlay")void s.play();
        else if(action==="play"){if(!s.engine?.state.playing)void s.play();}else if(action==="pause"){if(!s.recording)s.engine?.pause();}
        else if(s.mode==="write")void s.writingActions.current?.[action]?.();
        return;
      }
      if(typing||nativeControl||target.closest('[role="dialog"]')||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||s.busy)return;
      const offset=PIANO_CODES[e.code];if(offset===undefined)return;
      e.preventDefault();const pitch=(s.octave+1)*12+offset;pressed.current.set(e.code,pitch);void s.noteOn(pitch,.75,"computer:"+e.code);
    };
    const up=(e:KeyboardEvent)=>{if(e.code==="Enter"||e.code==="Space")current.current.s.releaseHeld("button:"+e.code+":");const pitch=pressed.current.get(e.code);if(pitch!==undefined){current.current.s.noteOff(pitch,"computer:"+e.code);pressed.current.delete(e.code);}};
    const blur=()=>{current.current.s.releaseSource("computer:");current.current.s.releaseSource("button:");current.current.s.releaseSource("pointer:");pressed.current.clear();};
    // Capture consumes keys before dialog handlers. Ordinary dispatch bubbles after local editors.
    const capturing=(e:KeyboardEvent)=>{if(current.current.capture)down(e);};
    window.addEventListener("keydown",capturing,true);window.addEventListener("keydown",down);window.addEventListener("keyup",up,true);window.addEventListener("blur",blur);
    return()=>{blur();window.removeEventListener("keydown",capturing,true);window.removeEventListener("keydown",down);window.removeEventListener("keyup",up,true);window.removeEventListener("blur",blur);};
  },[]);
  return <><button className="secondary-button" onClick={()=>setOpen(true)} aria-label="Keyboard shortcuts"><Keyboard size={16}/><span>Shortcuts</span></button>
    <Modal open={open} onClose={()=>{setOpen(false);setCapture(null);setError("");}} title="Keyboard shortcuts" description="Saved in this browser. Stop all sound remains available while typing.">
      <button className="secondary-button" data-edit-policy="bypass" onClick={s.stop}><Square size={14}/>Stop all sound</button>
      <details open><summary>Transport and editing bindings</summary><div className="shortcut-list">{(Object.keys(ACTION_LABELS) as ShortcutAction[]).map(action=><div className="shortcut-row" key={action}><span>{ACTION_LABELS[action]}</span><button className="secondary-button" disabled={action==="stop"} onClick={()=>{setCapture(action);setError("");s.releaseSource("computer:");}}>{capture===action?"Press shortcut · Esc cancels":bindingLabel(prefs.bindings[action])}</button>{action!=="stop"&&<button className="text-button" aria-label={"Clear "+ACTION_LABELS[action]+" shortcut"} onClick={()=>save({...prefs,bindings:{...prefs.bindings,[action]:null}})}>Clear</button>}</div>)}</div></details>
      {error&&<p role="alert">{error}</p>}<button className="secondary-button" onClick={()=>{save(structuredClone(DEFAULT_SHORTCUTS));setCapture(null);setError("");}}>Reset shortcuts</button>
    </Modal></>;
}
