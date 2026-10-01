import {describe,it,expect} from "vitest";
import {createProject,createTrack} from "../lib/music/project";
import {LibraryTargetRevisions} from "../lib/client/library-operations";
import {instrumentFor} from "../lib/audio/catalog";
import {makeSource,emptyPatch} from "../lib/audio/modulation";
import {inactiveAutomationBindings,resolvedModulationPatch,modulationTargetReason} from "../lib/music/automation-bindings";

describe("asynchronous library destination revisions",()=>{
  const fixture=()=>{const doc=createProject();doc.tracks=[createTrack("lead"),createTrack("bass")];return doc;};
  it("invalidates target edit then Undo, but keeps unrelated edits",()=>{
    const doc=fixture(),revision=new LibraryTargetRevisions(),destination={trackId:doc.tracks[0].id,sectionId:doc.sections[0].id,clipId:""};
    const token=revision.capture(doc,destination),unrelated=structuredClone(doc);unrelated.tracks[1].pan=.3;revision.observe(doc,unrelated);
    expect(revision.matches(unrelated,token)).toBe(true);
    const edited=structuredClone(unrelated);edited.tracks[0].pan=.5;revision.observe(unrelated,edited);revision.observe(edited,unrelated);
    expect(revision.matches(unrelated,token)).toBe(false);
  });
  it("invalidates sample map, section, timing and same-document reload",()=>{
    for(const change of ["sample","section","tempo","reload"]){
      const doc=fixture(),revision=new LibraryTargetRevisions();
      if(change==="sample"){doc.userInstruments=[structuredClone({...instrumentFor(doc,createTrack("piano")),id:"custom_map"})];doc.tracks[0].instrumentId="custom_map";}
      const token=revision.capture(doc,{trackId:doc.tracks[0].id,sectionId:doc.sections[0].id,clipId:""}),next=structuredClone(doc);
      if(change==="sample")next.userInstruments[0].zones[0].root+=1;
      if(change==="section")next.sections[0].startTick=960;
      if(change==="tempo")next.tempo=140;
      if(change==="reload")revision.reset();else revision.observe(doc,next);
      expect(revision.matches(next,token),change).toBe(false);
    }
  });
  it("invalidates target deletion and project replacement",()=>{
    const doc=fixture(),revision=new LibraryTargetRevisions(),token=revision.capture(doc,{trackId:doc.tracks[0].id,sectionId:doc.sections[0].id,clipId:""});
    const next={...doc,tracks:doc.tracks.slice(1)};revision.observe(doc,next);expect(revision.matches(next,token)).toBe(false);
    expect(revision.matches(createProject(),token)).toBe(false);
  });
});
describe("inactive bindings retain authored data",()=>{
  it("resolves sample/FM restrictions without changing the stored patch",()=>{
    const track=createTrack("piano"),patch=emptyPatch();patch.sources=[makeSource("lfo","shape")];
    patch.routes=[{id:"fm",sourceId:"M1",target:"voice.fmIndex",amount:3,curve:"linear",slew:.01,enabled:true}];track.modulation=patch;
    track.automation=[{parameter:"M1",points:[{tick:0,value:.7}]}];
    const instrument=instrumentFor(createProject(),track),runtime=resolvedModulationPatch(track,instrument)!;
    expect(runtime.routes[0].enabled).toBe(false);expect(track.modulation.routes[0].enabled).toBe(true);
    expect(modulationTargetReason(track,instrument,"voice.fmIndex")).toBe("Synth instruments only");
    expect(inactiveAutomationBindings(track,instrument)).toEqual([{target:"M1",reason:"No active destination for this macro"}]);
    expect(track.automation[0].points).toEqual([{tick:0,value:.7}]);
  });
  it("restores the same binding when a compatible instrument returns",()=>{
    const doc=createProject(),track=createTrack("lead");track.modulation=emptyPatch();track.modulation.routes=[{id:"fm",sourceId:"M1",target:"voice.fmIndex",amount:3,curve:"linear",slew:.01,enabled:true}];
    expect(resolvedModulationPatch(track,instrumentFor(doc,track))).toBe(track.modulation);
    track.sound.algorithm="subtractive";expect(resolvedModulationPatch(track,instrumentFor(doc,track))!.routes[0].enabled).toBe(false);
    expect(track.modulation.routes[0].target).toBe("voice.fmIndex");
  });
  it("reports a macro whose transitive destinations are all inactive",()=>{
    const doc=createProject(),track=createTrack("piano"),patch=emptyPatch();
    patch.sources=[makeSource("lfo","shape")];
    patch.routes=[
      {id:"driver",sourceId:"M1",target:"source:shape:rate",amount:2,curve:"linear",slew:0,enabled:true},
      {id:"destination",sourceId:"shape",target:"voice.fmIndex",amount:3,curve:"linear",slew:0,enabled:true},
    ];
    track.modulation=patch;track.automation=[{parameter:"M1",points:[{tick:0,value:.7}]}];
    const instrument=instrumentFor(doc,track),before=structuredClone(track);
    expect(inactiveAutomationBindings(track,instrument)).toEqual([{target:"M1",reason:"No active destination for this macro"}]);
    patch.routes.push({id:"supported",sourceId:"shape",target:"track.pan",amount:.5,curve:"linear",slew:0,enabled:true});
    expect(inactiveAutomationBindings(track,instrument)).toEqual([]);
    expect(track.automation).toEqual(before.automation);
    expect(patch.routes[1].enabled).toBe(true);
  });
});
