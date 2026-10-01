import {describe, expect, it} from "vitest";
import {createDemo} from "../lib/music/project";
import {defaultStudioView, detailToolForMode, readStudioView, reconcileStudioView, selectStudioClip, selectStudioTrack, studioViewKey} from "../lib/client/studio-view";

describe("shared studio view",()=>{
  it("opens fresh songs in Arrange with the note editor",()=>{
    const project=createDemo(), view=defaultStudioView(project);
    expect(view.mode).toBe("arrange");
    expect(view.detailTool).toBe("notes");
    expect(view.track).toBe(project.tracks[0].id);
    expect(view.clip).toBe("");
  });
  it("selects clips without changing focus and remembers each track's phrase",()=>{
    const project=createDemo(), a=project.tracks[0], b=project.tracks[1];
    const initial={...defaultStudioView(project),mode:"sound" as const,detailTool:"movement" as const};
    const first=selectStudioClip(project,initial,a.id,a.clips[0].id)!;
    expect(first.mode).toBe("sound");
    expect(first.detailTool).toBe("notes");
    const second=selectStudioClip(project,first,b.id,b.clips[0].id)!;
    const returned=selectStudioTrack(project,{...second,detailTool:"sound"},a.id)!;
    expect(returned.clip).toBe(a.clips[0].id);
    expect(returned.mode).toBe("sound");
    expect(returned.detailTool).toBe("sound");
    expect(selectStudioClip(project,initial,a.id,b.clips[0].id)).toBeNull();
    expect(selectStudioTrack(project,initial,"removed")).toBeNull();
  });
  it("prunes removed selection and memories without resetting focus",()=>{
    const project=createDemo(), track=project.tracks[0], clip=track.clips[0];
    const view=selectStudioClip(project,{...defaultStudioView(project),mode:"mix",detailTool:"automation"},track.id,clip.id)!;
    const changed={...project,tracks:project.tracks.map(t=>t.id===track.id?{...t,clips:[]}:t)};
    const reconciled=reconcileStudioView(changed,{...view,detailTool:"automation"});
    expect(reconciled.clip).toBe("");
    expect(reconciled.clips[track.id]).toBeUndefined();
    expect(reconciled.mode).toBe("mix");
    expect(reconciled.detailTool).toBe("automation");
    expect(reconcileStudioView({...changed,tracks:changed.tracks.slice(1)},reconciled).track).toBe(project.tracks[1].id);
  });
  it("validates only v2 view data and scopes keys by owner and project",()=>{
    const project=createDemo(), base=defaultStudioView(project);
    expect(readStudioView("not json",project)).toEqual(base);
    expect(readStudioView(JSON.stringify({...base,version:1,mode:"write"}),project)).toEqual(base);
    const restored=readStudioView(JSON.stringify({...base,mode:"mix",detailTool:"reference",track:"missing",clips:{missing:"nope"}}),project);
    expect(restored.track).toBe(base.track);
    expect(restored.clips).toEqual({});
    expect(restored.detailTool).toBe("reference");
    expect(readStudioView(JSON.stringify({...base,mode:"unknown",detailTool:"unknown",clips:null}),project)).toEqual(base);
    expect(studioViewKey("guest",project.id)).not.toBe(studioViewKey("user",project.id));
    expect(studioViewKey("a:b","c")).not.toBe(studioViewKey("a","b:c"));
  });
  it("restores the active clip and independently remembered phrases from v2 data",()=>{
    const project=createDemo(),a=project.tracks[0],b=project.tracks[1];
    const first=selectStudioClip(project,defaultStudioView(project),a.id,a.clips[0].id)!;
    const second=selectStudioClip(project,first,b.id,b.clips[0].id)!;
    const saved={...second,detailTool:"reference" as const};
    expect(readStudioView(JSON.stringify(saved),project)).toEqual(saved);
    expect(selectStudioTrack(project,readStudioView(JSON.stringify(saved),project),a.id)?.clip).toBe(a.clips[0].id);
  });
  it("reconciles removed sections and chords against the same project",()=>{
    const project=createDemo(),chord=project.chords[0];
    const selected={...defaultStudioView(project),section:chord.sectionId,chord:chord.id};
    expect(reconcileStudioView(project,selected).chord).toBe(chord.id);
    expect(reconcileStudioView({...project,chords:[]},selected).chord).toBe("");
    const changed={...project,sections:project.sections.filter(section=>section.id!==chord.sectionId)};
    const reconciled=reconcileStudioView(changed,selected);
    expect(changed.sections.some(section=>section.id===reconciled.section)).toBe(true);
    expect(reconciled.chord).toBe("");
  });
  it("maps focus presets to tools while Mix retains the active editor",()=>{
    expect(detailToolForMode("write","sound")).toBe("writing");
    expect(detailToolForMode("arrange","sound")).toBe("notes");
    expect(detailToolForMode("sound","notes")).toBe("sound");
    expect(detailToolForMode("mix","automation")).toBe("automation");
  });
});
