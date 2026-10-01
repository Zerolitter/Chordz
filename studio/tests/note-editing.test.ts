import {describe,expect,it} from "vitest";
import {createProject,emptyClip} from "../lib/music/project";
import {MAX_TICK} from "../lib/music/arrangement";
import {projectSchema} from "../lib/music/schema";
import {PPQ,type Clip} from "../lib/music/types";
import {copyNotes,duplicateNotes,humanizeNotes,marqueeNoteIds,moveNotes,noteClipboardSchema,notePitchRows,pasteNotes,quantizeNotes,reconcileNoteSelection,resizeNotes} from "../lib/music/note-editing";

function fixture():Clip {
  return {...emptyClip(9600,3840,"Looped phrase"),sourceLengthTick:960,loop:true,transpose:5,
    notes:[{id:"a",pitch:60,tick:100,duration:300,velocity:.2,articulation:"legato"},{id:"b",pitch:64,tick:700,duration:600,velocity:.8},{id:"c",pitch:67,tick:240,duration:333,velocity:.5}],
    events:[{tick:0,type:"sustain",value:1},{tick:480,type:"macro",macroId:"M2",value:.4}]};
}
function invariant(before:Clip,after:Clip) {
  expect({...after,notes:before.notes}).toEqual(before);
  expect(after.events).toBe(before.events);
}

