import {describe,it,expect} from "vitest";
import {createProject,createTrack,emptyClip} from "../lib/music/project";
import {instrumentFor} from "../lib/audio/catalog";
import {TrackBounceRevisions} from "../lib/client/bounce-operations";

const fixture=()=>{const document=createProject();document.tracks=[createTrack("lead"),createTrack("bass")];document.tracks[0].clips=[emptyClip(960,3840)];return document;};

describe("pending bounce source revisions",()=>{
  it("keeps unrelated edits and UI-independent master gain changes",()=>{
    const document=fixture(),revisions=new TrackBounceRevisions(),token=revisions.capture(document,document.tracks[0].id),latest=structuredClone(document);
    latest.title="While rendering";latest.tracks[1].pan=.6;latest.sections[0].lyrics="New words";latest.master.volume=-12;latest.master.limiter=false;
    revisions.observe(document,latest);expect(revisions.matches(latest,token)).toBe(true);
  });
  it.each(["source","tempo","meter","seed","decay"])("remembers %s edit then Undo",change=>{
    const document=fixture(),revisions=new TrackBounceRevisions(),token=revisions.capture(document,document.tracks[0].id),edited=structuredClone(document);
    if(change==="source")edited.tracks[0].clips[0].lengthTick+=960;
    if(change==="tempo")edited.tempo=140;if(change==="meter")edited.timeSignature=[3,4];
    if(change==="seed")edited.seed++;if(change==="decay")edited.master.reverbDecay=3;
    revisions.observe(document,edited);revisions.observe(edited,document);expect(revisions.matches(document,token)).toBe(false);
  });
  it("remembers reachable sampler and asset edits while ignoring unrelated assets",()=>{
    const document=fixture(),source=document.tracks[0],instrument=structuredClone(instrumentFor(document,createTrack("piano")));
    instrument.id="sampler";instrument.zones=[{assetId:"sample",root:60,low:0,high:127,velocityLow:0,velocityHigh:1,roundRobin:0,articulation:"sustain"}];
    source.instrumentId=instrument.id;document.userInstruments=[instrument];document.assets=[{id:"sample",name:"Sample",mime:"audio/wav",byteLength:1,duration:1,sampleRate:8000,channels:1}];
    for(const change of ["instrument","asset"]){
      const revisions=new TrackBounceRevisions(),token=revisions.capture(document,source.id),edited=structuredClone(document);
      if(change==="instrument")edited.userInstruments[0].zones[0].root=61;else edited.assets[0].duration=2;
      revisions.observe(document,edited);revisions.observe(edited,document);expect(revisions.matches(document,token)).toBe(false);
    }
    const revisions=new TrackBounceRevisions(),token=revisions.capture(document,source.id),unrelated=structuredClone(document);
    unrelated.assets.push({...document.assets[0],id:"unused"});revisions.observe(document,unrelated);expect(revisions.matches(unrelated,token)).toBe(true);
  });
  it("invalidates source deletion, replacement and same-document reload",()=>{
    for(const change of ["deleted","replacement","reload"]){
      const document=fixture(),revisions=new TrackBounceRevisions(),token=revisions.capture(document,document.tracks[0].id),latest=structuredClone(document);
      if(change==="deleted")latest.tracks.shift();if(change==="replacement")latest.id="another_project";
      if(change==="reload")revisions.reset();else revisions.observe(document,latest);
      expect(revisions.matches(latest,token)).toBe(false);
    }
  });
  it("rejects missing or audio sources and unobserved source changes",()=>{
    const document=fixture(),revisions=new TrackBounceRevisions(),token=revisions.capture(document,document.tracks[0].id),latest=structuredClone(document);
    latest.tracks[0].sound.detune=18;expect(revisions.matches(latest,token)).toBe(false);
    expect(()=>revisions.capture(document,"missing")).toThrow(/source|instrument/i);
    document.tracks[0].kind="audio";expect(()=>revisions.capture(document,document.tracks[0].id)).toThrow(/source|instrument/i);
  });
});
