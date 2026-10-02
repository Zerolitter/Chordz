"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
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
import { LibraryBrowser } from "./library-browser";
import { TrackBounceControls } from "./track-bounce-controls";
import { effectiveWorkspaceLayout } from "../../lib/client/workspace-layout";
import type { DetailTool } from "../../lib/client/studio-view";
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
  const assetsId = useId(), detailId = useId();
  const assetsToggle = useRef<HTMLButtonElement>(null), detailBody = useRef<HTMLDivElement>(null);
  const toolTabs = useRef<Partial<Record<DetailTool,HTMLButtonElement|null>>>({});
  const focusScope = useRef({key:layout.key,mode:s.mode,tool:s.detailTool});
  const pendingFocus = useRef<number|null>(null);
  useLayoutEffect(() => { focusScope.current = {key:layout.key,mode:s.mode,tool:s.detailTool}; }, [layout.key,s.mode,s.detailTool]);
  useEffect(() => () => { if(pendingFocus.current !== null) cancelAnimationFrame(pendingFocus.current); }, []);
  const [maximizeState, setMaximizeState] = useState({key:layout.key,on:false});
  const maximized = maximizeState.key === layout.key && maximizeState.on;
  const setMaximized = (value:boolean) => setMaximizeState({key:layout.key,on:value});
  const [overlayState, setOverlayState] = useState({key:layout.key,mode:s.mode,open:false});
  const compact = size.width < 1100 || size.height < 520;
  const assetsOverlay = compact && overlayState.key === layout.key && overlayState.mode === s.mode && overlayState.open;
  const setAssetsOverlay = (open:boolean) => setOverlayState({key:layout.key,mode:s.mode,open});
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
  const detailRequested = profile.detailOpen && hasTool;
  // Precise note controls need room for the grid, velocities and selected-note values.
  // This is an effective clamp; the user's requested ratio stays in the layout record.
  const minimumDetailHeight=s.detailTool==="notes"&&s.selectedClip&&!s.selectedClip.audio?320:220;
  const geometry = effectiveWorkspaceLayout({...profile,detailRatio:maximized ? .7 : profile.detailRatio}, size.width, size.height, detailRequested,minimumDetailHeight);
  const detailVisible = detailRequested && geometry.detailHeight > 0;
  const assetsVisible = !!geometry.browserWidth || assetsOverlay;
  const lastVisibility = useRef({detail:false,mixer:false});
  useLayoutEffect(() => {
    if (lastVisibility.current.detail && !detailVisible) {
      freezeToolGestures("detail"); releasePerformanceDockInputs(s); releaseSoundPanelInputs(s); s.cancelPreview();
    }
    if (lastVisibility.current.mixer && !geometry.mixerHeight) freezeToolGestures("mixer");
    lastVisibility.current = {detail:detailVisible,mixer:!!geometry.mixerHeight};
  }, [detailVisible,geometry.mixerHeight,s]);
  function releaseControls() {
    freezeToolGestures("detail");
    releasePerformanceDockInputs(s);
    releaseSoundPanelInputs(s);
  }
  function choose(tool: DetailTool) {
    if (pendingFocus.current !== null) { cancelAnimationFrame(pendingFocus.current); pendingFocus.current = null; }
    releaseControls();
    if (!s.setDetailTool(tool)) return false;
    layout.update(current => ({...current,[s.mode]:{...current[s.mode],detailOpen:true}}));
    if (assetsOverlay) {
      setAssetsOverlay(false);
      const expected = {key:layout.key,mode:s.mode,tool};
      pendingFocus.current = requestAnimationFrame(() => {
        pendingFocus.current = null;
        const current = focusScope.current;
        if (current.key === expected.key && current.mode === expected.mode && current.tool === expected.tool)
          (toolTabs.current[tool] ?? detailBody.current)?.focus({preventScroll:true});
      });
    }
    return true;
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
    const staged = /^(reference[-:]|modulation-ab:|note-transform:)/.test(s.transaction?.owner ?? "");
    return staged || s.finishEdit();
  }
  const primary:DetailTool[] = ["notes","sound"];
  if (s.detailTool === "automation" || (s.selectedTrack?.automation.length ?? 0) > 0) primary.push("automation");
  const focusTab = primary.includes(s.detailTool) ? s.detailTool : primary[0];
  function navigateTab(event:KeyboardEvent<HTMLButtonElement>, tool:DetailTool) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = primary.indexOf(tool);
    const next = event.key === "Home" ? primary[0] : event.key === "End" ? primary.at(-1)!
      : primary[(index + (event.key === "ArrowRight" ? 1 : -1) + primary.length) % primary.length];
    if (choose(next)) toolTabs.current[next]?.focus({preventScroll:true});
  }
  function resizeEditor(change:()=>void) {
    // Growing the editor can close the mixer; settle its owned input before checking drafts.
    freezeToolGestures("mixer");
    if (settleLayoutEdit()) change();
  }
  return <div ref={element} className="shared-workspace" data-preset={s.mode} style={{"--browser-size":`${geometry.browserWidth}px`, "--detail-size":`${geometry.detailHeight}px`, "--mixer-size":`${geometry.mixerHeight}px`} as CSSProperties}>
    <div className="workspace-layout-tools" data-edit-policy="bypass">
      <button ref={assetsToggle} className="secondary-button" aria-label="Toggle assets panel" aria-controls={assetsId} aria-expanded={assetsVisible} aria-pressed={assetsVisible} onClick={() => { if(compact) setAssetsOverlay(!assetsOverlay); else layout.update(current => ({...current,[s.mode]:{...current[s.mode],browserOpen:!profile.browserOpen}})); }}><PanelLeft size={14}/> {s.mode === "write" ? "Ideas" : "Assets"}</button>
      <span className="workspace-selection">{s.selectedTrack?.name ?? "Choose a track"}{s.selectedClip && <span> / {s.selectedClip.name}</span>}</span>
      <TrackBounceControls/>
      <details className="layout-options" onKeyDown={event => { if(event.key === "Escape" && !event.defaultPrevented && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label="Workspace layout"><SlidersHorizontal size={14}/><span>Layout</span></summary><div>
        <label>Editor height<input aria-label="Editor height" type="range" min={20} max={70} value={profile.detailRatio * 100} onChange={event => { const ratio = Number(event.target.value)/100; resizeEditor(() => layout.update(current => ({...current,[s.mode]:{...current[s.mode],detailRatio:ratio}}))); }}/></label>
        <label><input type="checkbox" aria-label="Show mixer" checked={profile.mixerOpen} onChange={event => { freezeToolGestures("mixer"); if(settleLayoutEdit()) layout.update(current => ({...current,[s.mode]:{...current[s.mode],mixerOpen:event.target.checked}})); }}/>Mixer</label>
        <button className="secondary-button" onClick={() => { releaseControls(); freezeToolGestures("mixer"); if(!settleLayoutEdit()) return; s.cancelPreview(); setMaximized(false); layout.reset(); }}><RotateCcw size={13}/>Reset layout</button>
      </div></details>
    </div>
    <aside id={assetsId} className={`workspace-assets${!geometry.browserWidth ? " workspace-assets-overlay" : ""}`} aria-label={s.mode === "write" ? "Existing ideas" : "Existing sounds and assets"} hidden={!assetsVisible} onKeyDown={event => { if(event.key === "Escape" && !event.defaultPrevented && assetsOverlay) { event.preventDefault(); event.stopPropagation(); setAssetsOverlay(false); assetsToggle.current?.focus({preventScroll:true}); } }}><LibraryBrowser active={assetsVisible} onTool={choose}/></aside>
    <div className="workspace-song"><SongCanvas grid={grid} setGrid={setGrid}/></div>
    <section className="workspace-detail" aria-label="Detail dock" data-open={detailVisible}>
      <div className="detail-tabs" data-edit-policy="bypass">
        <div role="tablist" aria-label="Detail tools">{primary.map(tool => <button key={tool} ref={node => {toolTabs.current[tool] = node;}} id={`${detailId}-${tool}`} role="tab" aria-controls={detailId} tabIndex={focusTab === tool ? 0 : -1} aria-selected={s.detailTool === tool} onKeyDown={event => navigateTab(event,tool)} onClick={() => choose(tool)}>{toolNames[tool]}</button>)}</div>
        <button className={`detail-route${s.detailTool === "writing" ? " active" : ""}`} onClick={() => choose("writing")}>Writing</button>
        {(["sound","movement"].includes(s.detailTool)) && <button className="detail-route" onClick={() => choose("movement")}>Movement</button>}
        <select aria-label="Other detail tools" value={primary.includes(s.detailTool)||s.detailTool === "writing" ? "" : s.detailTool} onChange={event => { if(event.target.value) choose(event.target.value as DetailTool); }}>
          <option value="">More…</option>{(["automation","movement","reference","keyboard","lyrics"] as DetailTool[]).filter(tool => !primary.includes(tool)).map(tool => <option key={tool} value={tool}>{toolNames[tool]}</option>)}
        </select>
        <span className="detail-context">{toolNames[s.detailTool]}</span>
        <button className="icon-button" aria-label={maximized ? "Restore editor size" : "Maximize editor"} disabled={!detailVisible} onClick={() => resizeEditor(() => setMaximized(!maximized))}>{maximized ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
        <button className="icon-button" aria-label={detailVisible ? "Collapse detail dock" : "Expand detail dock"} aria-controls={detailId} aria-expanded={detailVisible} onClick={collapse}>{detailVisible ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}</button>
      </div>
      <div ref={detailBody} id={detailId} className="detail-body workspace-content" role="tabpanel" tabIndex={-1} aria-label={toolNames[s.detailTool]} hidden={!detailVisible}>
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
