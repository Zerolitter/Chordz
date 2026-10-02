import {describe,it,expect} from "vitest";
import {createProject,createTrack,emptyClip} from "../lib/music/project";
import {PPQ,type AssetReference} from "../lib/music/types";
import {projectSchema} from "../lib/music/schema";
import {compileExportSong,exportRenderPlan,bounceTailSeconds} from "../lib/audio/export-range";
import {audibleTracks} from "../lib/audio/compile";
import {instrumentFor} from "../lib/audio/catalog";
import {emptyPatch} from "../lib/audio/modulation";
import {planTrackBounce,applyTrackBounce,type TrackBouncePlan} from "../lib/music/track-bounce";

function fixture(){
  const document=createProject("Bounce source");document.tempo=137;
  const source=createTrack("lead","Moving lead"),other=createTrack("bass","Other part");
  source.mute=true;source.solo=true;source.pan=.4;source.delay=.3;source.sound.lfoDepth=.4;
  const first=emptyClip(PPQ*4+1,PPQ*2,"First"),last=emptyClip(PPQ*10,PPQ*3,"Last");
  first.notes=[{id:"first_note",pitch:60,tick:0,duration:PPQ,velocity:.7}];
  last.notes=[{id:"last_note",pitch:64,tick:PPQ,duration:PPQ,velocity:.6}];last.loop=true;last.sourceLengthTick=PPQ;
  source.clips=[last,first];source.automation=[{parameter:"pan",points:[{tick:0,value:-.2},{tick:PPQ*12,value:.6}]}];
  other.clips=[emptyClip(0,PPQ*20)];document.tracks=[source,other];return document;
}
const encoded=(plan:TrackBouncePlan):AssetReference=>({id:plan.assetId,name:"Moving lead.wav",mime:"audio/wav",byteLength:plan.expectedWavBytes,duration:plan.outputFrames/48000,sampleRate:48000,channels:2});

