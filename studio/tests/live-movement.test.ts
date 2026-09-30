import {describe,it,expect} from "vitest";
import {LiveMovement} from "../lib/music/live-movement";
import {DEFAULT_CHORD_MOVEMENT,evaluateMovement} from "../lib/music/chord-movement";
import {createProject,createTrack} from "../lib/music/project";
import type {NoteEvent} from "../lib/music/types";
function setup(hold=false){const project=createProject(),track=createTrack("pad","Live");track.chordMovement={...DEFAULT_CHORD_MOVEMENT,liveEnabled:true,hold,pattern:"up",enabled:true};project.tracks=[track];const emitted:NoteEvent[]=[],cancelled:string[]=[];const live=new LiveMovement((_,note)=>emitted.push(note),id=>cancelled.push(id));return {project,track,emitted,cancelled,live};}
const values=(notes:NoteEvent[])=>notes.map(({id,...note})=>{void id;return note;});
describe("live chord input lifecycle",()=>{
  it("matches generated notes and does not reschedule an already queued pulse",()=>{
    const s=setup();[60,64,67].forEach((pitch,i)=>s.live.noteOn("midi:"+i,s.track,pitch,.75));
    s.live.advance(s.project,{tick:0,kind:"song"},1500);s.live.advance(s.project,{tick:100,kind:"song"},1000);
    const expected=evaluateMovement([60,64,67],s.track.chordMovement!,{startTick:0,lengthTick:1920,velocity:.75,seed:s.track.chordMovement!.seed^s.project.seed});
    expect(values(s.emitted)).toEqual(values(expected));
  });
  it("releasing pointer input preserves a keyboard-owned chord",()=>{
    const s=setup();s.live.noteOn("pointer:60",s.track,60,.8);s.live.noteOn("keyboard:64",s.track,64,.8);
    s.live.releaseSource("pointer:");s.live.advance(s.project,{tick:0,kind:"song"},0);
    expect(s.emitted.map(n=>n.pitch)).toEqual([64]);s.live.releaseSource("keyboard:");s.live.advance(s.project,{tick:480,kind:"song"},0);expect(s.emitted).toHaveLength(1);
  });
  it("Hold retains released keys but disconnect/Stop releases the held output",()=>{
    const s=setup(true);s.live.noteOn("midi:60",s.track,60,.8);s.live.noteOff("midi:60",s.project);
    s.live.advance(s.project,{tick:0,kind:"song"},0);expect(s.emitted).toHaveLength(1);
    s.live.releaseSource("midi:");s.live.advance(s.project,{tick:480,kind:"song"},0);expect(s.emitted).toHaveLength(1);
    s.live.clear();expect(s.cancelled).toContain(s.track.id);
  });
  it("closing the pointer owner preserves another owner's latched Hold input",()=>{
    const s=setup(true);s.live.noteOn("pointer:60",s.track,60,.8);s.live.noteOn("midi:64",s.track,64,.8);
    s.live.noteOff("midi:64",s.project);s.live.releaseSource("pointer:",s.project);
    s.live.advance(s.project,{tick:0,kind:"song"},0);expect(s.emitted.map(n=>n.pitch)).toEqual([64]);
  });
  it("sustain releases on pedal-up and count-in emits no capture notes",()=>{
    const s=setup();s.live.noteOn("midi:60",s.track,60,.8);s.live.pedal("midi",s.track.id,true,s.project);s.live.noteOff("midi:60",s.project);
    s.live.advance(s.project,{tick:0,kind:"song",countIn:true},1000);expect(s.emitted).toHaveLength(0);
    s.live.advance(s.project,{tick:0,kind:"song"},0);expect(s.emitted).toHaveLength(1);
    s.live.pedal("midi",s.track.id,false,s.project);s.live.advance(s.project,{tick:480,kind:"song"},0);expect(s.emitted).toHaveLength(1);
  });
  it("restarts immediately at a loop boundary and skips directly to a forward seek",()=>{
    const s=setup();s.live.noteOn("keyboard:60",s.track,60,.8);
    s.live.advance(s.project,{tick:0,kind:"song"},0);
    s.live.advance(s.project,{tick:960,kind:"song"},0);
    s.live.advance(s.project,{tick:0,kind:"song"},0);
    expect(s.emitted.map(n=>n.tick)).toEqual([0,960,0]);
    s.live.advance(s.project,{tick:480000,kind:"song"},0);
    expect(s.emitted.at(-1)?.tick).toBe(480000);
    expect(s.cancelled).toContain(s.track.id);
  });
});
