import {describe,it,expect} from "vitest";
import {createProject} from "../lib/music/project";
import {chordMoveDestination,chordPlacement} from "../lib/music/chord-placement";
import {chordCommand} from "../lib/music/chord-commands";

describe("direct palette placement",()=>{
  const fixture=()=>{const p=createProject(),s=p.sections[0];s.startTick=960;s.lengthTick=7680;p.chords=[{id:"c",sectionId:s.id,tick:960,duration:1920,symbol:"C",notes:[60,64,67]},{id:"g",sectionId:s.id,tick:4800,duration:1920,symbol:"G",notes:[55,62,67]}];return p;};
  it("replaces an occupied span without changing timing, identity or parts",()=>{
    const p=fixture(),s=p.sections[0],card={...p.chords[0],id:"new",symbol:"Dm",notes:[62,65,69],duration:3840};
    const placement=chordPlacement(p,s.id,1920,card,"split");if(!placement.ok)throw Error(placement.error);
    const r=chordCommand(p,placement.command);if(!r.ok)throw Error(r.error);
    expect(r.document.chords[0]).toEqual({...p.chords[0],symbol:"Dm",notes:card.notes});expect(r.document.chords[1]).toEqual(p.chords[1]);expect(r.document.tracks).toBe(p.tracks);expect(r.selectedId).toBe("c");
  });
  it("inserts at a snapped rest and rejects overflow without mutating the candidate",()=>{
    const p=fixture(),s=p.sections[0],card={...p.chords[0],id:"new",duration:960};
    const placement=chordPlacement(p,s.id,3360,card,"split");if(!placement.ok)throw Error(placement.error);const r=chordCommand(p,placement.command);if(!r.ok)throw Error(r.error);
    expect(r.document.chords.find(c=>c.id==="new")?.tick).toBe(3360);expect(r.document.chords.find(c=>c.id==="g")?.tick).toBe(5760);
    const before=JSON.stringify(p);expect(chordPlacement(p,s.id,7200,{...card,duration:3840},"split").ok).toBe(false);expect(JSON.stringify(p)).toBe(before);expect(card.duration).toBe(960);
  });
  it("uses half-open targets and refuses legacy overlaps or duplicate identities",()=>{
    const p=fixture(),s=p.sections[0],card={...p.chords[0],id:"new",duration:960};
    const rest=chordPlacement(p,s.id,2880,card,"split");expect(rest.ok&&rest.command.type).toBe("insert");
    p.chords.push({...p.chords[0],id:"overlap",tick:1440});expect(chordPlacement(p,s.id,1920,card,"split").ok).toBe(false);
    p.chords[2]={...p.chords[0],tick:7200};expect(chordPlacement(p,s.id,1920,card,"split").ok).toBe(false);
  });
});

describe("intact canvas movement",()=>{
  const fixture=()=>{const p=createProject(),s=p.sections[0];s.startTick=960;s.lengthTick=4*3840;p.chords=["A","B","C","D"].map((id,i)=>({id,sectionId:s.id,tick:s.startTick+i*3840,duration:3840,symbol:id,notes:[48+i,60+i,64+i]}));return p;};
  function move(p:ReturnType<typeof createProject>,id:string,tick:number){const r=chordMoveDestination(p,p.sections[0].id,id,tick,"unused-split");if(!r.ok)throw Error(r.error);const c=chordCommand(p,r.command);if(!c.ok)throw Error(c.error);return c.document;}
  it("reorders a full section without fragments or overflow through repeated moves",()=>{
    const p=fixture(),start=p.sections[0].startTick;
    const next=move(p,"A",start+2*3840+960);
    expect([...next.chords].sort((a,b)=>a.tick-b.tick).map(c=>c.id)).toEqual(["B","A","C","D"]);
    let result=next;for(let i=0;i<8;i++){result=move(result,"D",start+960);result=move(result,"D",start+3*3840+960);}
    expect(result.chords).toHaveLength(4);for(const c of result.chords){const original=p.chords.find(x=>x.id===c.id)!;expect(c.duration).toBe(original.duration);expect(c.notes).toEqual(original.notes);}
    expect(result.tracks).toBe(p.tracks);expect(JSON.stringify(p.chords)).not.toContain("unused-split");
  });
  it("translates visual rest positions after removal and keeps internal rests",()=>{
    const p=fixture(),s=p.sections[0];p.chords=p.chords.slice(0,3);p.chords[0].duration=960;p.chords[1].tick=s.startTick+1920;p.chords[1].duration=1920;p.chords[2].tick=s.startTick+4800;p.chords[2].duration=960;
    const next=move(p,"A",s.startTick+4320);
    expect(next.chords.find(c=>c.id==="A")?.tick).toBe(s.startTick+3360);
    expect(next.chords.find(c=>c.id==="B")?.tick).toBe(s.startTick+960);
    expect(next.chords.find(c=>c.id==="C")?.tick).toBe(s.startTick+4800);
  });
  it("leaves own-card drops unchanged and rejects ambiguous legacy source/targets",()=>{
    const p=fixture(),s=p.sections[0];expect(move(p,"A",s.startTick+960)).toBe(p);
    p.chords.push({...p.chords[1],id:"overlap",tick:p.chords[1].tick+960});const before=JSON.stringify(p);
    expect(chordMoveDestination(p,s.id,"A",p.chords[1].tick+1920,"split").ok).toBe(false);
    expect(chordMoveDestination(p,s.id,"B",p.chords[0].tick,"split").ok).toBe(false);expect(JSON.stringify(p)).toBe(before);
  });
});
