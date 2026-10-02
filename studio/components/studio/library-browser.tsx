"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Drum, Guitar, Music2, Piano, Search, Star, Waves, Wind } from "lucide-react";
import { useStudio } from "./use-studio";
import { instrumentFor, instruments, instrumentSettings } from "../../lib/audio/catalog";
import { createTrack, emptyClip, ticksPerBar } from "../../lib/music/project";
import { generatePart } from "../../lib/music/generate";
import { createPhraseEntry, createSoundEntry, phraseCompatibility, type LibraryEntry } from "../../lib/music/reusable-library";
import type { DetailTool } from "../../lib/client/studio-view";
import type { GenerationOptions, ProjectDocument, Section } from "../../lib/music/types";
import { entrySampleProvenance } from "../../lib/music/refined-sample";
import "./library-browser.css";

type LibraryTab = "sounds" | "ideas" | "favorites" | "recent";
type Placement = "insert" | "replace" | "alternative" | "keep-modulation";
type PlacementResult = {ok:boolean;error?:string;overlap?:boolean;soundConflict?:boolean;reasons?:string[]};
const tabs:LibraryTab[] = ["sounds","ideas","favorites","recent"];

function catalogId(id:string) {
  if (id.length <= 88) return `factory_${id}`;
  let a = 2166136261, b = 5381;
  for (const character of id) {a = Math.imul(a ^ character.charCodeAt(0),16777619);b = Math.imul(b,33) ^ character.charCodeAt(0);}
  return `factory_${id.slice(0,71)}_${(a >>> 0).toString(16).padStart(8,"0")}${(b >>> 0).toString(16).padStart(8,"0")}`;
}

function builtInEntries(project:ProjectDocument, section:Section, includeIdeas:boolean) {
  const signatures = new Set<string>();
  const catalog = instruments(project).filter(instrument => {
    // Reusing a factory sound creates a fresh manifest identity, not another catalog choice.
    const signature = JSON.stringify({...instrument,id:""});
    if (signatures.has(signature)) return false;
    signatures.add(signature); return true;
  });
  const sounds = catalog.map(instrument => {
    const track = createTrack(instrument.id,instrument.name);
    track.sound = instrumentSettings(instrument);
    return createSoundEntry(project,track,instrument.name,catalogId(instrument.id));
  });
  if (!includeIdeas) return sounds;
  const recipes:{name:string;role:GenerationOptions["role"];instrument:string;register:number}[] = [
    {name:"Chord foundation",role:"chords",instrument:"pad",register:3},
    {name:"Bass foundation",role:"bass",instrument:"bass",register:1},
    {name:"Steady drums",role:"drums",instrument:"drums",register:2},
    {name:"Melody sketch",role:"melody",instrument:"lead",register:4},
    {name:"Moving arpeggio",role:"arpeggio",instrument:"lead",register:3},
  ];
  return [...sounds,...recipes.map((recipe,index) => {
    const track = createTrack(recipe.instrument,recipe.name);
    const clip = emptyClip(0,section.lengthTick,recipe.name);
    clip.notes = generatePart(project,section,{role:recipe.role,register:recipe.register,energy:.5,density:.6,tension:.35,seed:project.seed+index});
    return createPhraseEntry(project,track,clip,recipe.name,`idea_${recipe.role}`);
  })];
}

function EntryIcon({entry}:{entry:LibraryEntry}) {
  const family = entry.sound.instrument.family.toLowerCase();
  const Icon = entry.kind === "audio" ? AudioLines : /percussion|drum/.test(family) ? Drum
    : /guitar|bass/.test(family) ? Guitar : /key|piano/.test(family) ? Piano
      : /synth/.test(family) ? Waves : /wind|brass/.test(family) ? Wind : Music2;
  return <Icon size={16} aria-hidden="true"/>;
}