describe("instrument track bounce copy",()=>{
  it("captures an independent absolute source snapshot and allocates all copy identities before rendering",()=>{
    const document=fixture(),before=structuredClone(document),source=document.tracks[0],plan=planTrackBounce(document,source.id,{includeTails:false});
    expect(plan.range).toEqual({startTick:PPQ*4+1,endTick:PPQ*13});
    expect(plan.renderProject.tracks).toHaveLength(1);expect(plan.renderProject.tracks[0]).toEqual({...source,mute:false,solo:false});
    expect(plan.renderProject.seed).toBe(document.seed);expect(plan.renderProject.master).toEqual(document.master);
    expect(compileExportSong(plan.renderProject,source.id,plan.range)).toEqual(compileExportSong({...document,tracks:[{...source,mute:false,solo:false}]},source.id,plan.range));
    const ids=[plan.operationId,plan.assetId,plan.audioTrackId,plan.clipId];expect(new Set(ids).size).toBe(4);
    expect(ids.every(id=>!JSON.stringify(before).includes(id))).toBe(true);
    document.tracks[0].sound.cutoff=300;document.tracks[0].clips[0].notes[0].velocity=.1;
    expect(plan.renderProject.tracks[0].sound.cutoff).toBe(before.tracks[0].sound.cutoff);
    expect(plan.renderProject.tracks[0].clips[0].notes[0].velocity).toBe(.6);
  });
  it("uses sample-accurate frames, explicit tails and only the source's render dependencies",()=>{
    const document=fixture(),source=document.tracks[0];
    document.tracks[1].modulation={...emptyPatch(),routes:[{id:"irrelevant",sourceId:"M1",target:"voice.release",amount:1,curve:"linear",slew:0,enabled:true}]};
    const dry=planTrackBounce(document,source.id,{includeTails:false}),tail=planTrackBounce(document,source.id,{includeTails:true});
    const expected=exportRenderPlan(dry.renderProject,dry.range,false);
    expect(dry.renderFrames).toBe(expected.renderFrames);expect(dry.outputFrames).toBe(expected.outputFrames);expect(dry.expectedWavBytes).toBe(44+expected.outputFrames*6);
    expect(tail.outputFrames-dry.outputFrames).toBe(Math.ceil(bounceTailSeconds(tail.renderProject)*48000));
  });
  it("retains only reachable sample assets and the selected user instrument",()=>{
    const document=fixture(),source=document.tracks[0],instrument=structuredClone(instrumentFor(document,createTrack("piano")));
    instrument.id="owned_piano";instrument.zones=[{root:60,low:0,high:127,velocityLow:0,velocityHigh:1,roundRobin:0,articulation:"sustain",assetId:"sample"}];
    source.instrumentId=instrument.id;document.userInstruments=[instrument];
    document.assets=[{id:"sample",name:"sample.wav",mime:"audio/wav",byteLength:50,duration:1,sampleRate:48000,channels:1},{id:"unrelated",name:"unused.wav",mime:"audio/wav",byteLength:50,duration:1,sampleRate:48000,channels:1}];
    const plan=planTrackBounce(document,source.id);
    expect(plan.renderProject.assets.map(a=>a.id)).toEqual(["sample"]);expect(plan.renderProject.userInstruments.map(i=>i.id)).toEqual(["owned_piano"]);
  });
  it("adds a neutral stereo region to the latest document without rewriting its source or unrelated edits",()=>{
    const document=fixture(),sourceId=document.tracks[0].id,plan=planTrackBounce(document,sourceId,{includeTails:true}),latest=structuredClone(document);
    latest.title="Changed during render";latest.tracks[1].volume=-8;latest.master.volume=-6;
    const before=structuredClone(latest),result=applyTrackBounce(latest,plan,encoded(plan)),copy=result.document.tracks.at(-1)!;
    expect(result.trackId).toBe(plan.audioTrackId);expect(result.clipId).toBe(plan.clipId);
    expect(result.document.tracks.slice(0,-1)).toEqual(before.tracks);expect(result.document.title).toBe(before.title);expect(result.document.master).toEqual(before.master);expect(latest).toEqual(before);
    expect(copy).toMatchObject({id:plan.audioTrackId,kind:"audio",volume:0,pan:0,mute:false,solo:true,reverb:0,delay:0,low:0,mid:0,high:0,drive:0,automation:[],sound:{cutoff:20000,resonance:0,lfoDepth:0}});
    expect(copy.modulation).toBeUndefined();expect(copy.chordMovement).toBeUndefined();
    const lengthTick=Math.ceil(encoded(plan).duration*document.tempo*PPQ/60);
    expect(copy.clips[0]).toMatchObject({id:plan.clipId,startTick:plan.range.startTick,lengthTick,sourceLengthTick:lengthTick,loop:false,transpose:0,notes:[],events:[],audio:{assetId:plan.assetId,offsetSec:0,gain:1,fadeInSec:0,fadeOutSec:0}});
    expect(projectSchema.safeParse(result.document).success).toBe(true);
    result.document.tracks[0].clips[0].notes[0].velocity=.2;expect(latest.tracks[0].clips[0].notes[0].velocity).toBe(.6);
  });
  it("mutes the source only when explicitly requested, preserving every other source field",()=>{
    const document=fixture();document.tracks[0].mute=false;
    const source=structuredClone(document.tracks[0]),plan=planTrackBounce(document,source.id,{muteSource:true});
    const result=applyTrackBounce(document,plan,encoded(plan));
    expect(result.document.tracks[0]).toEqual({...source,mute:true});expect(document.tracks[0]).toEqual(source);
    const keep=planTrackBounce(document,source.id);expect(applyTrackBounce(document,keep,encoded(keep)).document.tracks[0]).toEqual(source);
  });
  it("keeps other tracks excluded when the soloed source is explicitly muted after bounce",()=>{
    const document=fixture();document.tracks[0].mute=false;
    const plan=planTrackBounce(document,document.tracks[0].id,{muteSource:true}),result=applyTrackBounce(document,plan,encoded(plan));
    expect(audibleTracks(document).map(track=>track.id)).toEqual([document.tracks[0].id]);
    expect(audibleTracks(result.document).map(track=>track.id)).toEqual([plan.audioTrackId]);
    expect(result.document.tracks[0].solo).toBe(true);
  });
  it.each(["audio","missing","empty"])("rejects a %s source",kind=>{
    const document=fixture(),source=document.tracks[0];if(kind==="audio")source.kind="audio";if(kind==="empty")source.clips=[];
    expect(()=>planTrackBounce(document,kind==="missing"?"removed":source.id)).toThrow(/instrument|missing|phrase|source/i);
  });
  it("supports drum instrument tracks without changing their source identity",()=>{
    const document=fixture();document.tracks[0].instrumentId="drums";
    const plan=planTrackBounce(document,document.tracks[0].id);expect(plan.renderProject.tracks[0].instrumentId).toBe("drums");
  });
  it("rejects source changes and project replacement even if the controller forgot a revision check",()=>{
    const document=fixture(),plan=planTrackBounce(document,document.tracks[0].id);
    for(const change of ["sound","tempo","seed","decay","project"]){
      const latest=structuredClone(document);
      if(change==="sound")latest.tracks[0].sound.cutoff=400;
      if(change==="tempo")latest.tempo=120;if(change==="seed")latest.seed++;
      if(change==="decay")latest.master.reverbDecay=3;if(change==="project")latest.id="replacement";
      expect(()=>applyTrackBounce(latest,plan,encoded(plan)),change).toThrow(/changed|source|project/i);
    }
  });
  it("rejects ID collisions, repeated insertion and malformed rendered metadata",()=>{
    const document=fixture(),plan=planTrackBounce(document,document.tracks[0].id),asset=encoded(plan);
    const inserted=applyTrackBounce(document,plan,asset).document;
    expect(()=>applyTrackBounce(inserted,plan,asset)).toThrow(/identity|already|identifier/i);
    for(const metadata of [{...asset,id:"wrong"},{...asset,channels:1},{...asset,sampleRate:44100},{...asset,duration:0},{...asset,duration:asset.duration+1},{...asset,byteLength:asset.byteLength-6},{...asset,byteLength:100*1024*1024+1}])
      expect(()=>applyTrackBounce(document,plan,metadata)).toThrow(/audio|asset|render|limit|WAV/i);
  });
  it("allows one native render rounding frame and keeps the complete rendered duration",()=>{
    const document=fixture(),plan=planTrackBounce(document,document.tracks[0].id),asset=encoded(plan);
    asset.duration=(plan.outputFrames+1)/48000;asset.byteLength+=6;
    const result=applyTrackBounce(document,plan,asset),region=result.document.tracks.at(-1)!.clips[0];
    expect(region.lengthTick).toBe(Math.ceil(asset.duration*document.tempo*PPQ/60));
    expect(result.document.assets.at(-1)!.duration).toBe(asset.duration);
  });
  it("enforces track, asset, tick and preroll/audio size limits before allocating a render",()=>{
    for(const limit of ["tracks","assets","ticks","audio","preroll"]){
      const document=fixture(),source=document.tracks[0];
      if(limit==="tracks")document.tracks.push(...Array.from({length:62},()=>createTrack("bass")));
      if(limit==="assets")document.assets=Array.from({length:1000},(_,i)=>({id:`asset_${i}`,name:"unused.wav",mime:"audio/wav",byteLength:1,duration:1,sampleRate:8000,channels:1}));
      if(limit==="ticks")source.clips=[emptyClip(999_999_990,20)];
      if(limit==="audio")source.clips=[emptyClip(0,PPQ*1000)];
      if(limit==="preroll")source.clips=[emptyClip(PPQ*1000,PPQ)];
      expect(()=>planTrackBounce(document,source.id),limit).toThrow(/limit|100 MB|range|supported/i);
    }
  });
  it("rechecks capacity after unrelated tracks or assets were added while rendering",()=>{
    for(const kind of ["tracks","assets"]){
      const document=fixture(),plan=planTrackBounce(document,document.tracks[0].id),latest=structuredClone(document);
      if(kind==="tracks")latest.tracks.push(...Array.from({length:62},()=>createTrack("bass")));
      else latest.assets=Array.from({length:1000},(_,i)=>({id:`new_${i}`,name:"unused.wav",mime:"audio/wav",byteLength:1,duration:1,sampleRate:8000,channels:1}));
      expect(()=>applyTrackBounce(latest,plan,encoded(plan))).toThrow(/limit|64|track/i);
    }
  });
});
