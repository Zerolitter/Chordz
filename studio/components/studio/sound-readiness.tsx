"use client";
import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {useStudio} from "./use-studio";
import {instrumentFor} from "../../lib/audio/catalog";
import {useToolVisibility} from "./tool-visibility";
export function SoundReadiness(){
  const s=useStudio(),track=s.selectedTrack,[status,setStatus]=useState<{state:string;error?:string}>({state:"unloaded"});
  const active=useToolVisibility();
  const id=track?.id,instrumentId=track?.instrumentId,identity=JSON.stringify([s.project.id,id,instrumentId]);
  const latest=useRef(identity);useLayoutEffect(()=>{latest.current=identity;},[identity]);
  useEffect(()=>{if(!active||!s.engine||!id)return;return s.engine.subscribe(()=>{const next=s.engine!.instrumentReadiness(id);setStatus(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);});},[active,s.engine,id,instrumentId]);
  if(!track||track.kind!=="instrument")return null;
  const instrument=instrumentFor(s.project,track),state=status.state==="failed"?"failed":s.engine?status.state:instrument.zones.length?"unloaded":"ready";
  return <div className={"sound-readiness "+state} role="status"><span>{state==="unloaded"?"Samples not downloaded":state==="loading"?"Downloading and decoding…":state==="failed"?"Sound unavailable":"Sound ready"}</span>{status.error&&state==="failed"&&<small>{status.error}</small>}{(state==="unloaded"||state==="failed")&&<button className="text-button" disabled={s.recording} onClick={async()=>{try{const engine=await s.getEngine();await engine.ensureBuffers(s.project,[track.id]);}catch(error){if(latest.current===identity)setStatus({state:"failed",error:error instanceof Error?error.message:"The sound could not load. Retry."});}}}>{state==="failed"?"Retry sound":"Load sound"}</button>}</div>;
}
