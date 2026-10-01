import { instrumentFor } from "../audio/catalog";
import type { ProjectDocument } from "../music/types";

export type LibraryDestination = {trackId:string;sectionId:string;clipId:string};
export type LibraryTargetToken = LibraryDestination & {projectId:string;epoch:number;trackRevision:number;sectionRevision:number;timingRevision:number};

/** Monotonic revisions remember edit -> Undo, unlike a final-content fingerprint. */
export class LibraryTargetRevisions {
  private epoch=0;
  private timing=0;
  private tracks=new Map<string,number>();
  private sections=new Map<string,number>();
  reset(){++this.epoch;this.tracks.clear();this.sections.clear();++this.timing;}
  observe(before:ProjectDocument,after:ProjectDocument){
    if(before.id!==after.id){this.reset();return;}
    if(before.tempo!==after.tempo||JSON.stringify(before.timeSignature)!==JSON.stringify(after.timeSignature))++this.timing;
    const signature=(doc:ProjectDocument,id:string)=>{
      const track=doc.tracks.find(t=>t.id===id);if(!track)return "";
      const instrument=instrumentFor(doc,track),ids=new Set(instrument.zones.flatMap(z=>z.assetId?[z.assetId]:[]));
      track.clips.forEach(c=>{if(c.audio)ids.add(c.audio.assetId);});
      return JSON.stringify([track,instrument,doc.assets.filter(a=>ids.has(a.id))]);
    };
    for(const id of new Set([...before.tracks,...after.tracks].map(t=>t.id)))
      if(signature(before,id)!==signature(after,id))this.tracks.set(id,(this.tracks.get(id)??0)+1);
    for(const id of new Set([...before.sections,...after.sections].map(s=>s.id)))
      if(JSON.stringify(before.sections.find(s=>s.id===id))!==JSON.stringify(after.sections.find(s=>s.id===id)))this.sections.set(id,(this.sections.get(id)??0)+1);
  }
  capture(document:ProjectDocument,destination:LibraryDestination):LibraryTargetToken {
    return {...destination,projectId:document.id,epoch:this.epoch,trackRevision:this.tracks.get(destination.trackId)??0,
      sectionRevision:this.sections.get(destination.sectionId)??0,timingRevision:this.timing};
  }
  matches(document:ProjectDocument,token:LibraryTargetToken){
    return document.id===token.projectId&&token.epoch===this.epoch&&token.timingRevision===this.timing&&
      (this.tracks.get(token.trackId)??0)===token.trackRevision&&(this.sections.get(token.sectionId)??0)===token.sectionRevision&&
      !!document.sections.find(s=>s.id===token.sectionId)&&
      (!token.trackId||!!document.tracks.find(t=>t.id===token.trackId));
  }
}
