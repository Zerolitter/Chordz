"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minimize2, PanelLeft, RotateCcw, SlidersHorizontal } from "lucide-react";
import { SongCanvas } from "./arrange-panel";
import { ClipEditor } from "./clip-editor";
import { AutomationEditor } from "./automation-editor";
import { WritePanel } from "./write-panel";
import { SoundPanel, releaseSoundPanelInputs } from "./sound-panel";
import { MixerPanel } from "./mixer-panel";
import { PerformanceDock, releasePerformanceDockInputs } from "./performance-dock";
import { ToolVisibilityProvider, freezeToolGestures } from "./tool-visibility";
import { useStudio } from "./use-studio";
import { usePreference, numericPreference } from "./use-preference";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { effectiveWorkspaceLayout } from "../../lib/client/workspace-layout";
import type { DetailTool } from "../../lib/client/studio-view";
import { instrumentSettings, instruments } from "../../lib/audio/catalog";
import { PPQ } from "../../lib/music/types";
import "./workspace-prototype.css";

const toolNames: Record<DetailTool,string> = {notes:"Notes / Audio", sound:"Sound", automation:"Automation", writing:"Writing", movement:"Movement", reference:"Reference", keyboard:"Keyboard / Inputs", lyrics:"Lyrics"};
export function WorkspacePrototype() {
  const s = useStudio();
  const layout = useWorkspaceLayout(s.user?.userId ?? "guest", s.project.id);
  const [grid, setGrid] = usePreference("grid", PPQ / 4, numericPreference(PPQ / 8, PPQ));
  const [swing, setSwing] = usePreference("swing", 0, numericPreference(0, .6));
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({width:1366,height:600});
  const [maximizeState, setMaximizeState] = useState({key:layout.key,on:false});
  const maximized = maximizeState.key === layout.key && maximizeState.on;
  const setMaximized = (value:boolean) => setMaximizeState({key:layout.key,on:value});
  const [assetsOverlay, setAssetsOverlay] = useState(false);
  const previous = useRef({mode:s.mode, clipRequest:s.clipEditorRequest});
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!layout.ready) return;
    if (previous.current.clipRequest !== s.clipEditorRequest) {
      layout.update(current => ({...current,[s.mode]:{...current[s.mode],detailOpen:true}}));
    }
    previous.current = {mode:s.mode,clipRequest:s.clipEditorRequest};
  }, [s.clipEditorRequest, s.mode, layout]);
  const profile = layout.layouts[s.mode];
  const hasTool = s.detailTool !== "notes" || !!s.selectedClip;
  const detailVisible = profile.detailOpen && hasTool;
  const geometry = effectiveWorkspaceLayout({...profile,detailRatio:maximized ? .7 : profile.detailRatio}, size.width, size.height, detailVisible);
  function releaseControls() {
    freezeToolGestures("detail");
    releasePerformanceDockInputs(s);
    releaseSoundPanelInputs(s);
  }
  function choose(tool: DetailTool) {
    releaseControls();
    if (!s.setDetailTool(tool)) return;
    layout.update(current => ({...current,[s.mode]:{...current[s.mode],detailOpen:true}}));
  }
  function collapse() {
    releaseControls();
    if (!settleLayoutEdit()) return;
    s.cancelPreview();
    layout.update(current => ({...current,[s.mode]:{...current[s.mode],detailOpen:!detailVisible}}));
  }
  function settleLayoutEdit() {
    if (!s.finishGesture()) return false;
    if(s.transaction?.invalid) return s.finishEdit(s.transaction.owner);
    const staged = /^(reference[-:]|modulation-ab:)/.test(s.transaction?.owner ?? "");
    return staged || s.finishEdit();
  }
  const primary:DetailTool[] = ["notes","sound"];
  if (s.detailTool === "automation" || (s.selectedTrack?.automation.length ?? 0) > 0) primary.push("automation");
  return <div ref={element} className="shared-workspace" data-preset={s.mode} style={{"--browser-size":`${geometry.browserWidth}px`, "--detail-size":`${geometry.detailHeight}px`, "--mixer-size":`${geometry.mixerHeight}px`} as CSSProperties}>
    <div className="workspace-layout-tools" data-edit-policy="bypass">
      <button className="secondary-button" aria-label="Toggle assets panel" aria-pressed={geometry.browserWidth ? profile.browserOpen : assetsOverlay} onClick={() => { if(size.width < 1100 || size.height < 520) setAssetsOverlay(value => !value); else layout.update(current => ({...current,[s.mode]:{...current[s.mode],browserOpen:!profile.browserOpen}})); }}><PanelLeft size={14}/> {s.mode === "write" ? "Ideas" : "Assets"}</button>
      <span className="workspace-selection">{s.selectedTrack?.name ?? "Choose a track"}{s.selectedClip && <span> / {s.selectedClip.name}</span>}</span>
      <details className="layout-options"><summary><SlidersHorizontal size={14}/><span>Layout</span></summary><div>
        <label>Editor height<input aria-label="Editor height" type="range" min={20} max={70} value={profile.detailRatio * 100} onChange={event => layout.update(current => ({...current,[s.mode]:{...current[s.mode],detailRatio:Number(event.target.value)/100}}))}/></label>
        <label><input type="checkbox" aria-label="Show mixer" checked={profile.mixerOpen} onChange={event => { freezeToolGestures("mixer"); if(settleLayoutEdit()) layout.update(current => ({...current,[s.mode]:{...current[s.mode],mixerOpen:event.target.checked}})); }}/>Mixer</label>
        <button className="secondary-button" onClick={() => { releaseControls(); freezeToolGestures("mixer"); if(!settleLayoutEdit()) return; s.cancelPreview(); setMaximized(false); layout.reset(); }}><RotateCcw size={13}/>Reset layout</button>
      </div></details>
    </div>
    <aside className={`workspace-assets${!geometry.browserWidth ? " workspace-assets-overlay" : ""}`} aria-label={s.mode === "write" ? "Existing ideas" : "Existing sounds and assets"} hidden={!geometry.browserWidth && !assetsOverlay}><ExistingAssets onTool={choose}/></aside>
    <div className="workspace-song"><SongCanvas grid={grid} setGrid={setGrid}/></div>
    <section className="workspace-detail" aria-label="Detail dock" data-open={detailVisible}>
      <div className="detail-tabs" data-edit-policy="bypass">
        <div role="tablist" aria-label="Detail tools">{primary.map(tool => <button key={tool} role="tab" aria-selected={s.detailTool === tool} onClick={() => choose(tool)}>{toolNames[tool]}</button>)}</div>
        <button className={`detail-route${s.detailTool === "writing" ? " active" : ""}`} onClick={() => choose("writing")}>Writing</button>
        {(["sound","movement"].includes(s.detailTool)) && <button className="detail-route" onClick={() => choose("movement")}>Movement</button>}
        <select aria-label="Other detail tools" value={primary.includes(s.detailTool)||s.detailTool === "writing" ? "" : s.detailTool} onChange={event => { if(event.target.value) choose(event.target.value as DetailTool); }}>
          <option value="">More…</option>{(["automation","movement","reference","keyboard","lyrics"] as DetailTool[]).filter(tool => !primary.includes(tool)).map(tool => <option key={tool} value={tool}>{toolNames[tool]}</option>)}
        </select>
        <span className="detail-context">{toolNames[s.detailTool]}</span>
        <button className="icon-button" aria-label={maximized ? "Restore editor size" : "Maximize editor"} disabled={!detailVisible} onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
        <button className="icon-button" aria-label={detailVisible ? "Collapse detail dock" : "Expand detail dock"} aria-expanded={detailVisible} onClick={collapse}>{detailVisible ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}</button>
      </div>
      <div className="detail-body workspace-content" hidden={!detailVisible}>
        <ToolVisibilityProvider scope="detail" active={detailVisible && s.detailTool === "notes"}><div className="detail-tool detail-notes" hidden={s.detailTool !== "notes"}><ClipEditor embedded active={detailVisible && s.detailTool === "notes"} grid={grid} setGrid={setGrid} swing={swing} setSwing={setSwing}/></div></ToolVisibilityProvider>
        <ToolVisibilityProvider scope="detail" active={detailVisible && s.detailTool === "automation"}><div className="detail-tool" hidden={s.detailTool !== "automation"}><AutomationEditor grid={grid}/></div></ToolVisibilityProvider>
        <ToolVisibilityProvider scope="detail" active={detailVisible && ["writing","lyrics"].includes(s.detailTool)}><div className="detail-tool" hidden={!["writing","lyrics"].includes(s.detailTool)}><WritePanel section={s.detailTool === "lyrics" ? "lyrics" : "writing"}/></div></ToolVisibilityProvider>
        <ToolVisibilityProvider scope="detail" active={detailVisible && ["sound","movement","reference"].includes(s.detailTool)}><div className="detail-tool" hidden={!["sound","movement","reference"].includes(s.detailTool)}><SoundPanel active={detailVisible && ["sound","movement","reference"].includes(s.detailTool)} section={s.detailTool === "movement" ? "movement" : s.detailTool === "reference" ? "reference" : "sound"} onOpenMovement={() => choose("movement")}/></div></ToolVisibilityProvider>
        <ToolVisibilityProvider scope="detail" active={detailVisible && s.detailTool === "keyboard"}><div className="detail-tool" hidden={s.detailTool !== "keyboard"}><PerformanceDock embedded active={detailVisible && s.detailTool === "keyboard"} open onOpenChange={collapse} onOpenMovement={() => choose("movement")}/></div></ToolVisibilityProvider>
      </div>
    </section>
    <ToolVisibilityProvider scope="mixer" active={!!geometry.mixerHeight}><div className="workspace-mixer" hidden={!geometry.mixerHeight}><MixerPanel active={!!geometry.mixerHeight}/></div></ToolVisibilityProvider>
    {(layout.error || s.viewPreferenceError) && <div className="workspace-preference-error" role="status">{layout.error || s.viewPreferenceError}</div>}
  </div>;
}

