import {trackBounceSourceSignature} from "../music/track-bounce";
import type {ProjectDocument} from "../music/types";

export type TrackBounceToken={projectId:string;sourceTrackId:string;epoch:number;revision:number;signature:string};

/** Monotonic source revisions retain edits through Undo or cancelled field previews. */
export class TrackBounceRevisions{
  private epoch=0;
  private tracks=new Map<string,number>();
  reset(){++this.epoch;this.tracks.clear();}
  observe(before:ProjectDocument,after:ProjectDocument){
    if(before.id!==after.id){this.reset();return;}
    for(const id of new Set([...before.tracks,...after.tracks].map(track=>track.id)))
      if(trackBounceSourceSignature(before,id)!==trackBounceSourceSignature(after,id))
        this.tracks.set(id,(this.tracks.get(id)??0)+1);
  }
  capture(document:ProjectDocument,sourceTrackId:string):TrackBounceToken{
    if(!document.tracks.some(track=>track.id===sourceTrackId&&track.kind==="instrument"))
      throw new Error("Choose an existing instrument source track to bounce.");
    return {projectId:document.id,sourceTrackId,epoch:this.epoch,revision:this.tracks.get(sourceTrackId)??0,
      signature:trackBounceSourceSignature(document,sourceTrackId)};
  }
  matches(document:ProjectDocument,token:TrackBounceToken){
    return document.id===token.projectId&&this.epoch===token.epoch&&(this.tracks.get(token.sourceTrackId)??0)===token.revision&&
      document.tracks.some(track=>track.id===token.sourceTrackId&&track.kind==="instrument")&&
      trackBounceSourceSignature(document,token.sourceTrackId)===token.signature;
  }
}
