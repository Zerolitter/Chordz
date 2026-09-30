import { describe,it,expect } from "vitest";
import {DEFAULT_SHORTCUTS,STOP_BINDING,bindingError,readShortcuts,sameBinding} from "../lib/client/shortcuts";
describe("shortcut preferences",()=>{
  it("matches exact modifiers",()=>{expect(sameBinding(DEFAULT_SHORTCUTS.bindings.togglePlay,{code:"Space",primary:false,shift:true,alt:false})).toBe(false);});
  it("reserves Stop and rejects piano/browser/conflicts",()=>{expect(bindingError("play",STOP_BINDING,DEFAULT_SHORTCUTS)).toContain("reserved");expect(bindingError("play",{code:"KeyA",primary:false,shift:false,alt:false},DEFAULT_SHORTCUTS)).toContain("piano");expect(bindingError("play",{code:"KeyW",primary:true,shift:false,alt:false},DEFAULT_SHORTCUTS)).toContain("browser");expect(bindingError("play",DEFAULT_SHORTCUTS.bindings.togglePlay!,DEFAULT_SHORTCUTS)).toContain("assigned");});
  it("recovers corrupt preferences and protects Stop",()=>{expect(readShortcuts("bad")).toEqual(DEFAULT_SHORTCUTS);const p=structuredClone(DEFAULT_SHORTCUTS);p.bindings.stop=null;expect(readShortcuts(JSON.stringify(p)).bindings.stop).toEqual(STOP_BINDING);});
});