describe("source-note group commands",()=>{
  it("moves one common delta within source onset and MIDI pitch limits, retaining intervals and tails",()=>{
    const clip=fixture(), moved=moveNotes(clip,["a","b"],1000,100);
    expect(moved.notes.slice(0,2).map(n=>[n.tick,n.pitch,n.duration])).toEqual([[359,123,300],[959,127,600]]);
    expect(moved.notes[2]).toBe(clip.notes[2]);invariant(clip,moved);
    const lowered=moveNotes(clip,["a","b"],-1000,-100);
    expect(lowered.notes.slice(0,2).map(n=>[n.tick,n.pitch])).toEqual([[0,0],[600,4]]);
  });
  it("does not normalize existing out-of-window data on a no-op or empty scope",()=>{
    const clip=fixture();clip.notes[0].tick=1200;
    expect(moveNotes(clip,"all",0,0)).toBe(clip);
    expect(moveNotes(clip,[],240,12)).toBe(clip);
    expect(resizeNotes(clip,"all","right",0)).toBe(clip);
    expect(moveNotes(clip,"all",NaN,0)).toBe(clip);
  });
  it("rejects an edited group that cannot fit without independent note clipping",()=>{
    const clip=fixture();clip.notes[0].tick=0;clip.notes[1].tick=1000;
    expect(()=>moveNotes(clip,["a","b"],1)).toThrow(/fit/i);
    expect(()=>resizeNotes(clip,["b"],"right",1)).toThrow(/source/i);
  });
  it("resizes left edges by a common delta without changing note endings",()=>{
    const clip=fixture(), resized=resizeNotes(clip,["a","b"],"left",1000);
    expect(resized.notes.slice(0,2).map(n=>[n.tick,n.duration,n.tick+n.duration])).toEqual([[359,41,400],[959,341,1300]]);
    // Source onsets must fit too, so b caps the common delta at259.
    expect(resized.notes[1].tick).toBeLessThan(clip.sourceLengthTick);
    invariant(clip,resized);
  });
  it("bounds a group's left resize by maximum note duration without normalizing its existing tails",()=>{
    const clip=fixture();clip.notes[0].duration=MAX_TICK-25;
    const before=structuredClone(clip),project=createProject();project.tracks[0].clips=[clip];
    expect(projectSchema.safeParse(project).success).toBe(true);
    const resized=resizeNotes(clip,["a","b"],"left",-100);
    expect(resized.notes.slice(0,2).map(note=>[note.tick,note.duration])).toEqual([[75,MAX_TICK],[675,625]]);
    expect(resized.notes.slice(0,2).map(note=>note.tick+note.duration)).toEqual(clip.notes.slice(0,2).map(note=>note.tick+note.duration));
    expect(resized.notes[2]).toBe(clip.notes[2]);expect(clip).toEqual(before);invariant(clip,resized);
    expect(projectSchema.safeParse({...project,tracks:[{...project.tracks[0],clips:[resized]}]}).success).toBe(true);
    expect(resizeNotes(resized,["a","b"],"left",-100)).toBe(resized);
  });
  it("extends right edges only to source end or each existing tail and shortens no note below one tick",()=>{
    const clip=fixture();
    expect(resizeNotes(clip,["a","b"],"right",500)).toBe(clip);
    const extended=resizeNotes(clip,["a"],"right",1000);
    expect(extended.notes[0].duration).toBe(860);
    const shortened=resizeNotes(clip,["a","b"],"right",-1000);
    expect(shortened.notes.slice(0,2).map(n=>n.duration)).toEqual([1,301]);invariant(clip,shortened);
  });
  it("quantizes an explicit scope to valid swung grid points and preserves durations/controllers",()=>{
    const clip=fixture();clip.notes[0].tick=350;clip.notes[1].tick=930;
    const selected=quantizeNotes(clip,["a"],240,.5);
    expect(selected.notes[0].tick).toBe(360);expect(selected.notes[0].duration).toBe(300);
    expect(selected.notes[1]).toBe(clip.notes[1]);expect(selected.notes[2]).toBe(clip.notes[2]);invariant(clip,selected);
    const phrase=quantizeNotes(clip,"all",240,.5);
    expect(phrase.notes.map(n=>n.tick)).toEqual([360,840,360]);
    expect(phrase.notes.map(n=>n.duration)).toEqual(clip.notes.map(n=>n.duration));
    expect(quantizeNotes(phrase,"all",240,.5)).toBe(phrase);
    expect(quantizeNotes(clip,"all",0,.5)).toBe(clip);
    expect(quantizeNotes(clip,["c"],240,0,{durations:true}).notes[2].duration).toBe(240);
  });
  it("keeps explicit duration quantization within project limits and leaves unselected notes intact",()=>{
    const clip=fixture();clip.notes[0].duration=MAX_TICK;
    const before=structuredClone(clip),project=createProject();project.tracks[0].clips=[clip];
    expect(projectSchema.safeParse(project).success).toBe(true);
    const quantized=quantizeNotes(clip,["a"],960,0,{durations:true});
    expect(quantized.notes[0].duration).toBe(Math.floor(MAX_TICK/960)*960);
    expect(quantized.notes[0].duration%960).toBe(0);
    expect(quantized.notes[1]).toBe(clip.notes[1]);expect(quantized.notes[2]).toBe(clip.notes[2]);
    expect(clip).toEqual(before);invariant(clip,quantized);
    expect(projectSchema.safeParse({...project,tracks:[{...project.tracks[0],clips:[quantized]}]}).success).toBe(true);
  });
  it("humanizes each source note deterministically, independently of selection scope",()=>{
    const clip=fixture(), options={timingTicks:24,velocity:.1}, selected=humanizeNotes(clip,["b"],123,options), phrase=humanizeNotes(clip,"all",123,options);
    expect(selected).toEqual(humanizeNotes(clip,["b"],123,options));
    expect(selected.notes[1]).toEqual(phrase.notes[1]);expect(selected.notes[0]).toBe(clip.notes[0]);expect(selected.notes[2]).toBe(clip.notes[2]);
    expect(Math.abs(selected.notes[1].tick-clip.notes[1].tick)).toBeLessThanOrEqual(24);
    expect(Math.abs(selected.notes[1].velocity-clip.notes[1].velocity)).toBeLessThanOrEqual(.1);
    expect(phrase.notes[0].velocity-clip.notes[0].velocity).not.toBeCloseTo(phrase.notes[2].velocity-clip.notes[2].velocity,6);
    expect(selected.notes[1].duration).toBe(600);invariant(clip,selected);
    expect(humanizeNotes(clip,"all",123,{timingTicks:0,velocity:0})).toBe(clip);
  });
  it("bounds humanized onsets and velocities without trimming crossing note tails",()=>{
    const clip=fixture();clip.notes[0].tick=0;clip.notes[0].velocity=0;clip.notes[1].tick=959;clip.notes[1].velocity=1;
    const next=humanizeNotes(clip,"all",456,{timingTicks:10000,velocity:2});
    for(const note of next.notes){expect(note.tick).toBeGreaterThanOrEqual(0);expect(note.tick).toBeLessThan(960);expect(note.velocity).toBeGreaterThanOrEqual(0);expect(note.velocity).toBeLessThanOrEqual(1);}
    expect(next.notes.map(n=>n.duration)).toEqual(clip.notes.map(n=>n.duration));invariant(clip,next);
  });
  it("keeps the velocity proposal stable when only timing strength changes",()=>{
    const clip=fixture(), withTiming=humanizeNotes(clip,"all",123,{timingTicks:24,velocity:.1}), withoutTiming=humanizeNotes(clip,"all",123,{timingTicks:0,velocity:.1});
    expect(withoutTiming.notes.map(note=>note.velocity)).toEqual(withTiming.notes.map(note=>note.velocity));
    expect(withoutTiming.notes.map(note=>note.tick)).toEqual(clip.notes.map(note=>note.tick));
  });
  it("rejects timing transforms on latent notes while permitting velocity-only edits",()=>{
    const clip=fixture();clip.notes[1].tick=1200;
    expect(()=>quantizeNotes(clip,"all",240)).toThrow(/source/i);
    expect(()=>humanizeNotes(clip,["b"],123,{timingTicks:24,velocity:.1})).toThrow(/source/i);
    const selected=quantizeNotes(clip,["a"],240);expect(selected.notes[1]).toBe(clip.notes[1]);
    const velocity=humanizeNotes(clip,["b"],123,{timingTicks:0,velocity:.1});
    expect(velocity.notes[1].tick).toBe(1200);expect(velocity.notes[1].duration).toBe(600);
    expect(velocity.notes[1].velocity).not.toBe(clip.notes[1].velocity);expect(velocity.notes[0]).toBe(clip.notes[0]);invariant(clip,velocity);
  });
});

