import {describe,it,expect} from "vitest";
import {createProject,createTrack} from "../lib/music/project";
import {applyPreview,previewEdit,commitTransaction,gestureSavepoint,restoreGesture,type EditTransaction} from "../lib/music/transactions";
import {historyReducer,type History} from "../lib/music/edit";
describe("scoped gesture history",()=>{
  it.each(["modulation-ab:track", "reference-preview"])("rolls back only a child gesture inside %s and applies the audition once",owner=>{
    const p=createProject();
    let tx=previewEdit({owner,projectId:p.id,label:"Audition",patches:[],invalid:null},p,{...p,title:"Staged",tracks:p.tracks.map(t=>({...t,pan:.2}))});
    const saved=gestureSavepoint(tx,"knob:pan",owner), staged=applyPreview(p,tx);
    tx=previewEdit(tx,staged,{...staged,tracks:staged.tracks.map(t=>({...t,pan:.8}))});
    tx={...tx,invalid:"Bad numeric entry"};
    const restored=restoreGesture(tx,saved);expect(restored.restored).toBe(true);
    if(!restored.restored||!restored.transaction)throw Error("Missing audition savepoint");
    expect(applyPreview(p,restored.transaction)).toEqual(staged);
    expect(restored.transaction.invalid).toBeNull();
    const result=commitTransaction(p,restored.transaction);if(!result.ok)throw Error(result.error);
    let h:History={present:p,past:[],future:[],label:""};h=historyReducer(h,{type:"commit",project:result.document,label:"Apply audition"});
    expect(h.past).toHaveLength(1);h=historyReducer(h,{type:"undo"});expect(h.present).toEqual(p);
    h=historyReducer(h,{type:"redo"});expect(h.present).toEqual(staged);
    // Savepoints are independent snapshots, even if a field patch is mutated later.
    restored.transaction.patches[0].after="Changed after restore";
    expect(saved.savepoint).toEqual(gestureSavepoint(previewEdit({owner,projectId:p.id,label:"Audition",patches:[],invalid:null},p,staged),"knob:pan",owner).savepoint);
  });
  it("ordinary gesture cancellation removes its preview and stale cancellation preserves newer owners",()=>{
    const p=createProject(),tx:EditTransaction={owner:"knob:pan",projectId:p.id,label:"Pan",patches:[],invalid:null};
    const saved=gestureSavepoint(tx,tx.owner!);
    expect(restoreGesture(tx,saved)).toEqual({restored:true,transaction:null});
    expect(restoreGesture({...tx,owner:"knob:gain"},saved)).toEqual({restored:false});
    expect(restoreGesture({...tx,projectId:"other-song"},saved)).toEqual({restored:false});
    expect(restoreGesture(null,saved)).toEqual({restored:false});
  });
  it("rejects adding an optional field to a concurrently removed note",()=>{const p=createProject();p.tracks[0].clips=[{id:"clip",name:"Phrase",startTick:0,lengthTick:960,sourceLengthTick:960,loop:false,transpose:0,events:[],notes:[{id:"note",pitch:60,tick:0,duration:480,velocity:.7}]}];const next=structuredClone(p);next.tracks[0].clips[0].notes[0].articulation="sustain";const tx=previewEdit({projectId:p.id,label:"Articulation",patches:[],invalid:null},p,next);const removed=structuredClone(p);removed.tracks[0].clips[0].notes=[];expect(commitTransaction(removed,tx).ok).toBe(false);expect(applyPreview(removed,tx)).toEqual(removed);});
  it("coalesces newly inserted entities and rejects missing optional-field owners",()=>{const p=createProject(),track=createTrack("lead");let tx:EditTransaction={projectId:p.id,label:"Track",patches:[],invalid:null};const next={...p,tracks:[...p.tracks,track]};tx=previewEdit(tx,p,next);const later={...next,tracks:next.tracks.map(t=>t.id===track.id?{...t,pan:.4}:t)};tx=previewEdit(tx,next,later);const result=commitTransaction(p,tx);expect(result.ok).toBe(true);if(result.ok)expect(result.document.tracks.at(-1)?.pan).toBe(.4);const ordered=previewEdit({projectId:p.id,label:"Order",patches:[],invalid:null},next,{...next,tracks:[...next.tracks].reverse()});expect(ordered.patches.length).toBeGreaterThan(0);const pan=previewEdit({projectId:p.id,label:"Pan",patches:[],invalid:null},p,{...p,tracks:p.tracks.map(t=>({...t,pan:.2}))});expect(commitTransaction({...p,tracks:[...p.tracks,...p.tracks]},pan).ok).toBe(false);});
  it("preserves an import across drag commit, Cancel and Undo",()=>{const p=createProject(),tx:EditTransaction={projectId:p.id,label:"Volume",patches:[],invalid:null};const changed={...p,tracks:p.tracks.map(t=>({...t,volume:-12}))};const preview=previewEdit(tx,p,changed),imported={...p,tracks:[...p.tracks,createTrack("lead")]};expect(applyPreview(imported,preview).tracks).toHaveLength(2);expect(imported.tracks[0].volume).toBe(p.tracks[0].volume);const result=commitTransaction(imported,preview);if(!result.ok)throw Error(result.error);let h:History={present:imported,past:[p],future:[],label:"Import"};h=historyReducer(h,{type:"commit",project:result.document,label:"Volume"});h=historyReducer(h,{type:"undo"});expect(h.present).toEqual(imported);});
  it("detects same-field conflicts and missing targets",()=>{const p=createProject(),tx=previewEdit({projectId:p.id,label:"Pan",patches:[],invalid:null},p,{...p,tracks:p.tracks.map(t=>({...t,pan:.5}))});expect(commitTransaction({...p,tracks:p.tracks.map(t=>({...t,pan:-.5}))},tx).ok).toBe(false);expect(commitTransaction({...p,tracks:[]},tx).ok).toBe(false);});
  it("groups repeated field previews and keeps unrelated lyrics",()=>{const p=createProject();let tx:EditTransaction={projectId:p.id,label:"Title",patches:[],invalid:null};let view=p;for(const title of ["A","Ab","Abc"]){const next={...view,title};tx=previewEdit(tx,view,next);view=applyPreview(p,tx);}expect(tx.patches).toHaveLength(1);const edited={...p,notes:"Unrelated note"};const result=commitTransaction(edited,tx);if(!result.ok)throw Error(result.error);expect(result.document.title).toBe("Abc");expect(result.document.notes).toBe("Unrelated note");});
});
