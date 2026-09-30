export type ShortcutAction = "togglePlay" | "stop" | "generated" | "record" | "save" | "undo" | "redo" | "play" | "pause" | "chord" | "progression";
export interface Binding { code: string; primary: boolean; shift: boolean; alt: boolean; }
export type ShortcutPreferences = { version: 1; bindings: Record<ShortcutAction, Binding | null> };
export const ACTION_LABELS: Record<ShortcutAction,string> = {togglePlay:"Play / pause",stop:"Stop all sound",generated:"Audition generated phrase",record:"Record / finish take",save:"Save song",undo:"Undo",redo:"Redo",play:"Play",pause:"Pause",chord:"Audition selected chord",progression:"Audition progression"};
const binding=(code:string,primary=false,shift=false):Binding=>({code,primary,shift,alt:false});
export const STOP_BINDING=binding("Enter",true,true);
export const DEFAULT_SHORTCUTS: ShortcutPreferences={version:1,bindings:{togglePlay:binding("Space"),stop:STOP_BINDING,generated:binding("Space",false,true),record:binding("KeyR",false,true),save:binding("KeyS",true),undo:binding("KeyZ",true),redo:binding("KeyZ",true,true),play:null,pause:null,chord:null,progression:null}};
export const PIANO_CODES: Record<string,number>={KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,KeyY:8,KeyH:9,KeyU:10,KeyJ:11,KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16,Quote:17};
export function eventBinding(event:Pick<KeyboardEvent,"code"|"ctrlKey"|"metaKey"|"shiftKey"|"altKey">):Binding{return {code:event.code,primary:event.ctrlKey||event.metaKey,shift:event.shiftKey,alt:event.altKey};}
export const sameBinding=(a:Binding|null,b:Binding)=>!!a&&a.code===b.code&&a.primary===b.primary&&a.shift===b.shift&&a.alt===b.alt;
export function bindingLabel(b:Binding|null){if(!b)return "Unassigned";return [b.primary?"Ctrl/Cmd":null,b.shift?"Shift":null,b.alt?"Alt":null,b.code==="Space"?"Space":b.code.replace(/^Key|^Digit/,"")].filter(Boolean).join(" + ");}
export function bindingError(action:ShortcutAction,b:Binding,prefs:ShortcutPreferences):string|null{
  if(action!=="stop"&&sameBinding(STOP_BINDING,b))return "This shortcut is reserved for Stop all sound.";
  if(b.code==="Escape"||/^(Control|Meta|Alt|Shift)/.test(b.code))return "Choose a key combination; Escape cancels capture.";
  if(!b.primary&&!b.alt&&!b.shift&&PIANO_CODES[b.code]!==undefined)return "This key is used by the performance piano.";
  if(b.primary&&["KeyW","KeyT","KeyN","KeyL","KeyR","KeyQ","Tab","Digit1","Digit2","Digit3","Digit4","Digit5","Digit6","Digit7","Digit8","Digit9","KeyP","KeyF","KeyH","KeyJ","Equal","Minus","Digit0"].includes(b.code))return "This combination is reserved by the browser.";
  if(["F1","F3","F5","F6","F11","F12"].includes(b.code)||(b.alt&&["ArrowLeft","ArrowRight","Home","F4"].includes(b.code)))return "This combination is reserved by the browser.";
  const conflict=(Object.keys(prefs.bindings) as ShortcutAction[]).find(key=>key!==action&&sameBinding(prefs.bindings[key],b));
  return conflict?"Already assigned to "+ACTION_LABELS[conflict]+".":null;
}
export function readShortcuts(raw:string|null):ShortcutPreferences{
  if(!raw)return structuredClone(DEFAULT_SHORTCUTS);
  try{const data=JSON.parse(raw);if(data.version!==1||typeof data.bindings!=="object")return structuredClone(DEFAULT_SHORTCUTS);
    const next=structuredClone(DEFAULT_SHORTCUTS);
    for(const action of Object.keys(next.bindings) as ShortcutAction[]){if(action==="stop")continue;const b=data.bindings[action];if(b===null)next.bindings[action]=null;else if(b&&typeof b.code==="string"&&typeof b.primary==="boolean"&&typeof b.shift==="boolean"&&typeof b.alt==="boolean")next.bindings[action]=b;}
    for(const action of Object.keys(next.bindings) as ShortcutAction[]) {const b=next.bindings[action];if(action!=="stop"&&b&&bindingError(action,b,next))next.bindings[action]=null;}
    next.bindings.stop=STOP_BINDING;return next;
  }catch{return structuredClone(DEFAULT_SHORTCUTS);}
}
