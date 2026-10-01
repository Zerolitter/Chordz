"use client";
import {useEffect,useEffectEvent,useLayoutEffect,useRef,useState} from "react";
import {createProject,createTrack,emptyClip,secondsToTick} from "../../lib/music/project";
import {uid,PPQ,type ProjectDocument} from "../../lib/music/types";
import {isDrumInstrument} from "../../lib/audio/catalog";
import type {StudioEngine} from "../../lib/audio/engine";
import {applyLibraryEntry,createPhraseEntry,createSoundEntry,libraryEntrySchema,materializeLibraryEntry,type LibraryAction,type LibraryEntry} from "../../lib/music/reusable-library";
import {acquireLibraryEntry,deleteLibraryEntry,listLibrary,markLibraryRecent,readLibraryPreferences,saveLibraryEntry,setLibraryFavorite,type LibraryLease,type LibraryPreferences,type LibrarySnapshot} from "../../lib/client/reusable-library-storage";
import {exportLibraryArchive,importLibraryArchive} from "../../lib/client/library-archive";
import {activateProjectAssets,discardProjectAssets,resolveAsset,stageProjectAssets} from "../../lib/client/storage";
import {LibraryTargetRevisions,type LibraryDestination} from "../../lib/client/library-operations";

interface LibraryContext {
  owner:string;project:ProjectDocument;hydrated:boolean;
  document():ProjectDocument;currentOwner():string;destination():LibraryDestination;
  revisions:LibraryTargetRevisions;finishEdit():boolean;hasDraft():boolean;recording():boolean;
  commit(document:ProjectDocument,label:string):boolean;select(trackId:string,clipId?:string):void;
  getEngine():Promise<StudioEngine>;notify(message:string):void;
}
const emptyPreferences=():LibraryPreferences=>({version:1,favorites:[],recents:[]});
type UseResult={ok:boolean;error?:string;overlap?:boolean;soundConflict?:boolean;reasons?:string[]};
function download(bytes:Uint8Array,name:string){
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"application/zip"}));
  const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function useReusableLibrary(context:LibraryContext){
  const current=useRef(context);
  useLayoutEffect(()=>{current.current=context;});
  const [state,setState]=useState({owner:context.owner,entries:[] as LibraryEntry[],preferences:emptyPreferences(),ready:false,error:""});
  const [busy,setBusy]=useState({owner:context.owner,label:""});
  const request=useRef(0),job=useRef<{id:string;owner:string;abort:AbortController}|null>(null);
  const mounted=useRef(true);
  const preview=useRef<{id:string;owner:string;intent:number;lease?:LibraryLease;unsubscribe?:()=>void;engine?:StudioEngine}|null>(null),previewIntent=useRef(0);
  function fail(error:unknown,owner=context.owner){if(mounted.current&&current.current.currentOwner()===owner)setState(value=>({...value,owner,error:error instanceof Error?error.message:String(error)}));}
  async function refreshLibrary(){
    const owner=current.current.currentOwner(),token=++request.current;
    try{
      const [entries,preferences]=await Promise.all([listLibrary(owner),readLibraryPreferences(owner)]);
      if(!mounted.current||current.current.currentOwner()!==owner||token!==request.current)return false;
      setState({owner,entries,preferences,ready:true,error:""});return true;
    }catch(error){if(mounted.current&&current.current.currentOwner()===owner&&token===request.current){setState(value=>({...value,owner,ready:true,error:error instanceof Error?error.message:String(error)}));}return false;}
  }
  function cancelLibraryPreview(){
    ++previewIntent.current;const value=preview.current;preview.current=null;
    value?.unsubscribe?.();value?.engine?.cancelCandidateAudition();
    if(value?.lease)void value.lease.release().catch(error=>fail(error,value.owner));
  }
  function cancelLibraryOperation(){
    const value=job.current;job.current=null;value?.abort.abort();
    if(value)setBusy({owner:value.owner,label:""});
  }
  const ownerChanged=useEffectEvent(()=>{cancelLibraryOperation();cancelLibraryPreview();});
  useLayoutEffect(()=>{ownerChanged();},[context.owner]);
  useEffect(()=>{void refreshLibrary();},[context.owner]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;job.current?.abort.abort();const value=preview.current;value?.unsubscribe?.();value?.engine?.cancelCandidateAudition();if(value?.lease)void value.lease.release();};},[]);
  function begin(label:string){cancelLibraryOperation();const value={id:uid(),owner:current.current.currentOwner(),abort:new AbortController()};job.current=value;setBusy({owner:value.owner,label});return value;}
  function active(value:NonNullable<typeof job.current>){return mounted.current&&job.current===value&&!value.abort.signal.aborted&&current.current.currentOwner()===value.owner;}
  function end(value:NonNullable<typeof job.current>){if(job.current===value){job.current=null;if(mounted.current)setBusy({owner:value.owner,label:""});}}
  async function source(entry:LibraryEntry,owner:string):Promise<LibrarySnapshot&{release:()=>Promise<void>}>{
    // Saved/imported identities are fresh UUIDs. Only explicit factory/idea candidates
    // may resolve from the song catalog; a deleted saved proposal cannot fall back.
    if(!entry.id.startsWith("factory_")&&!entry.id.startsWith("idea_")){
      const stored=await acquireLibraryEntry(owner,entry.id);if(!stored)throw Error("This library item was removed. Choose another item.");return stored;
    }
    const captured=structuredClone(libraryEntrySchema.parse(entry)),blobs=new Map<string,Blob>();
    await Promise.all(captured.assets.map(async asset=>{blobs.set(asset.id,await resolveAsset(owner,asset.id));}));
    return {entry:captured,blobs,release:async()=>{}};
  }
  async function toggleLibraryFavorite(id:string){
    const owner=current.current.currentOwner();
    try{const preferences=await readLibraryPreferences(owner);await setLibraryFavorite(owner,id,!preferences.favorites.includes(id));return await refreshLibrary();}catch(error){fail(error,owner);return false;}
  }
  async function saveSelected(kind:"sound"|"phrase",name:string){
    const ctx=current.current;
    if(ctx.recording()||!ctx.finishEdit())return false;
    const doc=ctx.document(),destination=ctx.destination(),track=doc.tracks.find(t=>t.id===destination.trackId),clip=track?.clips.find(c=>c.id===destination.clipId);
    if(!track||(kind==="sound"&&track.kind!=="instrument")||(kind==="phrase"&&!clip)){fail(Error(kind==="sound"?"Choose an instrument track to save its sound.":"Select a phrase to save."));return false;}
    const value=begin("Saving to library…");
    let saved:LibraryEntry|undefined;
    try{
      const entry=kind==="sound"?createSoundEntry(doc,track,name):createPhraseEntry(doc,track,clip!,name),blobs=new Map<string,Blob>();
      await Promise.all(entry.assets.map(async asset=>{blobs.set(asset.id,await resolveAsset(value.owner,asset.id));}));
      if(!active(value))return false;
      saved=await saveLibraryEntry(value.owner,entry,blobs,{signal:value.abort.signal});
      if(!active(value)){await deleteLibraryEntry(value.owner,saved.id);return false;}
      await refreshLibrary();if(!active(value))return false;current.current.notify("Saved in your device library.");return true;
    }catch(error){if(active(value))fail(error,value.owner);return false;}finally{end(value);}
  }
  async function removeLibraryEntry(id:string){
    const value=begin("Removing library item…");
    try{await deleteLibraryEntry(value.owner,id);if(!active(value))return false;return await refreshLibrary();}catch(error){if(active(value))fail(error,value.owner);return false;}finally{end(value);}
  }
  async function exportLibrary(){
    const value=begin("Preparing library backup…");
    try{const bytes=await exportLibraryArchive(value.owner);if(!active(value))return false;download(bytes,"Chordz library.chordz-library.zip");return true;}catch(error){if(active(value))fail(error,value.owner);return false;}finally{end(value);}
  }
  async function importLibrary(file:File){
    const value=begin("Importing library…");
    try{
      if(file.size>512*1024*1024)throw Error("This library archive exceeds the 512 MB limit.");
      const bytes=new Uint8Array(await file.arrayBuffer());if(!active(value))return false;
      const entries=await importLibraryArchive(value.owner,bytes,{signal:value.abort.signal});
      if(!active(value))return false;await refreshLibrary();if(!active(value))return false;current.current.notify(`Imported ${entries.length} library items as independent copies.`);return true;
    }catch(error){if(active(value))fail(error,value.owner);return false;}finally{end(value);}
  }
  async function useLibraryEntry(candidate:LibraryEntry,action:LibraryAction):Promise<UseResult>{
    const ctx=current.current;
    if(!ctx.hydrated||ctx.recording()||!ctx.finishEdit())return {ok:false,error:"Finish or cancel the current edit or recording first."};
    const value=begin("Preparing insertion…"),doc=ctx.document(),destination=ctx.destination(),token=ctx.revisions.capture(doc,destination);
    const valid=()=>active(value)&&!current.current.recording()&&!current.current.hasDraft()&&current.current.revisions.matches(current.current.document(),token)&&
      JSON.stringify(current.current.destination())===JSON.stringify(destination);
    let lease:Awaited<ReturnType<typeof source>>|undefined,staged=false,committed=false;
    try{
      lease=await source(structuredClone(candidate),value.owner);
      if(!valid())return {ok:false,error:"The insertion destination changed. Your proposal is kept; choose its destination and try again."};
      const materialized=materializeLibraryEntry(lease.entry),proposal=applyLibraryEntry(current.current.document(),materialized.entry,destination,action);
      if(!proposal.ok)return proposal;
      const required=new Set(proposal.document.assets.filter(asset=>!doc.assets.some(prior=>prior.id===asset.id)).map(asset=>asset.id));
      const copies=materialized.entry.assets.filter(asset=>required.has(asset.id)).map(asset=>{
        const original=Object.keys(materialized.assetIds).find(id=>materialized.assetIds[id]===asset.id)!,blob=lease!.blobs.get(original);
        if(!blob)throw Error("A library audio file is missing. Restore its library backup.");
        return {owner:value.owner,projectId:doc.id,asset,blob};
      });
      if(copies.length){await stageProjectAssets(value.owner,doc.id,value.id,copies);staged=true;}
      // Recheck after all asynchronous work; latest unrelated edits remain in this document.
      if(!valid())return {ok:false,error:"The insertion destination changed. Your proposal is kept; choose its destination and try again."};
      const latest=current.current.document(),result=applyLibraryEntry(latest,materialized.entry,destination,action);
      if(!result.ok)return result;
      if(!valid()||!current.current.commit(result.document,`Library ${action}: ${candidate.name}`))return {ok:false,error:"The insertion was not committed. Your proposal is kept."};
      // No await separates the last validation, checked commit and upload eligibility.
      committed=true;
      const promotion=staged?activateProjectAssets(value.owner,value.id):Promise.resolve();
      end(value);current.current.select(result.trackId,result.clipId);
      let warning="";
      try{await promotion;}catch(error){warning=error instanceof Error?error.message:String(error);fail(error,value.owner);}
      try{await markLibraryRecent(value.owner,candidate.id);if(current.current.currentOwner()===value.owner)await refreshLibrary();}catch(error){warning=error instanceof Error?error.message:String(error);fail(error,value.owner);}
      if(current.current.currentOwner()===value.owner&&current.current.document().id===doc.id)current.current.notify(warning?`Inserted. ${warning}`:`Inserted ${candidate.name}.`);
      return {ok:true};
    }catch(error){if(active(value))fail(error,value.owner);return {ok:false,error:error instanceof Error?error.message:String(error)};}
    finally{
      if(staged&&!committed)try{await discardProjectAssets(value.owner,value.id);}catch(error){fail(error,value.owner);}
      if(lease)try{await lease.release();}catch(error){fail(error,value.owner);}end(value);
    }
  }
  async function previewLibraryEntry(candidate:LibraryEntry):Promise<boolean>{
    const ctx=current.current;
    if(ctx.recording()||!ctx.finishEdit())return false;
    cancelLibraryPreview();
    const value={id:candidate.id,owner:ctx.currentOwner(),intent:++previewIntent.current,lease:undefined as LibraryLease|undefined,unsubscribe:undefined as (()=>void)|undefined,engine:undefined as StudioEngine|undefined};preview.current=value;
    const owner=ctx.currentOwner(),documentId=ctx.document().id;
    const valid=()=>mounted.current&&preview.current===value&&previewIntent.current===value.intent&&current.current.currentOwner()===owner&&current.current.document().id===documentId&&!current.current.recording();
    let lease:Awaited<ReturnType<typeof source>>|undefined;
    try{
      lease=await source(structuredClone(candidate),owner);if(!valid())return false;
      const materialized=materializeLibraryEntry(lease.entry),entry=materialized.entry,doc=createProject("Library preview"),track=createTrack(entry.sound.instrument.id,entry.name,undefined,entry.kind==="audio"?"audio":"instrument");
      const {instrument:manifest,...settings}=entry.sound;Object.assign(track,settings,{instrumentId:manifest.id});
      const clip=entry.clip?structuredClone(entry.clip):emptyClip(0,PPQ*4,"Preview");
      clip.startTick=0;if(entry.kind==="audio"){clip.lengthTick=Math.max(1,secondsToTick(entry.visibleDurationSec!,ctx.document().tempo));clip.sourceLengthTick=clip.lengthTick;}
      if(entry.kind==="sound")clip.notes=(entry.refinement&&entry.sound.instrument.kind==="sample"?[entry.sound.instrument.zones[0]?.root??60]:isDrumInstrument(entry.sound.instrument)?[36,38,42]:[60,64,67]).map(pitch=>({id:uid(),pitch,tick:0,duration:PPQ*2,velocity:.65}));
      track.clips=[clip];doc.tempo=ctx.document().tempo;doc.seed=ctx.document().seed;doc.master=structuredClone(ctx.document().master);doc.tracks=[track];doc.assets=entry.assets;doc.userInstruments=[entry.sound.instrument];doc.sections=[{...doc.sections[0],startTick:0,lengthTick:clip.lengthTick}];doc.chords=[];
      const audio=await ctx.getEngine();value.engine=audio;if(!valid())return false;
      const identity="library_"+candidate.id,started=await audio.previewSnapshot(doc,async id=>{
        const original=Object.keys(materialized.assetIds).find(sourceId=>materialized.assetIds[sourceId]===id),blob=original?lease!.blobs.get(original):undefined;
        if(!blob)throw Error("This library audio file is unavailable.");return blob;
      },identity);
      if(!valid()||!started)return false;
      value.lease=lease;lease=undefined;
      value.unsubscribe=audio.subscribe(state=>{if(state.previewId!==identity&&preview.current===value)cancelLibraryPreview();});
      try{await markLibraryRecent(owner,candidate.id);if(valid())await refreshLibrary();}
      catch(error){if(valid())fail(error,owner);}
      return true;
    }catch(error){if(valid()){fail(error,owner);cancelLibraryPreview();}return false;}
    finally{if(lease)await lease.release();}
  }
  return {libraryEntries:state.owner===context.owner?state.entries:[],libraryPreferences:state.owner===context.owner?state.preferences:emptyPreferences(),libraryReady:state.owner===context.owner&&state.ready,
    libraryError:state.owner===context.owner?state.error:"",libraryBusy:busy.owner===context.owner?busy.label:"",refreshReusableLibrary:refreshLibrary,toggleLibraryFavorite,
    saveSelectedSound:(name:string)=>saveSelected("sound",name),saveSelectedPhrase:(name:string)=>saveSelected("phrase",name),removeLibraryEntry,exportLibrary,importLibrary,useLibraryEntry,previewLibraryEntry,cancelLibraryOperation,cancelLibraryPreview};
}