describe("independent note clipboard",()=>{
  it("deeply captures selected notes with relative960PPQ timing while preserving articulation",()=>{
    const clip=fixture(), copied=copyNotes(clip,["b","a"]);
    expect(copied?.ppq).toBe(PPQ);expect(copied?.notes.map(n=>[n.id,n.tick,n.duration])).toEqual([["a",0,300],["b",600,600]]);
    clip.notes[0].articulation="staccato";clip.notes[1].tick=1;
    expect(copied?.notes[0].articulation).toBe("legato");expect(copied?.notes[1].tick).toBe(600);
    expect(copyNotes(clip,[])).toBeNull();
  });
  it("pastes fresh IDs on every use and preserves source tails, payloads and existing note identities",()=>{
    const clip=fixture(), copied=copyNotes(clip,["a","b"])!, ids=["copy_a","copy_b","copy_c","copy_d"];
    const first=pasteNotes(clip,copied,300,()=>ids.shift()!);expect(first.ok).toBe(true);if(!first.ok)throw Error(first.error);
    expect(first.selectedIds).toEqual(["copy_a","copy_b"]);
    expect(first.clip.notes.slice(-2).map(n=>[n.tick,n.duration,n.pitch,n.articulation])).toEqual([[300,300,60,"legato"],[900,600,64,undefined]]);
    expect(first.clip.notes[0]).toBe(clip.notes[0]);invariant(clip,{...first.clip,notes:clip.notes});
    const second=pasteNotes(first.clip,copied,0,()=>ids.shift()!);expect(second.ok).toBe(true);if(!second.ok)throw Error(second.error);
    expect(second.selectedIds).toEqual(["copy_c","copy_d"]);expect(new Set(second.clip.notes.map(n=>n.id)).size).toBe(7);
    expect(copied.notes.map(n=>n.id)).toEqual(["a","b"]);
  });
  it("rejects the complete paste at source bounds, invalid manifests, quotas or ID collisions",()=>{
    const clip=fixture(), copied=copyNotes(clip,["a","b"])!, before=structuredClone(clip);
    expect(pasteNotes(clip,copied,360)).toMatchObject({ok:false});expect(pasteNotes(clip,copied,-1)).toMatchObject({ok:false});
    expect(pasteNotes(clip,copied,.5)).toMatchObject({ok:false});expect(pasteNotes(clip,copied,0,()=>"a")).toMatchObject({ok:false});
    expect(pasteNotes(clip,{...copied,ppq:480},0)).toMatchObject({ok:false});
    const full={...clip,notes:Array.from({length:32000},(_,i)=>({...clip.notes[0],id:`full_${i}`}))};
    expect(pasteNotes(full,copied,0)).toMatchObject({ok:false});expect(clip).toEqual(before);
    expect(noteClipboardSchema.safeParse({...copied,notes:[copied.notes[0],copied.notes[0]]}).success).toBe(false);
    let allocations=0;
    const rejected=pasteNotes(clip,copied,360,()=>{allocations++;return "unused_id";});
    expect(rejected).toMatchObject({ok:false});expect(rejected).not.toHaveProperty("selectedIds");expect(allocations).toBe(0);
  });
  it("duplicates after the selected last end, and rejects instead of dropping a group that does not fit",()=>{
    const clip=fixture(), duplicate=duplicateNotes(clip,["a"],undefined,()=>"new_note");
    expect(duplicate.ok).toBe(true);if(!duplicate.ok)throw Error(duplicate.error);
    expect(duplicate.clip.notes.at(-1)).toEqual({...clip.notes[0],id:"new_note",tick:400});
    expect(duplicateNotes(clip,["a","b"])).toMatchObject({ok:false});
    expect(duplicateNotes(clip,[])).toMatchObject({ok:false});
  });
});

describe("source-note selection and row geometry",()=>{
  it("repairs selection by identity and selects note-body intersections in source time",()=>{
    const clip=fixture();
    expect(reconcileNoteSelection(clip,["b","missing","a","b"])).toEqual(["b","a"]);
    expect(marqueeNoteIds(clip,{startTick:399,endTick:701,lowPitch:60,highPitch:64})).toEqual(["a","b"]);
    expect(marqueeNoteIds(clip,{startTick:400,endTick:700,lowPitch:64,highPitch:60})).toEqual([]);
    expect(marqueeNoteIds(clip,{startTick:900,endTick:700,lowPitch:64,highPitch:64})).toEqual(["b"]);
    expect(marqueeNoteIds(clip,{startTick:700,endTick:700,lowPitch:0,highPitch:127})).toEqual([]);
  });
  it("exposes all MIDI pitches or unique used pitches, with a usable empty folded grid",()=>{
    const clip=fixture();clip.notes.push({...clip.notes[0],id:"low",pitch:0},{...clip.notes[1],id:"high",pitch:127});
    expect(notePitchRows(clip)).toHaveLength(128);expect(notePitchRows(clip)[0]).toBe(127);expect(notePitchRows(clip).at(-1)).toBe(0);
    expect(notePitchRows(clip,true)).toEqual([127,67,64,60,0]);expect(notePitchRows({...clip,notes:[]},true)).toHaveLength(128);
  });
});