function ExistingAssets({onTool}:{onTool:(tool:DetailTool)=>void}) {
  const s = useStudio(), catalog = instruments(s.project);
  const [choice,setChoice] = useState("");
  const chosen = catalog.find(item => item.id === choice) ?? catalog.find(item => item.id === s.selectedTrack?.instrumentId) ?? catalog[0];
  if (s.mode === "write") return <><div className="assets-heading"><span className="eyebrow">Existing tools</span><h2>Ideas</h2></div><div className="idea-routes">
    <button data-edit-policy="bypass" onClick={() => onTool("writing")}><strong>Chords & parts</strong><small>Edit the progression and develop a phrase.</small></button>
    <button data-edit-policy="bypass" onClick={() => onTool("lyrics")}><strong>Lyrics & song notes</strong><small>Keep the words beside your song.</small></button>
    <button data-edit-policy="bypass" onClick={() => onTool("reference")}><strong>Reference</strong><small>Analyze audio and review its proposals.</small></button>
  </div><p className="assets-destination">Writing in {s.selectedSection.name}<br/>{s.selectedTrack?.name}</p></>;
  return <><div className="assets-heading"><span className="eyebrow">Existing instruments</span><h2>Sounds</h2></div><div className="existing-sounds">{catalog.map(item => <button key={item.id} aria-pressed={item.id === chosen?.id} onClick={() => setChoice(item.id)}><strong>{item.name}</strong><small>{item.family}</small></button>)}</div><div className="assets-actions">
    <p className="assets-destination">Destination<br/><strong>{s.selectedTrack?.name ?? "New track"}</strong></p>
    <button className="secondary-button" disabled={s.recording || s.selectedTrack?.kind !== "instrument" || !chosen} onClick={() => { if(chosen && s.selectedTrack) s.updateTrack(s.selectedTrack.id,{instrumentId:chosen.id,sound:instrumentSettings(chosen)},"Change instrument"); }}>Use on selected track</button>
    <button className="secondary-button" disabled={s.recording || !chosen} onClick={() => {if(chosen)s.addTrack(chosen.id,chosen.name);}}>Add instrument track</button>
    <button data-edit-policy="bypass" className="text-button" onClick={() => onTool("keyboard")}>Import audio / Inputs</button>
  </div></>;
}
