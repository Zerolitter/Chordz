import type { NoteEvent, ProjectDocument, Track } from "./types";
import {evaluateMovementStep} from "./chord-movement";
type Held={trackId:string;pitch:number;velocity:number;down:boolean};
type Cursor={origin:number;step:number;clock:string;settings:string;lastTick:number};
export interface MovementClock {tick:number;kind:string;countIn?:boolean;}
/** Input ownership and scheduling are separate from rendered/baked note playback. */
export class LiveMovement {
  private held=new Map<string,Held>();
  private pedals=new Map<string,{trackId:string;down:boolean}>();
  private cursors=new Map<string,Cursor>();
  constructor(private emit:(track:Track,note:NoteEvent)=>void,private cancel:(trackId:string)=>void){}
  noteOn(id:string,track:Track,pitch:number,velocity:number){
    if(![...this.held.values()].some(h=>h.trackId===track.id&&h.down))for(const [key,h]of this.held)if(h.trackId===track.id&&!h.down)this.held.delete(key);
    this.held.set(id,{trackId:track.id,pitch,velocity,down:true});this.invalidate(track.id);
  }
  noteOff(id:string,project:ProjectDocument,force=false){
    const held=this.held.get(id);if(!held)return;held.down=false;
    const track=project.tracks.find(t=>t.id===held.trackId);
    if(force||!track?.chordMovement?.hold&&!this.pedalDown(held.trackId))this.held.delete(id);
    this.invalidate(held.trackId);
  }
  pedal(source:string,trackId:string,down:boolean,project:ProjectDocument){
    this.pedals.set(source,{trackId,down});
    if(!down&&!this.pedalDown(trackId)&&!project.tracks.find(t=>t.id===trackId)?.chordMovement?.hold)for(const [id,h]of this.held)if(h.trackId===trackId&&!h.down)this.held.delete(id);
    this.invalidate(trackId);
  }
  releaseSource(prefix:string,project?:ProjectDocument){
    const tracks=new Set<string>();
    for(const [id,h]of this.held)if(id.startsWith(prefix)){tracks.add(h.trackId);this.held.delete(id);}
    for(const [id,p]of this.pedals)if(id.startsWith(prefix)){tracks.add(p.trackId);this.pedals.delete(id);}
    for(const [id,h]of this.held)if(!h.down&&!this.pedalDown(h.trackId)&&tracks.has(h.trackId)&&project&&!project.tracks.find(t=>t.id===h.trackId)?.chordMovement?.hold)this.held.delete(id);
    for(const id of tracks)this.invalidate(id);
  }
  clear(){for(const id of this.cursors.keys())this.cancel(id);this.held.clear();this.pedals.clear();this.cursors.clear();}
  private pedalDown(trackId:string){return [...this.pedals.values()].some(p=>p.trackId===trackId&&p.down);}
  private invalidate(trackId:string){this.cancel(trackId);this.cursors.delete(trackId);}
  advance(project:ProjectDocument,clock:MovementClock,lookahead:number){
    for(const track of project.tracks){
      const settings=track.chordMovement,held=[...this.held.values()].filter(h=>h.trackId===track.id);
      if(!settings?.liveEnabled||!held.length||clock.countIn){if(this.cursors.has(track.id))this.invalidate(track.id);continue;}
      const signature=JSON.stringify(settings);let cursor=this.cursors.get(track.id);
      if(!cursor||cursor.clock!==clock.kind||cursor.settings!==signature||clock.tick<cursor.lastTick){
        if(cursor)this.cancel(track.id);
        const origin=clock.kind==="song"?0:clock.tick;
        cursor={origin,step:Math.max(0,Math.ceil((clock.tick-origin)/settings.division)),clock:clock.kind,settings:signature,lastTick:clock.tick};this.cursors.set(track.id,cursor);
      }
      const currentStep=Math.max(0,Math.floor((clock.tick-cursor.origin)/settings.division));
      if(currentStep>cursor.step+1){this.cancel(track.id);cursor.step=currentStep;}
      cursor.lastTick=clock.tick;
      const pitches=held.map(h=>h.pitch),velocity=Math.max(...held.map(h=>h.velocity));
      let budget=32;
      while(cursor.origin+cursor.step*settings.division<=clock.tick+lookahead&&budget-->0){
        const notes=evaluateMovementStep(pitches,settings,{step:cursor.step++,originTick:cursor.origin,velocity,seed:settings.seed^project.seed});
        for(const note of notes)if(note.tick>=clock.tick-2)this.emit(track,note);
      }
    }
  }
}