export function LibraryBrowser({active,onTool}:{active:boolean;onTool:(tool:DetailTool)=>void}) {
  const s = useStudio();
  const scope = `${s.user?.userId ?? "guest"}:${s.project.id}`;
  const scopeRef = useRef(scope);
  useLayoutEffect(() => {scopeRef.current = scope;},[scope]);
  const [tabState,setTabState] = useState<{key:string;tab:LibraryTab}>({key:"",tab:"sounds"});
  const tabKey = `${scope}:${s.mode}`;
  const tab = tabState.key === tabKey ? tabState.tab : s.mode === "write" ? "ideas" : "sounds";
  const [search,setSearch] = useState("");
  const [kind,setKind] = useState("all");
  const [family,setFamily] = useState("all");
  const [selection,setSelection] = useState<{scope:string;entry:LibraryEntry}|null>(null);
  const [proposal,setProposal] = useState<{scope:string;entry:LibraryEntry;result:PlacementResult}|null>(null);
  const [status,setStatus] = useState<{scope:string;text:string;error:boolean}|null>(null);
  const [saving,setSaving] = useState<{scope:string;kind:"sound"|"phrase";name:string}|null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const previewRequest = useRef(0);
  const nameId = useId();
  useLayoutEffect(() => {resultList.current?.scrollTo({top:0});},[scope,tab,search,kind,family]);
  const factory = useMemo(() => active ? builtInEntries(s.project,s.selectedSection,tab !== "sounds") : [],[active,s.project,s.selectedSection,tab]);
  const allEntries = [...factory,...s.libraryEntries];
  const favorites = new Set(s.libraryPreferences.favorites);
  const recent = s.libraryPreferences.recents;
  const families = [...new Set(allEntries.map(entry => entry.sound.instrument.family))].sort();
  const query = search.trim().toLowerCase();
  let entries = allEntries.filter(entry =>
    (tab === "sounds" ? entry.kind === "sound" : tab === "ideas" ? entry.kind !== "sound" : tab === "favorites" ? favorites.has(entry.id) : recent.includes(entry.id))
    && (kind === "all" || entry.kind === kind)
    && (family === "all" || entry.sound.instrument.family === family)
    && (!query || `${entry.name} ${entry.kind} ${entry.sound.instrument.name} ${entry.sound.instrument.family}`.toLowerCase().includes(query)));
  if (tab === "recent") entries = entries.sort((a,b) => recent.indexOf(a.id)-recent.indexOf(b.id));
  const chosen = selection?.scope === scope ? selection.entry
    : entries.find(entry => entry.kind === "sound" && entry.sound.instrument.id === s.selectedTrack?.instrumentId) ?? entries[0];
  const rejected = proposal?.scope === scope && proposal.entry.id === chosen?.id ? proposal : null;
  const incompatiblePhrase = chosen?.kind === "phrase" && s.selectedTrack && !phraseCompatibility(chosen,s.selectedTrack,instrumentFor(s.project,s.selectedTrack)).ok;
  const message = status?.scope === scope ? status : null;
  const saveForm = saving?.scope === scope ? saving : null;
  const busy = !s.libraryReady || !!s.libraryBusy || s.recordingPhase !== "idle";
  const previousActive = useRef(active);

  useEffect(() => {
    if (previousActive.current && !active) {++previewRequest.current;s.cancelLibraryPreview();}
    previousActive.current = active;
  },[active,s]);
  function stopPreview() {++previewRequest.current;s.cancelLibraryPreview();}
  function browse(next:LibraryTab) {
    stopPreview();
    setTabState({key:tabKey,tab:next});
    setSelection(null); setProposal(null); setStatus(null);
    setKind("all"); setFamily("all");
  }
  function choose(entry:LibraryEntry) {
    stopPreview();
    setSelection({scope,entry:structuredClone(entry)});
    setProposal(null); setStatus(null);
  }
  async function place(action:Placement) {
    if (!chosen || busy) return;
    const entry = structuredClone(rejected?.entry ?? chosen), expectedScope = scope;
    setStatus(null);
    const result = await s.useLibraryEntry(entry,action);
    if (scopeRef.current !== expectedScope) return;
    if (result.ok) {
      setProposal(null);
      setStatus({scope,text:action === "replace" || action === "keep-modulation" ? `${entry.name} replaced.` : `${entry.name} inserted.`,error:false});
    } else {
      setProposal({scope,entry,result});
      setStatus({scope,text:result.error ?? "The proposal was not placed. Review its destination and try again.",error:true});
    }
  }
  async function preview() {
    if (!chosen || busy) return;
    const expectedScope = scope, request = ++previewRequest.current;
    setStatus(null);
    if (!await s.previewLibraryEntry(structuredClone(chosen)) && scopeRef.current === expectedScope && previewRequest.current === request)
      setStatus({scope,text:"Preview did not start. Review the library message and try again.",error:true});
  }
  async function save() {
    if (!saveForm || !saveForm.name.trim() || busy) return;
    const expectedScope = scope;
    const ok = saveForm.kind === "sound" ? await s.saveSelectedSound(saveForm.name) : await s.saveSelectedPhrase(saveForm.name);
    if (scopeRef.current !== expectedScope || !ok) return;
    setSaving(null); setStatus({scope,text:`${saveForm.name.trim()} saved to your library.`,error:false});
  }
  async function remove() {
    if (!chosen || busy) return;
    const expectedScope = scope;
    if (!await s.removeLibraryEntry(chosen.id) || scopeRef.current !== expectedScope) return;
    setSelection(null); setProposal(null); setStatus({scope,text:"Library entry removed. Inserted music remains in the song.",error:false});
  }
  return <div className="library-browser" data-edit-policy="bypass" aria-busy={!!s.libraryBusy}>
    <div className="assets-heading"><span className="eyebrow">Your library</span><h2>{tab[0].toUpperCase()+tab.slice(1)}</h2></div>
    <div className="library-tabs" aria-label="Library collections">{tabs.map(value => <button key={value} aria-pressed={tab === value} onClick={() => browse(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
    <div className="library-search"><label><Search size={13} aria-hidden="true"/><input aria-label="Search library" type="search" value={search} placeholder="Search sounds and ideas" onChange={event => {stopPreview();setSearch(event.target.value);}}/></label>
      <div><select aria-label="Library type" value={kind} onChange={event => {stopPreview();setKind(event.target.value);}}><option value="all">All types</option><option value="sound">Sounds</option><option value="phrase">MIDI / drums</option><option value="audio">Audio</option></select>
        <select aria-label="Instrument family" value={family} onChange={event => {stopPreview();setFamily(event.target.value);}}><option value="all">All families</option>{families.map(value => <option key={value}>{value}</option>)}</select></div>
    </div>
    <div ref={resultList} className="library-results" aria-label="Library results">
      {!s.libraryReady && <p className="library-empty" role="status">Loading your saved entries…</p>}
      {entries.map(entry => <div className="library-row" key={entry.id} data-kind={entry.kind}>
        <button className="library-choice" disabled={!!s.libraryBusy} aria-label={`${!entry.id.startsWith("factory_") && allEntries.some(other => other.id !== entry.id && other.name === entry.name && other.sound.instrument.family === entry.sound.instrument.family) ? "Saved " : ""}${entry.name} ${entry.sound.instrument.family}`} aria-pressed={entry.id === chosen?.id} onClick={() => choose(entry)}><EntryIcon entry={entry}/><span><strong>{entry.name}</strong><small>{entry.kind === "sound" ? `${s.libraryEntries.some(saved => saved.id === entry.id) ? "Saved · " : ""}${entry.sound.instrument.family}` : entry.kind === "audio" ? `Audio · ${entry.visibleDurationSec?.toFixed(1) ?? ""} s` : `Phrase · ${entry.clip?.notes.length ?? 0} notes`}</small></span></button>
        <button className="library-star" disabled={!s.libraryReady || !!s.libraryBusy} aria-label={`${favorites.has(entry.id) ? "Unfavorite" : "Favorite"} ${entry.name}`} aria-pressed={favorites.has(entry.id)} onClick={() => void s.toggleLibraryFavorite(entry.id)}><Star size={14} aria-hidden="true" fill={favorites.has(entry.id) ? "currentColor" : "none"}/></button>
      </div>)}
      {!entries.length && s.libraryReady && <p className="library-empty">{query || kind !== "all" || family !== "all" ? "No matching entries. Try another search or filter." : tab === "favorites" ? "Star a sound or idea to keep it here." : tab === "recent" ? "Previewed, inserted and replaced entries appear here." : "Save a phrase from the song, or develop an idea below."}</p>}
      {tab === "ideas" && <div className="idea-routes"><button onClick={() => onTool("writing")}><strong>Chords & parts</strong><small>Develop the current progression.</small></button><button onClick={() => onTool("lyrics")}><strong>Lyrics & song notes</strong><small>Keep words beside your song.</small></button><button onClick={() => onTool("reference")}><strong>Reference</strong><small>Review analyzed audio proposals.</small></button></div>}
    </div>
    <div className="library-placement">
      {chosen && <><strong className="library-selected-name">{chosen.name}</strong>{entrySampleProvenance(chosen) && <span className="sample-provenance-badge">{entrySampleProvenance(chosen)!.method} · {entrySampleProvenance(chosen)!.status === "approved" ? "User reviewed" : entrySampleProvenance(chosen)!.status === "mixed-texture" ? "Mixed texture" : "Needs review"}</span>}<p className="assets-destination">{chosen.kind === "sound" ? <>Insert: new instrument track<br/>Replace: <strong>{s.selectedTrack?.name ?? "choose a track"}</strong></> : <>Insert: <strong>{s.selectedTrack?.name ?? "new track"}</strong> · {s.selectedSection.name}<br/>Bar {Math.floor(s.selectedSection.startTick/ticksPerBar(s.project))+1}{chosen.kind !== "audio" && <><br/>Replace: {s.selectedClip?.name ?? "select a compatible phrase"}</>}</>}</p>
        <div className="library-preview-actions"><button className="secondary-button" disabled={busy} onClick={() => void preview()}>Preview</button><button className="text-button" onClick={stopPreview}>Stop preview</button></div>
        <div className="library-use-actions"><button className="secondary-button" aria-label={chosen.id.startsWith("factory_") ? "Add instrument track" : "Insert library entry"} disabled={busy} onClick={() => void place("insert")}>{chosen.kind === "sound" ? "Insert track" : "Insert"}</button>
          {chosen.kind !== "audio" && <button className="secondary-button" aria-label={chosen.id.startsWith("factory_") ? "Use on selected track" : "Replace with library entry"} disabled={busy || !s.selectedTrack || (chosen.kind === "sound" ? s.selectedTrack.kind !== "instrument" : !s.selectedClip || !!s.selectedClip.audio)} title={chosen.kind === "sound" ? "Replace sound on the selected track" : "Replace the explicitly selected phrase"} onClick={() => void place("replace")}>{chosen.kind === "sound" ? "Replace sound" : "Replace phrase"}</button>}</div>
        {rejected?.result.overlap && <button className="secondary-button" disabled={busy} onClick={() => void place("alternative")}>Insert on a new track</button>}
        {rejected && incompatiblePhrase && !rejected.result.overlap && <button className="secondary-button" disabled={busy} onClick={() => void place("alternative")}>Insert complete phrase on a new track</button>}
        {rejected?.result.soundConflict && <div className="library-conflict"><button className="secondary-button" disabled={busy} onClick={() => void place("keep-modulation")}>Replace sound, keep current modulation</button><button className="secondary-button" disabled={busy} onClick={() => void place("alternative")}>Insert complete sound on a new track</button></div>}
        {!!rejected?.result.reasons?.length && <ul className="library-reasons">{rejected.result.reasons.map((reason,index) => <li key={index}>{reason}</li>)}</ul>}
      </>}
      {s.libraryBusy && <button className="secondary-button" onClick={() => {s.cancelLibraryOperation();setStatus({scope,text:"Library operation cancelled.",error:false});}}>Cancel library operation</button>}
      {message && <p className={`library-message${message.error ? " library-error" : ""}`} role="status">{message.text}</p>}
      {s.libraryError && s.libraryError !== message?.text && <p className="library-message library-error" role="status">{s.libraryError}<button className="text-button" disabled={!!s.libraryBusy} onClick={() => void s.refreshReusableLibrary()}>Retry library</button></p>}
      <button className="text-button" onClick={() => onTool("reference")}>Refine a sample</button>
      <button className="text-button" onClick={() => onTool("keyboard")}>Import audio / Inputs</button>
    </div>
    <details className="library-manage"><summary>Save & manage library</summary><div>
      <div className="library-save-actions"><button className="secondary-button" disabled={busy || s.selectedTrack?.kind !== "instrument"} onClick={() => setSaving({scope,kind:"sound",name:s.selectedTrack?.name ?? "Saved sound"})}>Save selected sound</button><button className="secondary-button" disabled={busy || !s.selectedClip} onClick={() => setSaving({scope,kind:"phrase",name:s.selectedClip?.name ?? "Saved phrase"})}>Save selected phrase</button></div>
      {saveForm && <form onSubmit={event => {event.preventDefault();void save();}} onKeyDown={event => {if(event.key === "Escape") {event.preventDefault();event.stopPropagation();setSaving(null);}}}><label htmlFor={nameId}>Library name</label><input id={nameId} maxLength={120} value={saveForm.name} onChange={event => setSaving({...saveForm,name:event.target.value})}/><div><button className="secondary-button" disabled={busy || !saveForm.name.trim()} type="submit">Save to library</button><button className="text-button" type="button" onClick={() => setSaving(null)}>Cancel name</button></div></form>}
      <div className="library-backup-actions"><button className="text-button" disabled={busy || !s.libraryReady} onClick={() => void s.exportLibrary()}>Export library backup</button><button className="text-button" disabled={busy || !s.libraryReady} onClick={() => fileInput.current?.click()}>Import library backup</button></div>
      <input ref={fileInput} aria-label="Import library archive" hidden type="file" accept=".zip,.chordz-library,application/zip" onChange={event => {const file=event.target.files?.[0];event.target.value="";if(file) void s.importLibrary(file);}}/>
      {chosen && s.libraryEntries.some(entry => entry.id === chosen.id) && <button className="text-button library-remove" disabled={busy} onClick={() => void remove()}>Delete selected library entry</button>}
    </div></details>
  </div>;
}
