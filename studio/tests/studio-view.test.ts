import {describe, expect, it} from "vitest";
import {createDemo, projectEnd} from "../lib/music/project";
import {defaultStudioView, detailToolForMode, readStudioView, reconcileStudioView, selectStudioClip, selectStudioSection, selectStudioTrack, studioViewKey, StudioViewPreferences} from "../lib/client/studio-view";

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
    const initial={...defaultStudioView(project),mode:"sound" as const,detailTool:"movement" as const,songViewport:{zoom:74,leftTick:960,scrollTop:124,follow:true}};
    const first=selectStudioClip(project,initial,a.id,a.clips[0].id)!;
    expect(first.mode).toBe("sound");
    expect(first.detailTool).toBe("notes");
    const second=selectStudioClip(project,first,b.id,b.clips[0].id)!;
    const returned=selectStudioTrack(project,{...second,detailTool:"sound"},a.id)!;
    expect(returned.clip).toBe(a.clips[0].id);
    expect(returned.mode).toBe("sound");
    expect(returned.detailTool).toBe("sound");
    expect(returned.songViewport).toEqual(initial.songViewport);
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
  it("selects a valid section while preserving track, phrase, focus and viewport",()=>{
    const project=createDemo(),chord=project.chords[0],track=project.tracks[1];
    const selected={...selectStudioClip(project,defaultStudioView(project),track.id,track.clips[0].id)!,
      section:chord.sectionId,chord:chord.id,mode:"write" as const,detailTool:"writing" as const,
      songViewport:{zoom:82,leftTick:960,scrollTop:70,follow:false}};
    expect(selectStudioSection(project,selected,chord.sectionId)).toEqual(selected);
    expect(selectStudioSection(project,selected,"removed")).toBeNull();
    const destination=project.sections.find(section=>section.id!==chord.sectionId)!;
    expect(selectStudioSection(project,selected,destination.id)).toEqual({...selected,section:destination.id,chord:""});
    const added={...destination,id:"new-section",startTick:projectEnd(project)};
    const committed={...project,sections:[...project.sections,added]};
    expect(selectStudioSection(committed,selected,added.id)?.section).toBe(added.id);
  });
  it("maps focus presets to tools while Mix retains the active editor",()=>{
    expect(detailToolForMode("write","sound")).toBe("writing");
    expect(detailToolForMode("arrange","sound")).toBe("notes");
    expect(detailToolForMode("sound","notes")).toBe("sound");
    expect(detailToolForMode("mix","automation")).toBe("automation");
  });
  it("restores a song viewport without changing existing v2 selections or tools",()=>{
    const project=createDemo(),base=defaultStudioView(project);
    expect(base.songViewport).toEqual({zoom:38,leftTick:0,scrollTop:0,follow:false});
    const old={...base,mode:"sound",detailTool:"movement",track:project.tracks[1].id};
    delete (old as Partial<typeof old>).songViewport;
    expect(readStudioView(JSON.stringify(old),project)).toMatchObject({...old,songViewport:base.songViewport});
    const saved={...base,songViewport:{zoom:76,leftTick:1440,scrollTop:157.5,follow:true}};
    expect(readStudioView(JSON.stringify(saved),project)).toEqual(saved);
  });
  it("validates each viewport field and clamps canonical horizontal position when the song shortens",()=>{
    const project=createDemo(),base=defaultStudioView(project);
    const restored=readStudioView(JSON.stringify({...base,songViewport:{zoom:0,leftTick:projectEnd(project)+100,scrollTop:-1,follow:"true"}}),project);
    expect(restored.songViewport).toEqual({zoom:.001,leftTick:projectEnd(project),scrollTop:0,follow:false});
    const changed={...project,sections:project.sections.slice(0,1),tracks:project.tracks.map(track=>({...track,clips:[]}))};
    const reconciled=reconcileStudioView(changed,{...base,songViewport:{zoom:100,leftTick:projectEnd(project),scrollTop:180.25,follow:true}});
    expect(reconciled.songViewport).toEqual({zoom:100,leftTick:projectEnd(changed),scrollTop:180.25,follow:true});
    const invalid=readStudioView(JSON.stringify({...base,songViewport:{zoom:null,leftTick:7.8,scrollTop:null,follow:1}}),project);
    expect(invalid.songViewport).toEqual({zoom:38,leftTick:8,scrollTop:0,follow:false});
  });
  it("uses finite defaults for unsafe runtime viewport values",()=>{
    const project=createDemo(),base=defaultStudioView(project);
    const reconciled=reconcileStudioView(project,{...base,songViewport:{zoom:Infinity,leftTick:NaN,scrollTop:Infinity,follow:false}});
    expect(reconciled.songViewport).toEqual(base.songViewport);
    expect(reconcileStudioView(project,{...base,songViewport:{zoom:101,leftTick:-1,scrollTop:Number.MAX_VALUE,follow:true}}).songViewport)
      .toEqual({zoom:100,leftTick:0,scrollTop:Number.MAX_SAFE_INTEGER,follow:true});
  });
  it("keeps canonical viewport during a provisional shorter song edit until it commits",()=>{
    const project=createDemo(),base=defaultStudioView(project);
    const preview={...project,sections:project.sections.slice(0,1),tracks:project.tracks.map(track=>({...track,clips:[]}))};
    const view={...base,songViewport:{zoom:78,leftTick:projectEnd(project)-960,scrollTop:120,follow:false}};
    expect(reconcileStudioView(preview,view,project).songViewport).toEqual(view.songViewport);
    expect(reconcileStudioView(preview,view).songViewport.leftTick).toBe(projectEnd(preview));
  });
  it("retains failed preference writes when returning to the same scope and isolates other owners",()=>{
    const project=createDemo(),base=defaultStudioView(project),preferences=new StudioViewPreferences();
    const key=studioViewKey("guest",project.id),otherKey=studioViewKey("signed-in",project.id);
    const values=new Map<string,string>();
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    expect(preferences.load(key,project,()=>storage).view).toEqual(base);
    const saved={...base,detailTool:"movement" as const,songViewport:{zoom:82,leftTick:1440,scrollTop:170,follow:true}};
    const failure=preferences.save(key,saved,()=>({...storage,setItem:()=>{throw new Error("Full");}}));
    expect(failure).toMatchObject({kind:"write",message:expect.stringContaining("could not be saved")});
    expect(preferences.load(otherKey,project,()=>storage).view).toEqual(base);
    expect(preferences.load(key,project,()=>storage)).toEqual({view:saved,failure});
    expect(preferences.save(key,saved,()=>storage)).toEqual({message:"",kind:null});
    expect(JSON.parse(values.get(key)!)).toEqual(saved);
    expect(preferences.load(key,project,()=>storage).failure).toEqual({message:"",kind:null});
  });
  it("reports inaccessible storage without preventing scoped session restoration",()=>{
    const project=createDemo(),base=defaultStudioView(project),preferences=new StudioViewPreferences();
    const key=studioViewKey("guest",project.id),unavailable=()=>{throw new Error("Access denied");};
    const first=preferences.load(key,project,unavailable);
    expect(first.view).toEqual(base);
    expect(first.failure).toMatchObject({kind:"read",message:expect.stringContaining("could not be read")});
    const saved={...base,songViewport:{zoom:80,leftTick:960,scrollTop:30,follow:false}};
    preferences.save(key,saved,unavailable);
    expect(preferences.load(key,project,unavailable).view).toEqual(saved);
    expect(preferences.load(studioViewKey("guest","another"),{...project,id:"another"},unavailable).view.songViewport).toEqual(base.songViewport);
  });
});
