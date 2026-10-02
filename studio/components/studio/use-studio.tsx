"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { historyReducer, type HistoryAction } from "../../lib/music/edit";
import { applyPreview, previewEdit, commitTransaction, rebaseTransaction, gestureSavepoint, restoreGesture, type EditGesture, type EditTransaction } from "../../lib/music/transactions";
import { chordCommand, type ChordCommand } from "../../lib/music/chord-commands";
import {
  createDemo,
  createProject,
  createTrack,
  emptyClip,
  projectEnd,
  secondsToTick,
  tickToSeconds,
  TRACK_COLORS,
} from "../../lib/music/project";
import {
  uid,
  type AssetReference,
  type AutomationParameter,
  type CloudProject,
  type Clip,
  type NoteEvent,
  type PerformanceEvent,
  type ProjectDocument,
  type ProjectSummary,
  type Track,
} from "../../lib/music/types";
import { projectSchema } from "../../lib/music/schema";
import {
  CloudError,
  createCloudProject,
  deleteCloudProject,
  listProjects,
  loadProject,
  saveCloudProject,
} from "../../lib/client/cloud";
import {
  clearDraft,
  keepPendingAsset,
  latestDraft,
  pendingAsset,
  preserveTake,
  resolveAsset,
  saveDraft,
  uploadPending,
} from "../../lib/client/storage";
import type { StudioEngine, TransportState } from "../../lib/audio/engine";
import { AudioProcessor } from "../../lib/audio/worker-client";
import { MicrophoneRecorder } from "../../lib/audio/recording";
import {LiveMovement} from "../../lib/music/live-movement";
import {performanceKey} from "../../lib/music/performance";
import {MACRO_IDS, type ModTarget} from "../../lib/music/modulation-types";
import {emptyPatch} from "../../lib/audio/modulation";
import {instrumentFor} from "../../lib/audio/catalog";
import {assignModulationRoute} from "../../lib/music/modulation-assignment";
import {defaultStudioView, detailToolForMode, reconcileSongViewport, reconcileStudioView, sameSongViewport, selectStudioClip, selectStudioSection, selectStudioTrack, studioViewKey, StudioViewPreferences, type DetailTool, type SongViewport, type SongViewportUpdate, type StudioView, type StudioMode} from "../../lib/client/studio-view";
import {capturedExpression,captureReleaseReset,effectiveSustain} from "../../lib/client/performance-ownership";
import {freezeToolGestures,useToolVisibility} from "./tool-visibility";
import {LibraryTargetRevisions} from "../../lib/client/library-operations";
import {useReusableLibrary} from "./use-reusable-library";
import { useRecordingInput } from "./use-recording-input";
import { buildTakePreview } from "../../lib/music/take-review";

export type {StudioMode, DetailTool, SongViewport} from "../../lib/client/studio-view";
export type StudioUser = { userId: string; displayName: string } | null;
type ProjectMeta = { revision: number; fingerprint: string };
type MidiTake = {
  trackId: string;
  startTick: number;
  open: Map<string, { id: string; pitch: number; tick: number; velocity: number }>;
  notes: NoteEvent[];
  events: PerformanceEvent[];
};

type RecordingPhase = "idle" | "preparing" | "count-in" | "capturing" | "finalizing" | "recovery-error";
type TakeSession = {
  id: string; owner: string; projectId: string; trackId: string; startTick: number; tempo: number;
  kind: "audio" | "midi"; phase: RecordingPhase; startTime: number; endTime?: number; reset: boolean;
  clipId: string; assetId: string; newTrack: Track | null;
  result?: { blob: Blob; duration: number; sampleRate: number; peaks: number[] }; clip?: Clip;
};
const stagedOwner = (owner?: string) => !!owner && (owner.startsWith("reference-") || owner.startsWith("reference:") || owner.startsWith("modulation-ab:") || owner.startsWith("note-transform:"));
function useStudioController(
  initialProject: ProjectDocument,
  user: StudioUser,
) {
  const [history, dispatch] = useReducer(historyReducer, {
    present: initialProject,
    past: [],
    future: [],
    label: "",
  });
  const [transaction,setTransaction]=useState<EditTransaction|null>(null);
  const activeEdit=useRef<EditTransaction|null>(null),fieldOwner=useRef(""),committedRef=useRef(history.present);
  const activeGesture=useRef<EditGesture|null>(null);
  const [libraryRevisions]=useState(()=>new LibraryTargetRevisions());
  const cancelLibraryOperationRef=useRef<()=>void>(()=>{}),cancelLibraryPreviewRef=useRef<()=>void>(()=>{});
  const [editConflict,setEditConflict]=useState<EditTransaction|null>(null);
  const project=useMemo(()=>applyPreview(history.present,transaction),[history.present,transaction]),projectRef=useRef(project);
  const [selectedChordId,setSelectedChordId]=useState("");
  const selectionHistory=useRef(new WeakMap<ProjectDocument,string>());
  const [mode, setModeState] = useState<StudioMode>("arrange");
  const [detailTool, setDetailToolState] = useState<DetailTool>("notes");
  const [automationFocus,setAutomationFocus]=useState<{scope:string;parameter:AutomationParameter}>({scope:"",parameter:"volume"});
  const [songViewport,setSongViewportState]=useState<SongViewport>(()=>defaultStudioView(initialProject).songViewport);
  const songViewportRef=useRef(songViewport);
  const [clipEditorRequest,setClipEditorRequest]=useState(0);
  const [selectedTrackId, setSelectedTrackId] = useState(
    project.tracks[0]?.id ?? "",
  );
  const [selectedSectionId, setSectionState] = useState(
    project.sections[1]?.id ?? project.sections[0].id,
  );
  const [selectedClipId, setSelectedClipId] = useState("");
  const clipsByTrack=useRef(new Map<string,string>());
  const [selectedNotes, setSelectedNotes] = useState<number[]>(
    project.chords[0]?.notes ?? [],
  );
  const [heldNotes, setHeldNotes] = useState<Set<number>>(new Set());
  const heldRef = useRef(new Set<number>());
  const heldInputs = useRef(new Map<string, { trackId: string; pitch: number; velocity: number }>());
  const movement=useRef<LiveMovement|null>(null);
  const midiLearn=useRef<((cc:number,channel:number)=>void)|null>(null);
  const movementCaptures=useRef(new Map<string,{trackId:string;takeId:string;at:number;end:number}>());
  const [midiLearning,setMidiLearning]=useState(false);
  const [runtimeMacros,setRuntimeMacros]=useState<Record<string,[number,number,number,number]>>({});
  const runtimeMacrosRef=useRef(runtimeMacros);
  const macroProject=useRef(project);
  const audioIntent = useRef(0);
  const pendingPreview=useRef<{identity:string;token:number}|null>(null);
  const takePreview = useRef(false);
  const writingActions = useRef<{generated:()=>void;chord:()=>void;progression:()=>void}|null>(null);
  const cancelInteraction = useRef<(()=>boolean)|null>(null);
  const registerInteraction=useCallback((cancel:()=>boolean)=>{cancelInteraction.current=cancel;return()=>{if(cancelInteraction.current===cancel)cancelInteraction.current=null;};},[]);
  const registerWritingActions=useCallback((actions:typeof writingActions.current)=>{writingActions.current=actions;},[]);
  const [latch, setLatch] = useState(true);
  const [octave, setOctave] = useState(3);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saveStatus, setSaveStatus] = useState(
    user ? "Demo · not saved" : "Sign in for cloud saves",
  );
  const [draftReceipt, setDraftReceipt] = useState<{ owner: string; projectId: string; fingerprint: string; saved: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setErrorState] = useState("");
  const [errorScope,setErrorScope]=useState({mode:"write" as StudioMode,projectId:initialProject.id});
  const [busy, setBusy] = useState("");
  const [ready, setReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [engine, setEngine] = useState<StudioEngine | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const engineJob = useRef<Promise<StudioEngine> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoopState] = useState(false);
  const [metronome, setMetronomeState] = useState(false);
  const [recordKind, setRecordKind] = useState<"audio" | "midi">("midi");
  const [recordCountIn, setRecordCountInState] = useState(1);
  const [recordDestination, setRecordDestination] = useState<{ scope: string; id: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");
  const takeSession = useRef<TakeSession | null>(null);
  const finalizeJob = useRef<Promise<void> | null>(null);
  const importCount = useRef(0);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [monitor, setMonitorState] = useState(false);
  const monitorRef = useRef(false);
  const [microphoneId, setMicrophoneId] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [midiInputs, setMidiInputs] = useState<MIDIInput[]>([]);
  const [midiInputId, setMidiInputId] = useState("all");
  const [midiEnabled, setMidiEnabled] = useState(false);
  const midiAccess = useRef<MIDIAccess | null>(null);
  const midiInputRef = useRef(midiInputId);
  const midiTake = useRef<MidiTake | null>(null);
  const recorder = useRef<MicrophoneRecorder | null>(null);
  const recordingAt = useRef(0);
  const recordingTick = useRef(0);
  const transportJob = useRef(false);
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const processor = useRef<AudioProcessor | null>(null);
  const meta = useRef(
    new Map<string, ProjectMeta>([
      [
        initialProject.id,
        { revision: 0, fingerprint: JSON.stringify(initialProject) },
      ],
    ]),
  );
  const saveJob = useRef<Promise<CloudProject | null> | null>(null);
  const [conflict, setConflict] = useState<{
    incoming: ProjectDocument;
    current: CloudProject;
    conflictId: string;
    recoveryId?: string;
  } | null>(null);
  const conflictRef = useRef(conflict);
  const owner = user?.userId ?? "guest";
  const ownerRef = useRef(owner);
  const selectedTrack =
    project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0];
  const selectedTrackRef = useRef(selectedTrack);
  const selectedSection =
    project.sections.find((s) => s.id === selectedSectionId) ??
    project.sections[0];
  const selectedClip = selectedTrack?.clips.find(
    (c) => c.id === selectedClipId,
  );
  const recordScope = JSON.stringify([owner, project.id, recordKind]);
  const targetId = recordDestination?.scope === recordScope ? recordDestination.id : selectedTrack?.id;
  const recordingDestination = project.tracks.find(track => track.id === targetId && track.kind === (recordKind === "audio" ? "audio" : "instrument"));
  const recordingDestinationMissing = recordDestination?.scope === recordScope && targetId !== "new" && !recordingDestination;
  const recordingTargetName = recording ? (takeSession.current?.newTrack?.name ?? project.tracks.find(track => track.id === takeSession.current?.trackId)?.name ?? "Take") : recordingDestinationMissing ? "Choose a destination" : recordingDestination?.name ?? (recordKind === "audio" ? "New audio track" : "Choose an instrument");
  const recordingInput = useRecordingInput(JSON.stringify([recordScope, microphoneId, targetId, recordingDestinationMissing]), getEngine);
  const deviceDraftFingerprint = useMemo(() => JSON.stringify(stagedOwner(transaction?.owner) || transaction?.owner?.startsWith("note-gesture:") ? history.present : project), [transaction, history.present, project]);

  function setRecordingDestination(id: string) {
    if (takeSession.current || busy || !finishEdit()) return;
    if (id !== "new" && !committedRef.current.tracks.some(track => track.id === id && track.kind === (recordKind === "audio" ? "audio" : "instrument"))) return;
    setRecordDestination({ scope: recordScope, id });
  }
  function setRecordCountIn(value: number) {
    if (!takeSession.current && !busy && [0, 1, 2].includes(value)) setRecordCountInState(value);
  }
  async function checkRecordingInput() {
    if (takeSession.current || busy || recordKind !== "audio" || !finishEdit()) return;
    await recordingInput.check(microphoneId, monitor);
    void refreshDevices();
  }

  useLayoutEffect(() => {
    projectRef.current = project;
    ownerRef.current = owner;
    selectedTrackRef.current = selectedTrack;
    conflictRef.current = conflict;
    midiInputRef.current = midiInputId;
    if(selectedClipId&&selectedTrack?.clips.some(c=>c.id===selectedClipId))clipsByTrack.current.set(selectedTrack.id,selectedClipId);
  }, [project, owner, selectedTrack, selectedClipId, conflict, midiInputId]);
  const viewKey=studioViewKey(owner,project.id);
  const [viewRestoreRequest,setViewRestoreRequest]=useState(0);
  // Returning A -> B -> A needs a new restoration, even when the string key matches an older ready view.
  const viewScope=useMemo(()=>({key:viewKey,request:viewRestoreRequest}),[viewKey,viewRestoreRequest]);
  const viewScopeRef=useRef<typeof viewScope|null>(viewScope);
  const [readyViewScope,setReadyViewScope]=useState<typeof viewScope|null>(null);
  const [viewPreferences]=useState(()=>new StudioViewPreferences());
  const [viewPreferenceFailure,setViewPreferenceFailure]=useState<{key:string;message:string;kind:"read"|"write"|null}>({key:"",message:"",kind:null});
  useLayoutEffect(()=>{viewScopeRef.current=viewScope;},[viewScope]);
  useEffect(()=>{
    if(!hydrated)return;
    let active=true;
    queueMicrotask(()=>{
      if(!active)return;
      const doc=projectRef.current;
      if(viewScopeRef.current!==viewScope||studioViewKey(ownerRef.current,doc.id)!==viewKey)return;
      const {view,failure}=viewPreferences.load(viewKey,doc,()=>localStorage);
      clipsByTrack.current=new Map(Object.entries(view.clips));
      setModeState(view.mode);setDetailToolState(view.detailTool);
      songViewportRef.current=view.songViewport;setSongViewportState(view.songViewport);
      setSelectedTrackId(view.track);setSectionState(view.section);setSelectedChordId(view.chord);setSelectedClipId(view.clip);
      setViewPreferenceFailure({key:viewKey,...failure});
      // Mark ready in the same update as the restored state, before allowing writes.
      setReadyViewScope(viewScope);
    });
    return()=>{active=false;};
  },[viewKey,viewScope,viewPreferences,hydrated]);
  useLayoutEffect(()=>{
    if(readyViewScope!==viewScope)return;
    const view=reconcileStudioView(project,{version:2,mode,detailTool,track:selectedTrackId,section:selectedSectionId,chord:selectedChordId,clip:selectedClipId,clips:Object.fromEntries(clipsByTrack.current),songViewport},history.present);
    clipsByTrack.current=new Map(Object.entries(view.clips));
    if(!sameSongViewport(view.songViewport,songViewport)){songViewportRef.current=view.songViewport;setSongViewportState(view.songViewport);}
    if(view.track!==selectedTrackId)setSelectedTrackId(view.track);
    if(view.section!==selectedSectionId)setSectionState(view.section);
    if(view.chord!==selectedChordId)setSelectedChordId(view.chord);
    if(view.clip!==selectedClipId)setSelectedClipId(view.clip);
  },[project,history.present,viewScope,readyViewScope,mode,detailTool,selectedTrackId,selectedSectionId,selectedChordId,selectedClipId,songViewport]);
  useEffect(()=>{
    if(readyViewScope!==viewScope||viewScopeRef.current!==viewScope||studioViewKey(ownerRef.current,projectRef.current.id)!==viewKey)return;
    let active=true;
    const view=reconcileStudioView(project,{version:2,mode,detailTool,track:selectedTrackId,section:selectedSectionId,chord:selectedChordId,clip:selectedClipId,clips:Object.fromEntries(clipsByTrack.current),songViewport},history.present);
    const failure=viewPreferences.save(viewKey,view,()=>localStorage);
    queueMicrotask(()=>{if(active&&viewScopeRef.current===viewScope)setViewPreferenceFailure(current=>current.key===viewKey&&current.message===failure.message&&current.kind===failure.kind?current:{key:viewKey,...failure});});
    return()=>{active=false;};
  },[project,history.present,viewKey,viewScope,readyViewScope,viewPreferences,mode,detailTool,selectedTrackId,selectedSectionId,selectedChordId,selectedClipId,songViewport]);
  function setSongViewport(update:SongViewportUpdate){
    if(!hydrated||readyViewScope!==viewScope||viewScopeRef.current!==viewScope||studioViewKey(ownerRef.current,projectRef.current.id)!==viewKey)return false;
    const current=songViewportRef.current;
    const next=reconcileSongViewport(committedRef.current,{...current,...(typeof update==="function"?update({...current}):update)});
    if(!sameSongViewport(current,next)){songViewportRef.current=next;setSongViewportState(next);}
    return true;
  }
  async function signIn() {
    if(!finishEdit())return;
    if(takeSession.current) { report(new Error("Finish or download your recording before signing in.")); return; }
    const doc = projectRef.current,
      details = meta.current.get(doc.id);
    await saveDraft({
      owner,
      document: doc,
      revision: details?.revision ?? 0,
      savedFingerprint: details?.fingerprint ?? "",
      updatedAt: new Date().toISOString(),
    });
    sessionStorage.setItem("chordz-continue-guest", "1");
    // The dispatch-owned authentication route requires a full document navigation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/signin-with-chatgpt?return_to=/");
  }
  function setError(text:string){setErrorState(text);setErrorScope({mode,projectId:projectRef.current.id});}
  function notify(text: string) {
    setMessage(text);
    setError("");
  }
  function report(value: unknown) {
    setError(value instanceof Error ? value.message : String(value));
    setBusy("");
  }
  function renderEdit(next:EditTransaction|null){
    const document=applyPreview(committedRef.current,next);libraryRevisions.observe(projectRef.current,document);
    activeEdit.current=next;setTransaction(next);projectRef.current=document;
  }
  function beginEdit(owner:string){
    if(fieldOwner.current===owner&&activeEdit.current)return true;
    if(!finishEdit())return false;
    fieldOwner.current=owner;renderEdit({owner,projectId:committedRef.current.id,label:"Edit",patches:[],invalid:null});return true;
  }
  function ownsEdit(owner:string){return activeEdit.current?.owner===owner;}
  function recoverableDocument() {
    return stagedOwner(activeEdit.current?.owner) || activeEdit.current?.owner?.startsWith("note-gesture:") ? committedRef.current : projectRef.current;
  }
  function noteDraftReceipt(document: ProjectDocument, saveOwner: string, saved: boolean) {
    const fingerprint = JSON.stringify(document);
    if (saveOwner === ownerRef.current && document.id === committedRef.current.id && fingerprint === JSON.stringify(recoverableDocument()))
      setDraftReceipt({ owner: saveOwner, projectId: document.id, fingerprint, saved });
  }
  async function persistDeviceDraft(document: ProjectDocument, saveOwner = ownerRef.current) {
    const details = meta.current.get(document.id) ?? { revision: 0, fingerprint: "" };
    try {
      await saveDraft({ owner: saveOwner, document, revision: details.revision, savedFingerprint: details.fingerprint, updatedAt: new Date().toISOString() });
      noteDraftReceipt(document, saveOwner, true);
    } catch (error) { noteDraftReceipt(document, saveOwner, false); throw error; }
  }
  async function retryDeviceDraft() {
    if (takeSession.current || busy) return;
    const document = recoverableDocument();
    if (!projectSchema.safeParse(document).success) { report(new Error("Correct or cancel the unfinished field before saving this device draft.")); return; }
    try { await persistDeviceDraft(document); } catch (error) { report(error); }
  }
  function ownsGesture(owner:string){
    const gesture=activeGesture.current;
    return gesture?.owner===owner && activeEdit.current?.projectId===gesture.projectId &&
      activeEdit.current?.owner===(gesture.parentOwner??owner);
  }
  function gestureParent(owner:string){return activeGesture.current?.owner===owner ? activeGesture.current.parentOwner : undefined;}
  function beginGesture(owner:string,parentOwner?:string){
    if(takeSession.current){setError("Finish recording before changing sound or configuration.");return false;}
    if(ownsGesture(owner))return true;
    if(activeGesture.current&&!finishGesture())return false;
    const current=activeEdit.current;
    const parent=parentOwner??(stagedOwner(current?.owner)?current?.owner:undefined);
    if(parent){
      if(current?.owner!==parent||current.invalid){if(current?.invalid)setError(current.invalid);return false;}
      activeGesture.current=gestureSavepoint(current,owner,parent);return true;
    }
    if(!beginEdit(owner))return false;
    activeGesture.current=gestureSavepoint(activeEdit.current!,owner);return true;
  }
  function invalidateGesture(invalid:string|null,owner:string){
    if(ownsGesture(owner))invalidateEdit(invalid,gestureParent(owner)??owner);
  }
  function finishGesture(owner=activeGesture.current?.owner):boolean{
    const gesture=activeGesture.current;
    if(!gesture)return true;
    if(!owner||!ownsGesture(owner))return false;
    if(activeEdit.current?.invalid){setError(activeEdit.current.invalid);return false;}
    activeGesture.current=null;
    return gesture.parentOwner ? true : finishEdit(owner);
  }
  function cancelGesture(owner=activeGesture.current?.owner){
    const gesture=activeGesture.current;
    if(!gesture||gesture.owner!==owner)return false;
    activeGesture.current=null;
    const result=restoreGesture(activeEdit.current,gesture);
    if(!result.restored)return false;
    fieldOwner.current=result.transaction?.owner??"";renderEdit(result.transaction);setError("");return true;
  }
  function invalidateEdit(invalid:string|null,owner?:string){if(activeEdit.current&&(!owner||ownsEdit(owner)))renderEdit({...activeEdit.current,invalid});}
  function cancelEdit(owner?:string){if(owner&&activeGesture.current?.owner===owner)return cancelGesture(owner);if(owner&&!ownsEdit(owner))return false;if(!activeEdit.current)return false;activeGesture.current=null;fieldOwner.current="";renderEdit(null);return true;}
  function finishEdit(owner?:string):boolean{
    if(activeGesture.current){if(owner===activeGesture.current.owner)return finishGesture(owner);if(!finishGesture())return false;}
    if(owner&&!ownsEdit(owner))return true;
    const tx=activeEdit.current;if(!tx)return true;
    if(stagedOwner(tx.owner)&&owner!==tx.owner){cancelEdit();return true;}
    if(tx.invalid){setError(tx.invalid);return false;}
    const result=commitTransaction(committedRef.current,tx);
    if(!result.ok){renderEdit(null);fieldOwner.current="";setEditConflict(tx);setError(result.error);return false;}
    if(tx.patches.length&&!commit(result.document,tx.label))return false;renderEdit(null);fieldOwner.current="";return true;
  }
  function reapplyEdit(){
    if(!editConflict)return;
    const tx=rebaseTransaction(committedRef.current,editConflict);if(!tx){setError("The edited item was removed. Restore it before reapplying.");return;}
    const result=commitTransaction(committedRef.current,tx);
    if(result.ok){commit(result.document,tx.label);setEditConflict(null);setError("");}else setError(result.error);
  }
  function setMode(value:StudioMode){
    cancelLibraryOperationRef.current();
    if(value!==mode)freezeToolGestures("mixer");
    if(value!==mode||detailToolForMode(value,detailTool)!==detailTool)terminateDetailInputs();
    if(!finishEdit())return false;
    cancelPreview();
    setModeState(value);setDetailToolState(current=>detailToolForMode(value,current));setMessage("");return true;
  }
  function setDetailTool(value:DetailTool){
    cancelLibraryOperationRef.current();
    if(value!==detailTool)terminateDetailInputs();
    if(!finishEdit())return false;
    cancelPreview();setDetailToolState(value);return true;
  }
  function setAutomationLane(parameter:AutomationParameter){
    if(!finishEdit())return false;
    setAutomationFocus({scope:JSON.stringify([ownerRef.current,committedRef.current.id]),parameter});return true;
  }
  function openAutomation(parameter:AutomationParameter,trackId=selectedTrackRef.current?.id){
    if(!trackId||!committedRef.current.tracks.some(track=>track.id===trackId))return false;
    if(trackId!==selectedTrackRef.current?.id&&!selectTrack(trackId))return false;
    if(!setDetailTool("automation"))return false;
    setAutomationFocus({scope:JSON.stringify([ownerRef.current,committedRef.current.id]),parameter});
    setClipEditorRequest(request=>request+1);return true;
  }
  function setSelectedSectionId(value:string){
    cancelLibraryOperationRef.current();
    if(value!==selectedSectionId)terminateDetailInputs();
    if(!finishEdit())return false;
    const view=selectStudioSection(committedRef.current,currentView(),value);
    if(!view)return false;
    cancelPreview();setSectionState(view.section);setSelectedChordId(view.chord);return true;
  }
  function commit(next: ProjectDocument, label: string, takeCommit=false) {
    if (takeSession.current?.phase === "finalizing" && !takeCommit) { setError("Wait for your take to finish saving before editing."); return false; }
    const current=committedRef.current;
    if(!projectSchema.safeParse(next).success){setError("The proposed edit is outside the supported project limits.");return false;}
    if(takeSession.current && !takeCommit && (JSON.stringify(next.tracks)!==JSON.stringify(current.tracks) || JSON.stringify(next.master)!==JSON.stringify(current.master) || next.tempo!==current.tempo || JSON.stringify(next.timeSignature)!==JSON.stringify(current.timeSignature))) { setError("Finish recording before changing playback or instruments."); return false; }
    if(JSON.stringify(next)===JSON.stringify(current))return true;
    if(takePreview.current)cancelPreview();
    selectionHistory.current.set(current,selectedChordId);
    libraryRevisions.observe(current,next);
    committedRef.current=next;projectRef.current=applyPreview(next,activeEdit.current);
    setSaveStatus(user ? "Device draft · saving…" : "Device draft");
    dispatch({ type: "commit", project: next, label });return true;
  }
  function changeHistory(action: HistoryAction) {
    if(takeSession.current) return;
    if((action.type==="undo"||action.type==="redo")&&cancelInteraction.current?.())return;
    if(activeGesture.current){cancelGesture();return;}
    if(activeEdit.current){cancelEdit();return;}
    if(takePreview.current)cancelPreview();
    const next=historyReducer({...history,present:committedRef.current},action);
    libraryRevisions.observe(committedRef.current,next.present);
    committedRef.current=next.present;projectRef.current=next.present;
    const selected=selectionHistory.current.get(next.present);if(selected!==undefined)setSelectedChordId(selected);
    if (action.type === "undo" || action.type === "redo")
      setSaveStatus(user ? "Device draft · saving…" : "Device draft");
    dispatch(action);
  }
  function edit(
    update: (document: ProjectDocument) => ProjectDocument,
    label: string,
  ) {
    if(takePreview.current)cancelPreview();
    if(activeEdit.current){
      if(activeEdit.current.invalid)return;
      const before=applyPreview(committedRef.current,activeEdit.current),next=update(before);
      if(takeSession.current&&(JSON.stringify(next.tracks)!==JSON.stringify(before.tracks)||JSON.stringify(next.master)!==JSON.stringify(before.master)||next.tempo!==before.tempo||JSON.stringify(next.timeSignature)!==JSON.stringify(before.timeSignature))){setError("Finish recording before changing playback or instruments.");return;}
      const tx=previewEdit({...activeEdit.current,label},before,next);
      tx.invalid=projectSchema.safeParse(next).success?null:"This value is outside the supported range. Correct it or press Escape.";
      renderEdit(tx);
    }else commit(update(committedRef.current), label);
  }
  function applyChord(command:ChordCommand){
    if(!finishEdit())return {ok:false as const,error:"Finish or cancel the current field first."};
    const result=chordCommand(committedRef.current,command);
    if(result.ok){if(!commit(result.document,"Edit chord guide"))return {ok:false as const,error:"This edit is unavailable while recording."};setSelectedChordId(result.selectedId??"");selectionHistory.current.set(result.document,result.selectedId??"");}
    return result;
  }
  function updateTrack(
    id: string,
    update: Partial<Track> | ((track: Track) => Track),
    label = "Edit track",
  ) {
    edit(
      (p) => ({
        ...p,
        tracks: p.tracks.map((t) =>
          t.id === id
            ? typeof update === "function"
              ? update(t)
              : { ...t, ...update }
            : t,
        ),
      }),
      label,
    );
  }
  function updateClip(
    trackId: string,
    clipId: string,
    update: (clip: Clip) => Clip,
    label = "Edit phrase",
  ) {
    updateTrack(
      trackId,
      (t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? update(c) : c)),
      }),
      label,
    );
  }
  function assignModulation(sourceId:string,target:ModTarget,trackId=selectedTrackRef.current?.id,sourceTrackId?:string){
    if(takeSession.current){setError("Finish recording before configuring modulation.");return false;}
    if(!finishGesture())return false;
    if(activeEdit.current?.invalid){setError(activeEdit.current.invalid);return false;}
    const doc=projectRef.current,track=doc.tracks.find(t=>t.id===trackId);
    if(!track){setError("Select a track before assigning modulation.");return false;}
    const instrument=instrumentFor(doc,track);
    const result=assignModulationRoute(track.modulation??emptyPatch(doc.seed),sourceId,target,uid(),
      {audio:track.kind==="audio",synth:instrument.kind==="synth",fm:instrument.kind==="synth"&&track.sound.algorithm==="fm"},track.id,sourceTrackId);
    if(!result.ok){setError(result.error);return false;}
    updateTrack(track.id,{modulation:result.patch},"Assign modulation");return true;
  }
  function selectTrack(id: string) {
    cancelLibraryOperationRef.current();
    if(id!==selectedTrackId)terminateDetailInputs();
    if(!finishEdit())return false;
    const view=selectStudioTrack(projectRef.current,currentView(),id);
    if(!view)return false;
    cancelPreview();
    if(id!==selectedTrackId)cancelMidiLearn();
    clipsByTrack.current=new Map(Object.entries(view.clips));
    setSelectedClipId(view.clip);setSelectedTrackId(view.track);return true;
  }
  function currentView():StudioView{return {version:2,mode,detailTool,track:selectedTrackId,section:selectedSectionId,chord:selectedChordId,clip:selectedClipId,clips:Object.fromEntries(clipsByTrack.current),songViewport:songViewportRef.current};}
  function selectClip(trackId: string, clipId: string) {
    cancelLibraryOperationRef.current();
    terminateDetailInputs();
    if(!finishEdit())return false;
    const view=selectStudioClip(projectRef.current,currentView(),trackId,clipId);
    if(!view)return false;
    if(trackId!==selectedTrackId)cancelMidiLearn();
    cancelPreview();clipsByTrack.current=new Map(Object.entries(view.clips));
    setSelectedTrackId(trackId);
    setSelectedClipId(clipId);
    setDetailToolState("notes");setClipEditorRequest(request=>request+1);return true;
  }
  function insertClip(trackId:string,clip:Clip,label="Insert phrase"){
    if(takeSession.current){report(new Error("Finish recording before inserting another phrase."));return false;}
    if(!finishEdit())return false;
    const doc=committedRef.current;if(!doc.tracks.some(t=>t.id===trackId))return false;
    if(!commit({...doc,tracks:doc.tracks.map(t=>t.id===trackId?{...t,clips:[...t.clips,clip]}:t)},label))return false;
    return selectClip(trackId,clip.id);
  }
  function addTrack(instrumentId = "piano", name = "Grand piano") {
    if(takeSession.current){report(new Error("Finish recording before adding an instrument."));return;}
    if(!finishEdit())return;
    const p = committedRef.current;
    if (p.tracks.length >= 64) {
      report(new Error("This project already has 64 tracks."));
      return;
    }
    const track = createTrack(
      instrumentId,
      name,
      TRACK_COLORS[p.tracks.length % TRACK_COLORS.length],
    );
    if(!commit({...p,tracks:[...p.tracks,track]}, "Add track"))return;
    setSelectedTrackId(track.id);setSelectedClipId("");
    return track.id;
  }
  function loadDocument(
    document: ProjectDocument,
    revision = 0,
    fingerprint = JSON.stringify(document),
    editPolicy: "finish" | "discard" = "finish",
  ) {
    cancelLibraryOperationRef.current();cancelLibraryPreviewRef.current();
    if (takeSession.current || importCount.current) { report(new Error("Finish recording or importing before opening another song.")); return false; }
    if(editPolicy === "discard") { cancelEdit(); setError(""); }
    else if(!finishEdit())return false;
    setEditConflict(null);
    const sameProject=committedRef.current.id===document.id;
    const trackId=sameProject&&document.tracks.some(t=>t.id===selectedTrackId)?selectedTrackId:document.tracks[0]?.id??"";
    const sectionId=sameProject&&document.sections.some(sec=>sec.id===selectedSectionId)?selectedSectionId:document.sections[1]?.id??document.sections[0].id;
    const chordId=sameProject&&document.chords.some(c=>c.id===selectedChordId)?selectedChordId:"";
    const clipId=sameProject&&document.tracks.find(t=>t.id===trackId)?.clips.some(c=>c.id===selectedClipId)?selectedClipId:"";
    if(!sameProject){
      viewScopeRef.current=null;setViewRestoreRequest(request=>request+1);
      clipsByTrack.current.clear();setModeState("arrange");setDetailToolState("notes");
    }
    libraryRevisions.reset();committedRef.current=document;setSelectedChordId(chordId);setAutomationFocus({scope:"",parameter:"volume"});
    pendingPreview.current=null;++audioIntent.current; heldInputs.current.clear(); controlTargets.current.clear(); controllerStates.current.clear(); syncHeld();
    movement.current?.clear();cancelMidiLearn();runtimeMacrosRef.current={};setRuntimeMacros({});engineRef.current?.stop();
    projectRef.current = document;
    dispatch({ type: "load", project: document });
    meta.current.set(document.id, { revision, fingerprint });
    setSelectedTrackId(trackId);
    setSectionState(sectionId);
    setSelectedClipId(clipId);
    setSelectedNotes(document.chords[0]?.notes ?? []);
    setConflict(null);
    conflictRef.current = null;
    setSaveStatus(revision ? "Saved to cloud" : "Not saved");
    return true;
  }
  async function getEngine() {
    if (engineRef.current) return engineRef.current;
    if (!engineJob.current)
      engineJob.current = import("../../lib/audio/engine")
        .then(({ StudioEngine }) => {
          const result = new StudioEngine(projectRef.current, (id) =>
            resolveAsset(ownerRef.current, id),
          );
          result.onStatus = (text) => setMessage(text);
          result.subscribe((state) => setIsPlaying(state.playing));
          for(const state of [...controllerStates.current.values()].sort((a,b)=>a.sequence-b.sequence))result.expression(state.trackId,state.event,0,false,state.source??"performance");
          engineRef.current = result;
          setEngine(result);
          setReady(true);
          return result;
        })
        .catch((error) => {
          engineJob.current = null;
          throw error;
        });
    return engineJob.current;
  }
  function getProcessor() {
    if (!processor.current) processor.current = new AudioProcessor();
    return processor.current;
  }
  async function refreshLibrary() {
    if (!user) return;
    try {
      setProjects(await listProjects());
    } catch (error) {
      report(error);
    }
  }

  async function saveNow(
    document = committedRef.current, settle=true,
  ): Promise<CloudProject | null> {
    if(settle){if(!finishEdit())return null;document=committedRef.current;}
    if (takeSession.current) return null;
    if (!user) {
      notify(
        "Sign in with ChatGPT to save across devices. You can export a backup now.",
      );
      return null;
    }
    if (conflictRef.current) return null;
    if (saveJob.current) {
      await saveJob.current;
      document = committedRef.current;
    }
    const fingerprint = JSON.stringify(document),
      existing = meta.current.get(document.id) ?? {
        revision: 0,
        fingerprint: "",
      };
    if (existing.revision && existing.fingerprint === fingerprint)
      return {
        document,
        revision: existing.revision,
        updatedAt: new Date().toISOString(),
      };
    const snapshot = document;
    const job = (async () => {
      setSaveStatus("Saving…");
      try {
        const pending = await Promise.all(
          snapshot.assets.map((asset) => pendingAsset(owner, asset.id)),
        );
        let revision = existing.revision;
        if (!revision) {
          const pendingIds = new Set(
            pending.filter(Boolean).map((a) => a!.asset.id),
          );
          const base: ProjectDocument = {
            ...snapshot,
            assets: snapshot.assets.filter((a) => !pendingIds.has(a.id)),
            userInstruments: snapshot.userInstruments.filter(
              (i) =>
                !i.zones.some((z) => z.assetId && pendingIds.has(z.assetId)),
            ),
            tracks: snapshot.tracks.map((t) => ({
              ...t,
              clips: t.clips.filter(
                (c) => !c.audio || !pendingIds.has(c.audio.assetId),
              ),
            })),
          };
          const created = await createCloudProject(base);
          revision = created.revision;
          meta.current.set(snapshot.id, {
            revision,
            fingerprint: JSON.stringify(base),
          });
        }
        for (const asset of pending)
          if (asset) await uploadPending({ ...asset, projectId: snapshot.id });
        const result = await saveCloudProject(snapshot, revision);
        meta.current.set(snapshot.id, {
          revision: result.revision,
          fingerprint,
        });
        if (projectRef.current.id === snapshot.id)
          setSaveStatus(
            JSON.stringify(projectRef.current) === fingerprint
              ? "Saved to cloud"
              : "Saving edits…",
          );
        // Cloud success and device durability are separate receipts.
        await persistDeviceDraft(projectRef.current.id === snapshot.id ? recoverableDocument() : snapshot, owner).catch(report);
        void refreshLibrary();
        return result;
      } catch (error) {
        if (
          error instanceof CloudError &&
          error.status === 409 &&
          error.details
        ) {
          const recovery = {
            ...snapshot,
            id: uid(),
            title: snapshot.title.slice(0, 178) + " · recovered copy",
          };
          await saveDraft({
            owner,
            document: recovery,
            revision: 0,
            savedFingerprint: "",
            updatedAt: new Date().toISOString(),
          }).catch(report);
          conflictRef.current = {
            incoming: snapshot,
            ...error.details,
            recoveryId: recovery.id,
          };
          setConflict(conflictRef.current);
          setSaveStatus("Two versions kept");
        } else {
          setSaveStatus("Recovery draft · retry save");
          report(error);
        }
        return null;
      } finally {
        saveJob.current = null;
      }
    })();
    saveJob.current = job;
    return job;
  }

  const effectNotify=useEffectEvent(notify),effectReport=useEffectEvent(report);
  const restoredDraftReceipt=useEffectEvent(noteDraftReceipt);
  const autoSaveDraft=useEffectEvent((document: ProjectDocument, saveOwner: string) => { void persistDeviceDraft(document, saveOwner).catch(effectReport); });
  const restoreDocument = useEffectEvent(loadDocument);
  const autoSave = useEffectEvent((document: ProjectDocument) => {
    void saveNow(document,false);
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let draft = await latestDraft(owner);
        if (user && sessionStorage.getItem("chordz-continue-guest") === "1") {
          const guest = await latestDraft("guest");
          if (guest) {
            for (const asset of guest.document.assets) {
              const blob = await resolveAsset("guest", asset.id);
              await keepPendingAsset({
                owner,
                projectId: guest.document.id,
                asset,
                blob,
              });
            }
            draft = { ...guest, owner, revision: 0, savedFingerprint: "" };
            await saveDraft(draft);
          }
          sessionStorage.removeItem("chordz-continue-guest");
        }
        if (cancelled) return;
        if (draft) {
          const document = projectSchema.parse(draft.document);
          restoreDocument(document, draft.revision, draft.savedFingerprint);
          restoredDraftReceipt(document, owner, true);
          effectNotify("Your latest device draft has been restored.");
          if(draft.recoveryWarning)effectReport(new Error(draft.recoveryWarning));
        }
        if (user) {
          const library = await listProjects();
          if (cancelled) return;
          setProjects(library);
          if (!draft && library.length) {
            const cloud = await loadProject(library[0].id);
            if (!cancelled) restoreDocument(cloud.document, cloud.revision);
          }
        }
      } catch (error) {
        if (!cancelled) effectReport(error);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, user]);
  useEffect(() => {
    if (!hydrated) return;
    // Unfinished note input and explicit proposals must not become recovered music.
    const audition=transaction?.owner?.startsWith("reference-")||transaction?.owner?.startsWith("reference:")||transaction?.owner?.startsWith("modulation-ab:")||transaction?.owner?.startsWith("note-transform:")||transaction?.owner?.startsWith("note-gesture:");
    const draftDocument=audition?history.present:project;
    const timer = setTimeout(() => {
      if (takeSession.current?.phase === "finalizing" || !projectSchema.safeParse(draftDocument).success) return;
      autoSaveDraft(draftDocument, owner);
    }, 250);
    const cloudTimer = setTimeout(() => {
      if(takeSession.current) return;
      if (
        user &&
        !conflictRef.current &&
        JSON.stringify(history.present) !==
          (meta.current.get(history.present.id)?.fingerprint ?? "")
      )
        autoSave(history.present);
    }, 1700);
    return () => {
      clearTimeout(timer);
      clearTimeout(cloudTimer);
    };
  }, [project,history.present,transaction, hydrated, owner, user]);
  useEffect(() => {
    if(!projectSchema.safeParse(project).success)return;
    const prior=macroProject.current;macroProject.current=project;
    if(!takeSession.current){
      let changed=false;
      for(const track of project.tracks){
        const before=prior.tracks.find(t=>t.id===track.id)?.modulation?.macros,after=track.modulation?.macros;
        if(prior.id===project.id&&JSON.stringify(before)===JSON.stringify(after))continue;
        changed=true;runtimeMacrosRef.current={...runtimeMacrosRef.current,[track.id]:after??[0,0,0,0]};
        for(const [key,state]of controllerStates.current)if(state.trackId===track.id&&state.event.type==="macro")controllerStates.current.delete(key);
      }
      if(changed)queueMicrotask(()=>setRuntimeMacros(runtimeMacrosRef.current));
    }
    engineRef.current?.updateProject(project);
  }, [project]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      const current = meta.current.get(projectRef.current.id);
      if (
        recording ||
        (user && JSON.stringify(projectRef.current) !== current?.fingerprint)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [recording, user]);
  useEffect(
    () => () => {
      engineRef.current?.dispose();
      processor.current?.dispose();
      recorder.current?.dispose();
      for (const input of midiAccess.current?.inputs.values() ?? [])
        input.onmidimessage = null;
    },
    [],
  );

  async function play() {
    pendingPreview.current=null;
    if (transportJob.current || takeSession.current) return;
    transportJob.current = true;
    const token = ++audioIntent.current;
    try {
      const audio = await getEngine();
      if (token !== audioIntent.current) return;
      audio.setLoop(loop, 0, projectEnd(projectRef.current));
      audio.setMetronome(metronome);
      if (audio.state.playing) audio.pause();
      else await audio.play();
    } catch (error) {
      report(error);
    } finally {
      transportJob.current = false;
    }
  }
  function stop() {
    recordingInput.release();
    movement.current?.clear();cancelMidiLearn();
    cancelInteraction.current?.();
    pendingPreview.current=null;
    ++audioIntent.current;
    if (takeSession.current) void finishRecording(true);
    else { engineRef.current?.stop(); heldInputs.current.clear(); controlTargets.current.clear(); controllerStates.current.clear(); syncHeld(); }
  }
  function setLoop(value: boolean) {
    setLoopState(value);
    engineRef.current?.setLoop(value, 0, projectEnd(projectRef.current));
  }
  function setMetronome(value: boolean) {
    setMetronomeState(value);
    engineRef.current?.setMetronome(value);
  }
  async function seek(tick: number) {
    if (takeSession.current) return;
    try {
      await (await getEngine()).seek(tick);
    } catch (error) {
      report(error);
    }
  }
  function cancelPreview() { takePreview.current=false;cancelLibraryPreviewRef.current();pendingPreview.current=null;++audioIntent.current; engineRef.current?.cancelAudition(); }
  async function previewTake(trackId: string, clipId: string) {
    if (takeSession.current || busy || !finishEdit()) return;
    const doc = committedRef.current, previewOwner = ownerRef.current;
    const identity = `take_${doc.id}_${trackId}_${clipId}`;
    if (pendingPreview.current?.identity === identity || engineRef.current?.state.previewId === identity) { cancelPreview(); return; }
    cancelPreview();
    takePreview.current = true;
    const token = ++audioIntent.current;
    pendingPreview.current = { identity, token };
    try {
      const preview = buildTakePreview(doc, trackId, clipId);
      const audio = await getEngine();
      if (token !== audioIntent.current || previewOwner !== ownerRef.current || committedRef.current.id !== doc.id) return;
      audio.pause();
      await audio.previewSnapshot(preview, id => resolveAsset(previewOwner, id), identity);
      if (token === audioIntent.current) pendingPreview.current = null;
    } catch (error) {
      if (token === audioIntent.current) { takePreview.current = false;pendingPreview.current = null; report(error); }
    }
  }
  async function previewPhrase(trackId: string, notes: NoteEvent[], identity: string) {
    if (takeSession.current) return;
    if(pendingPreview.current?.identity===identity){cancelPreview();return;}
    const token = ++audioIntent.current;pendingPreview.current={identity,token};
    try { const audio = await getEngine(); if (token !== audioIntent.current) return;pendingPreview.current=null;
      await audio.previewNotes(trackId,notes.map((n,index)=>({...n,trackId,index})),identity);
    } catch(error) { if (token === audioIntent.current){pendingPreview.current=null;report(error);} }
  }
  async function audition(pitches:number[],duration=.9,automatic=false){
    if(takeSession.current||(automatic&&(transportJob.current||engineRef.current?.state.playing||engineRef.current?.state.activity==="song-loading")))return;
    const track=selectedTrackRef.current??projectRef.current.tracks.find(t=>t.kind==="instrument");if(!track||track.kind==="audio")return;
    const doc=projectRef.current,identity=JSON.stringify(["chord",doc.id,track.id,track.instrumentId,doc.tempo,doc.timeSignature,pitches,duration]);
    await previewPhrase(track.id,pitches.map(pitch=>({id:uid(),pitch,tick:0,duration:secondsToTick(duration,doc.tempo),velocity:.68})),identity);
  }
  function syncHeld() {
    heldRef.current = new Set([...heldInputs.current.values()].map(i=>i.pitch));
    setHeldNotes(new Set(heldRef.current)); if (!latch) setSelectedNotes([...heldRef.current]);
  }
  function captureStarted() {
    const session=takeSession.current;
    if(session?.phase!=="count-in" || (engineRef.current?.rawContext?.currentTime??0)<session.startTime) return;
    phase(session,"capturing");
    const take=midiTake.current;
    if(take) {
      for(const [id,input] of heldInputs.current) if(input.trackId===take.trackId&&!projectRef.current.tracks.find(t=>t.id===input.trackId)?.chordMovement?.liveEnabled){const noteId=uid();take.open.set(id,{id:noteId,pitch:input.pitch,tick:0,velocity:input.velocity});engineRef.current?.rebindLiveNote(id,noteId,session.startTick);}
      const values=new Map<string,PerformanceEvent>();
      const patch=projectRef.current.tracks.find(t=>t.id===take.trackId)?.modulation;
      if(patch)MACRO_IDS.forEach((macroId,index)=>values.set(`macro:${macroId}`,{tick:0,type:"macro",macroId,value:patch.macros[index]}));
      const pending:PerformanceEvent[]=[];
      for(const {trackId,event,at,previous} of [...controllerStates.current.values()].sort((a,b)=>(a.at??0)-(b.at??0)||a.sequence-b.sequence)) if(trackId===take.trackId){
        const key=performanceKey(event);
        if(at!==undefined&&at>session.startTime){values.set(key,{...(previous??{...event,value:0}),tick:0});pending.push({...event,tick:Math.round(secondsToTick(at-session.startTime,session.tempo))});}
        else values.set(key,{...event,value:event.type==="sustain"?Math.max(values.get(key)?.value??0,event.value):event.value,tick:0});
      }
      take.events.push(...values.values(),...pending);
    }
  }
  function takeTick() {
    const session = takeSession.current;
    return session ? secondsToTick(Math.max(0,(engineRef.current?.rawContext?.currentTime ?? 0)-session.startTime),session.tempo) : 0;
  }
  function liveClock(){
    const audio=engineRef.current,context=audio?.rawContext,state=audio?.state;
    return {tick:state?.playing?state.tick:secondsToTick(context?.currentTime??0,projectRef.current.tempo),kind:state?.playing?"song":"live",countIn:state?.countIn??false};
  }
  function getMovement(){
    if(!movement.current)movement.current=new LiveMovement((track,note)=>{
      const audio=engineRef.current,context=audio?.rawContext;if(!audio||!context)return;
      const clock=liveClock(),at=Math.max(context.currentTime,context.currentTime+tickToSeconds(note.tick-clock.tick,projectRef.current.tempo));
      const duration=tickToSeconds(note.duration,projectRef.current.tempo),inputId=`movement:${track.id}:${note.id}`;
      const session=takeSession.current,take=midiTake.current;
      let scheduled=note;
      for(const [id,capture]of movementCaptures.current)if(capture.end<context.currentTime)movementCaptures.current.delete(id);
      if(session?.phase==="capturing"&&take?.trackId===track.id){const tick=Math.max(0,Math.round(secondsToTick(at-session.startTime,session.tempo)));scheduled={...note,tick:session.startTick+tick};take.notes.push({...note,tick,duration:Math.max(1,Math.round(secondsToTick(duration,session.tempo)))});movementCaptures.current.set(note.id,{trackId:track.id,takeId:session.id,at,end:at+duration});}
      void audio.scheduleLiveNote(track.id,scheduled,at,duration,inputId).catch(error=>{if(movementCaptures.current.delete(note.id)&&midiTake.current)midiTake.current.notes=midiTake.current.notes.filter(n=>n.id!==note.id);report(error);});
    },trackId=>{
      const session=takeSession.current,take=midiTake.current,now=engineRef.current?.rawContext?.currentTime??0;
      for(const [id,capture]of movementCaptures.current){
        if(capture.trackId!==trackId)continue;
        if(session?.id===capture.takeId&&take){
          if(capture.at>=now)take.notes=take.notes.filter(n=>n.id!==id);
          else if(capture.end>now)take.notes=take.notes.map(n=>n.id===id?{...n,duration:Math.max(1,Math.round(secondsToTick(now-capture.at,session.tempo)))}:n);
        }
        movementCaptures.current.delete(id);
      }
      engineRef.current?.releaseSource(`movement:${trackId}:`);
    });
    return movement.current;
  }
  const movementTick=useRef<()=>void>(()=>{});
  useEffect(()=>{movementTick.current=()=>{if(!engineRef.current?.rawContext)return;captureStarted();getMovement().advance(projectRef.current,liveClock(),secondsToTick(.14,projectRef.current.tempo));};});
  useEffect(()=>{
    const timer=setInterval(()=>movementTick.current(),25);
    return()=>{clearInterval(timer);movement.current?.clear();midiLearn.current=null;};
  },[]);
  async function noteOn(pitch: number, velocity = 0.75, inputId = "pointer:" + pitch) {
    captureStarted();
    const session = takeSession.current;
    const track = session?.kind === "midi" ? projectRef.current.tracks.find(t=>t.id===session.trackId) : selectedTrackRef.current;
    if (!track || track.kind === "audio") return;
    if (heldInputs.current.has(inputId)) noteOff(pitch,inputId);
    const input = { trackId: track.id,pitch,velocity }; heldInputs.current.set(inputId,input); syncHeld();
    if (latch) setSelectedNotes(notes=>notes.includes(pitch)?notes:[...notes,pitch]);
    const take = midiTake.current;
    if(take && session?.phase === "capturing" && take.trackId===track.id&&!track.chordMovement?.liveEnabled) take.open.set(inputId,{ id:uid(),pitch,tick:takeTick(),velocity });
    try { const audio = await getEngine(); if(heldInputs.current.get(inputId)!==input) return;
      if(track.chordMovement?.liveEnabled){getMovement().noteOn(inputId,track,pitch,velocity);getMovement().advance(projectRef.current,liveClock(),secondsToTick(.14,projectRef.current.tempo));}
      else {const open=take?.open.get(inputId);await audio.noteOn(track.id,pitch,velocity,inputId,open&&session?{id:open.id,tick:session.startTick+Math.round(open.tick)}:undefined);}

    } catch(error) { if(heldInputs.current.get(inputId)===input) { heldInputs.current.delete(inputId); syncHeld(); } report(error); }
  }
  function noteOff(pitch: number, inputId = "pointer:" + pitch, cutoffTick?:number) {
    captureStarted();
    const input = heldInputs.current.get(inputId); heldInputs.current.delete(inputId); syncHeld();
    if(input){movement.current?.noteOff(inputId,projectRef.current);engineRef.current?.noteOff(input.trackId,input.pitch,inputId);}
    const take=midiTake.current, open=take?.open.get(inputId);
    if(take && open) { const end=cutoffTick??takeTick();
      if(end>open.tick) take.notes.push({id:open.id,pitch:open.pitch,tick:Math.round(open.tick),duration:Math.max(1,Math.round(end-open.tick)),velocity:open.velocity});
      take.open.delete(inputId);
    }
  }
  function releaseHeld(prefix:string){for(const [id,input]of heldInputs.current)if(id.startsWith(prefix))noteOff(input.pitch,id);}
  function terminateDetailInputs(){
    freezeToolGestures("detail");
    releaseSource("pointer:");releaseSource("button:");releaseSource("sound:sustain");
  }
  function releaseSource(prefix: string) {
    captureStarted();
    const cutoffTick=takeTick();
    movement.current?.releaseSource(prefix,projectRef.current);
    const matches=(source:string)=>source===prefix.replace(/:$/, "")||source.startsWith(prefix);
    const before=[...controllerStates.current.values()].sort((a,b)=>(b.at??0)-(a.at??0)||b.sequence-a.sequence);
    for(const [source] of controlTargets.current) if(matches(source)) { expression("sustain",0,source,cutoffTick); controlTargets.current.delete(source); }
    for(const key of controllerStates.current.keys()) if(matches(key)) controllerStates.current.delete(key);
    for(const [id,input] of heldInputs.current) if(id.startsWith(prefix)) noteOff(input.pitch,id,cutoffTick);
    const resets=engineRef.current?.releaseSource(prefix)??[];
    const legacy=new Map(before.filter(state=>state.source&&matches(state.source)&&!["controlChange","macro","sustain"].includes(state.event.type)).map(state=>[`${state.trackId}:${performanceKey(state.event)}`,state]));
    for(const state of legacy.values()){
      const fallback=[...controllerStates.current.values()].filter(other=>other.trackId===state.trackId&&performanceKey(other.event)===performanceKey(state.event)).sort((a,b)=>b.sequence-a.sequence)[0];
      const event={...state.event,value:fallback?.event.value??(state.event.type==="expression"?1:0)},at=engineRef.current?.expression(state.trackId,event);
      resets.push({trackId:state.trackId,event,at:at??0});
    }
    for(const {trackId,event,at}of resets){
      const previous=before.find(state=>state.trackId===trackId&&performanceKey(state.event)===performanceKey(event))?.event??{...event,value:0};
      controllerStates.current.set(`cleanup:${trackId}:${performanceKey(event)}`,{trackId,event,at,previous,sequence:controllerSequence.current++});
      // Closing a UI surface freezes its last performed value; device release remains musical cleanup.
      const session=takeSession.current,take=midiTake.current;
      if(captureReleaseReset(prefix)&&take&&session?.phase==="capturing"&&take.trackId===trackId)take.events.push({...event,tick:Math.round(secondsToTick(Math.max(0,at-session.startTime),session.tempo))});
    }
  }
  const controlTargets = useRef(new Map<string,string>());
  const controllerSequence=useRef(0);
  const controllerStates = useRef(new Map<string,{trackId:string;event:PerformanceEvent;at?:number;previous?:PerformanceEvent;source?:string;sequence:number}>());
  function expression(type: PerformanceEvent["type"], value: number, source="performance", cutoffTick?:number) {
    captureStarted();
    const session=takeSession.current;
    const heldTrack=[...heldInputs.current].find(([id])=>id.startsWith(source+":"))?.[1].trackId;
    const target=controlTargets.current.get(source) ?? heldTrack ?? (session?.kind==="midi"?session.trackId:selectedTrackRef.current?.id);
    if(!target) return; if((type==="sustain" && value>=0.5)||heldTrack) controlTargets.current.set(source,target);
    const sustainBefore=type==="sustain"?effectiveSustain(controllerStates.current.values(),target):0;
    const event={tick:0,type,value}; const at=engineRef.current?.expression(target,event,undefined,false,source);controllerStates.current.set(source+":"+performanceKey(event),{trackId:target,event,at,source,sequence:controllerSequence.current++});
    if(type==="sustain")movement.current?.pedal(source,target,value>=.5,projectRef.current);
    const take=midiTake.current;
    if(take && session?.phase==="capturing" && target===take.trackId){
      const captured=capturedExpression(event,Math.round(cutoffTick??takeTick()),sustainBefore,type==="sustain"?effectiveSustain(controllerStates.current.values(),target):0);
      if(captured)take.events.push(captured);
    }
    if(type==="sustain" && value<0.5) controlTargets.current.delete(source);
  }
  function performMacro(index:number,value:number){
    if(index<0||index>3||!Number.isFinite(value))return;
    captureStarted();
    const target=takeSession.current?.kind==="midi"?takeSession.current.trackId:selectedTrackRef.current?.id;
    const track=projectRef.current.tracks.find(t=>t.id===target);if(!track)return;
    const values=[...(runtimeMacrosRef.current[track.id]??track.modulation?.macros??[0,0,0,0])] as [number,number,number,number];
    const previous:PerformanceEvent={tick:0,type:"macro",macroId:MACRO_IDS[index],value:values[index]};values[index]=Math.max(0,Math.min(1,value));
    runtimeMacrosRef.current={...runtimeMacrosRef.current,[track.id]:values};setRuntimeMacros(runtimeMacrosRef.current);
    const event:PerformanceEvent={tick:0,type:"macro",macroId:MACRO_IDS[index],value:values[index]};
    const at=engineRef.current?.expression(track.id,event);
    controllerStates.current.set(`macro:${track.id}:${MACRO_IDS[index]}`,{trackId:track.id,event,at,previous,sequence:controllerSequence.current++});
    const take=midiTake.current,session=takeSession.current;if(take&&session?.phase==="capturing"&&take.trackId===track.id)take.events.push({...event,tick:Math.round(at===undefined?takeTick():secondsToTick(Math.max(0,at-session.startTime),session.tempo))});
  }
  function controlChange(cc:number,value:number,channel:number,source:string){
    if(cc<0||cc>119||!Number.isFinite(value))return;
    captureStarted();
    const learned=midiLearn.current;if(learned){cancelMidiLearn();learned(cc,channel);}
    const target=controlTargets.current.get(source)??[...heldInputs.current].find(([id])=>id.startsWith(source+":"))?.[1].trackId??(takeSession.current?.kind==="midi"?takeSession.current.trackId:selectedTrackRef.current?.id);
    if(!target)return;const event:PerformanceEvent={tick:0,type:"controlChange",cc,channel,value:Math.max(0,Math.min(1,value))};
    const key=source+":"+performanceKey(event),previous=controllerStates.current.get(key)?.event??{...event,value:0};
    const at=engineRef.current?.expression(target,event,undefined,false,source);
    controllerStates.current.set(key,{trackId:target,event,at,previous,source,sequence:controllerSequence.current++});
    const take=midiTake.current,session=takeSession.current;if(take&&session?.phase==="capturing"&&take.trackId===target)take.events.push({...event,tick:Math.round(at===undefined?takeTick():secondsToTick(Math.max(0,at-session.startTime),session.tempo))});
  }
  function cancelMidiLearn(){midiLearn.current=null;setMidiLearning(false);}
  async function beginMidiLearn(callback:(cc:number,channel:number)=>void){
    if(takeSession.current)return;
    const trackId=selectedTrackRef.current?.id,projectId=projectRef.current.id;
    await enableMidi();
    if(!midiAccess.current||takeSession.current||selectedTrackRef.current?.id!==trackId||projectRef.current.id!==projectId)return;
    midiLearn.current=callback;setMidiLearning(true);notify("Move a MIDI control to assign it. Cancel stops learning.");
  }
  useEffect(() => {
    if(midiInputId!=="all")for(const input of midiAccess.current?.inputs.values()??[])if(input.id!==midiInputId)inputHandlers.current.releaseSource(`midi:${input.id}:`);
  },[midiInputId]);
  const inputHandlers = useRef({ noteOn, noteOff, expression, releaseSource,controlChange });
  useLayoutEffect(() => {
    inputHandlers.current = { noteOn, noteOff, expression, releaseSource,controlChange };
  });
  async function enableMidi() {
    try {
      if (!navigator.requestMIDIAccess)
        throw new Error(
          "This browser has no MIDI input support. Use the piano or computer keyboard.",
        );
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.current = access;
      const connect = () => {
        setMidiInputs([...access.inputs.values()]);
        for (const input of access.inputs.values())
          input.onmidimessage = (event) => {
            if (
              midiInputRef.current !== "all" &&
              midiInputRef.current !== input.id
            )
              { inputHandlers.current.releaseSource("midi:"+input.id+":"); return; }
            const [status, a, b] = event.data ?? [];
            const kind = status & 0xf0;
            if (kind === 0x90 && b > 0)
              void inputHandlers.current.noteOn(a, b / 127, "midi:"+input.id+":"+(status&15)+":"+a);
            else if (kind === 0x80 || (kind === 0x90 && b === 0))
              inputHandlers.current.noteOff(a,"midi:"+input.id+":"+(status&15)+":"+a);
            else if (kind === 0xb0) {
              if(a>=120){inputHandlers.current.releaseSource("midi:"+input.id+":"+(status&15)+":");return;}
              inputHandlers.current.controlChange(a,b/127,status&15,"midi:"+input.id+":"+(status&15));
              if (a === 64)
                inputHandlers.current.expression("sustain", b / 127,"midi:"+input.id+":"+(status&15));
              if (a === 1)
                inputHandlers.current.expression("modulation", b / 127,"midi:"+input.id+":"+(status&15));
              if (a === 11)
                inputHandlers.current.expression("expression", b / 127,"midi:"+input.id+":"+(status&15));
            } else if (kind === 0xe0)
              inputHandlers.current.expression(
                "pitchBend",
                ((b << 7) + a - 8192) / 8192,
                "midi:"+input.id+":"+(status&15),
              );
            else if (kind === 0xd0)
              inputHandlers.current.expression("pressure", a / 127,"midi:"+input.id+":"+(status&15));
          };
      };
      connect();
      access.onstatechange = (event) => {
        if (event.port?.state === "disconnected") {
          inputHandlers.current.releaseSource("midi:"+event.port.id+":");
          setMidiInputId("all");
          notify("MIDI device disconnected. Computer keyboard input is ready.");
        }
        connect();
      };
      setMidiEnabled(true);
      notify(
        access.inputs.size
          ? "MIDI is connected. Play into the selected instrument track."
          : "MIDI access enabled. Connect a controller, or use the computer keyboard.",
      );
    } catch (error) {
      report(error);
    }
  }
  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      setMicrophones((devices ?? []).filter((d) => d.kind === "audioinput"));
    } catch (error) {
      report(error);
    }
  }
  function setMonitor(value: boolean) {
    monitorRef.current = value;
    setMonitorState(value);
    recorder.current?.setMonitoring(value);
    recordingInput.setMonitoring(value);
  }

  async function addAudio(
    blob: Blob,
    name: string,
    startTick = selectedSection.startTick,
    sampleOnly = false,
    known?: { duration: number; sampleRate: number; peaks: number[] },
  ) {
    if(takeSession.current) throw new Error("Finish recording before importing audio.");
    const origin={owner:ownerRef.current,projectId:projectRef.current.id,trackId:selectedTrackRef.current?.id};
    importCount.current++;
    try {
    if (
      projectRef.current.tracks.length >= 64 &&
      (sampleOnly || selectedTrackRef.current?.kind !== "audio")
    )
      throw new Error("This project already has 64 tracks.");
    if (blob.size > 100 * 1024 * 1024)
      throw new Error("Choose an audio file smaller than 100 MB.");
    const audio = await getEngine();
    const decoded = known ? null : await audio.decode(blob);
    const asset: AssetReference = {
      id: uid(),
      name,
      mime:
        blob.type === "audio/x-wav" ? "audio/wav" : blob.type || "audio/wav",
      byteLength: blob.size,
      duration: known?.duration ?? decoded!.duration,
      sampleRate: known?.sampleRate ?? decoded!.sampleRate,
      channels: decoded?.numberOfChannels ?? 1,
    };
    await keepPendingAsset({
      owner,
      projectId: origin.projectId,
      asset,
      blob,
    });
    const peaks = known?.peaks ?? (await getProcessor().peaks(decoded!));
    setWaveforms((w) => ({ ...w, [asset.id]: peaks }));
    const current = committedRef.current;
    if(current.id!==origin.projectId || ownerRef.current!==origin.owner) throw new Error("This import belongs to another song.");
    if (sampleOnly) {
      const instrument = {
        id: uid(),
        name: name.replace(/\.[^.]+$/, ""),
        family: "My samples",
        description: "Your mapped sample instrument.",
        kind: "sample" as const,
        zones: [
          {
            assetId: asset.id,
            root: 60,
            low: 0,
            high: 127,
            velocityLow: 0,
            velocityHigh: 1,
            roundRobin: 0,
            articulation: "sustain",
          },
        ],
        articulations: ["sustain"],
        license: "User supplied",
        source: "Private sample",
        defaults: { attack: 0.003, release: 0.4, detune: 0 },
      };
      const track = createTrack(
        instrument.id,
        instrument.name,
        TRACK_COLORS[current.tracks.length % 8],
      );
      commit(
        {
          ...current,
          assets: [...current.assets, asset],
          userInstruments: [...current.userInstruments, instrument],
          tracks: [...current.tracks, track],
        },
        "Map sample",
      );
      if(!activeEdit.current){selectTrack(track.id);setMode("sound");}
    } else {
      let track = current.tracks.find(
        (t) => t.id === origin.trackId && t.kind === "audio",
      );
      const isNew = !track;
      if (!track)
        track = createTrack(
          "piano",
          name.replace(/\.[^.]+$/, ""),
          TRACK_COLORS[current.tracks.length % 8],
          "audio",
        );
      const clip = {
        ...emptyClip(
          startTick,
          Math.max(1, secondsToTick(asset.duration, current.tempo)),
          name,
        ),
        audio: {
          assetId: asset.id,
          offsetSec: 0,
          gain: 1,
          fadeInSec: 0.005,
          fadeOutSec: 0.015,
        },
      };
      const tracks = isNew
        ? [...current.tracks, { ...track, clips: [clip] }]
        : current.tracks.map((t) =>
            t.id === track!.id ? { ...t, clips: [...t.clips, clip] } : t,
          );
      if(!commit(
        { ...current, assets: [...current.assets, asset], tracks },
        "Add audio take",
      ))throw new Error("The audio could not be added to this song.");
      if(!activeEdit.current)selectClip(track.id,clip.id);
    }
    notify(
      user
        ? "Audio added. Cloud upload will follow the recovery save."
        : "Audio kept on this device. Sign in for cloud storage or export a backup.",
    );
    return asset;
    } finally { importCount.current--; }
  }
  function phase(session: TakeSession, value: RecordingPhase) {
    session.phase=value; setRecordingPhase(value); setRecording(value!=="idle");
  }
  async function beginRecording() {
    if(takeSession.current) { if(takeSession.current.phase==="recovery-error") await retryRecording(); else await finishRecording(); return; }
    if(!finishEdit())return;
    if(transportJob.current || busy) return;
    if(importCount.current) { report(new Error("Wait for the audio import to finish before recording.")); return; }
    if(recordingDestinationMissing) { report(new Error("The recording destination is no longer available. Choose a destination in Record setup.")); return; }
    recordingInput.release();
    const doc=committedRef.current, target=doc.tracks.find(track => track.id === recordingDestination?.id);
    if(recordKind==="midi" && target?.kind!=="instrument") { report(new Error("Select an instrument track to record MIDI.")); return; }
    const newTrack=recordKind==="audio" && target?.kind!=="audio" ? createTrack("piano","Microphone",TRACK_COLORS[doc.tracks.length%8],"audio") : null;
    if(newTrack && doc.tracks.length>=64) { report(new Error("This project already has 64 tracks.")); return; }
    const session: TakeSession={id:uid(),owner,projectId:doc.id,trackId:newTrack?.id??target!.id,startTick:engineRef.current?.state.tick??0,tempo:doc.tempo,
      kind:recordKind,phase:"preparing",startTime:Infinity,reset:false,clipId:uid(),assetId:uid(),newTrack};
    takeSession.current=session; phase(session,"preparing"); cancelPreview();cancelMidiLearn();
    try {
      const audio=await getEngine(); if(takeSession.current!==session) return;
      audio.setLoop(false); audio.setMetronome(metronome);
      if(session.kind==="audio") {
        const mic=new MicrophoneRecorder(); recorder.current=mic;
        await mic.prepare(await audio.unlock(),microphoneId||undefined,audio.monitorDestination!);
        if(takeSession.current!==session) { mic.dispose(); return; }
        mic.setMonitoring(monitorRef.current);
      }
      await audio.play(session.startTick,recordCountIn);
      if(takeSession.current!==session) return;
      session.startTime=audio.recordingStartTime;
      audio.beginLiveModulationClock(session.startTime,tickToSeconds(session.startTick,session.tempo));
      recordingAt.current=session.startTime; recordingTick.current=session.startTick;
      if(session.kind==="audio") recorder.current!.start(session.startTime,audio.rawContext!);
      else midiTake.current={trackId:session.trackId,startTick:session.startTick,open:new Map(),notes:[],events:[]};
      phase(session,"count-in"); setRecordSeconds(0); notify(recordCountIn ? `${recordCountIn} bar count-in, then recording.` : "Recording starts now.");
    } catch(error) {
      if(takeSession.current===session) { recorder.current?.dispose(); recorder.current=null; takeSession.current=null; setRecording(false); setRecordingPhase("idle"); report(error); }
    }
  }
  async function retryRecording() {
    const session=takeSession.current;
    if(!session || session.phase!=="recovery-error") return;
    return finishRecording(session.reset);
  }
  function finishRecording(reset=false): Promise<void> {
    const session=takeSession.current;
    if(session && reset) { session.reset=true; engineRef.current?.stop(false); recorder.current?.muteMonitoring(); heldInputs.current.clear(); controlTargets.current.clear(); controllerStates.current.clear(); syncHeld(); }
    if(finalizeJob.current) return finalizeJob.current; if(!session) return Promise.resolve();
    session.reset ||= reset;
    const audio=engineRef.current, now=audio?.rawContext?.currentTime??0;
    if(session.phase==="preparing" || now<=session.startTime) {
      movement.current?.clear();
      takeSession.current=null; recorder.current?.dispose(); recorder.current=null; midiTake.current=null;
      audio?.stop(); heldInputs.current.clear(); syncHeld(); setRecording(false); setRecordingPhase("idle"); setBusy("");
      notify("Recording cancelled before capture."); return Promise.resolve();
    }
    if(session.endTime===undefined) {
      movement.current?.clear();
      session.endTime=now;
      const take=midiTake.current;
      if(take) {
        const end=secondsToTick(now-session.startTime,session.tempo);
        for(const open of take.open.values()) if(end>open.tick) take.notes.push({id:open.id,pitch:open.pitch,tick:Math.round(open.tick),duration:Math.max(1,Math.round(end-open.tick)),velocity:open.velocity});
        take.open.clear();
        session.clip={...emptyClip(session.startTick,Math.max(1,end),"MIDI take"),id:session.clipId,notes:take.notes.filter(n=>n.tick<end).map(n=>({...n,duration:Math.max(1,Math.min(n.duration,Math.round(end-n.tick)))})),events:take.events.filter(e=>e.tick<=end)};
      }
      recorder.current?.muteMonitoring();
      if(session.reset) { audio?.stop(false); heldInputs.current.clear(); syncHeld(); } else audio?.pause();
    }
    phase(session,"finalizing"); setBusy("Preserving your take…");
    const job=(async()=>{
      await Promise.resolve();
      try {
        if(session.kind==="audio" && !session.result) {
          const mic=recorder.current!;
          session.result=await mic.stop(session.endTime);
          if(session.result.duration<=0) { session.result=undefined; throw new Error("No captured audio is available. Your take has not been saved."); }
        }
        if(saveJob.current) await saveJob.current;
        const current=projectRef.current;
        if(current.id!==session.projectId || ownerRef.current!==session.owner) throw new Error("The take belongs to another song. Download it before closing.");
        let asset: AssetReference|undefined;
        if(session.result) {
          const result=session.result;
          asset={id:session.assetId,name:"Microphone take.wav",mime:"audio/wav",byteLength:result.blob.size,duration:result.duration,sampleRate:result.sampleRate,channels:1};
          session.clip={...emptyClip(session.startTick,Math.max(1,secondsToTick(result.duration,session.tempo)),"Microphone take"),id:session.clipId,
            audio:{assetId:asset.id,offsetSec:0,gain:1,fadeInSec:0.005,fadeOutSec:0.015}};
        }
        if(!session.clip || (session.kind==="midi" && !session.clip.notes.length && !session.clip.events.length)) notify("No MIDI notes were recorded.");
        else {
          const originalTarget=current.tracks.find(t=>t.id===session.trackId)??session.newTrack;
          if(!originalTarget) throw new Error("The recording destination is missing.");
          const extensionEvents=session.clip.events.some(e=>e.type==="macro"||e.type==="controlChange");
          const patch=originalTarget.modulation??(extensionEvents?emptyPatch(current.seed):undefined);
          const target={...originalTarget,...(patch?{modulation:{...patch,macros:runtimeMacrosRef.current[originalTarget.id]??patch.macros}}:{})};
          const clip=session.clip;
          const next={...current,assets:asset&&!current.assets.some(a=>a.id===asset!.id)?[...current.assets,asset]:current.assets,
            tracks:current.tracks.some(t=>t.id===target.id)?current.tracks.map(t=>t.id===target.id?{...target,clips:t.clips.some(c=>c.id===clip.id)?t.clips:[...t.clips,clip]}:t):[...current.tracks,{...target,clips:[clip]}]};
          const details=meta.current.get(current.id);
          const receipt=await preserveTake({owner:session.owner,document:next,revision:details?.revision??0,savedFingerprint:details?.fingerprint??"",updatedAt:new Date().toISOString()},
            {takeId:session.id,projectId:session.projectId,clipId:clip.id},asset?{owner:session.owner,projectId:session.projectId,asset,blob:session.result!.blob}:undefined);
          if(!receipt.already) commit(next,session.kind==="audio"?"Add audio take":"Record performance",true);
          noteDraftReceipt(next, session.owner, true);
          if(asset) setWaveforms(w=>({...w,[asset!.id]:session.result!.peaks}));
          setSelectedTrackId(target.id); setSelectedClipId(clip.id);
          clipsByTrack.current.set(target.id,clip.id);
          terminateDetailInputs();
          setDetailToolState("notes"); setClipEditorRequest(request=>request+1);
          notify("Take saved to this device. Cloud save follows when signed in.");
        }
        recorder.current?.acknowledge(); recorder.current?.dispose(); recorder.current=null; midiTake.current=null;
        takeSession.current=null; setRecording(false); setRecordingPhase("idle");
        if(session.reset) { audio?.stop(); heldInputs.current.clear(); syncHeld(); }
        else if(audio) await audio.seek(session.startTick+secondsToTick(session.endTime!-session.startTime,session.tempo));
        audio?.setLoop(loop,0,projectEnd(projectRef.current)); setBusy("");
      } catch(error) {
        phase(session,"recovery-error"); setBusy(""); report(error);
        setMessage("Take kept in memory — not saved to this device or cloud. Retry or download before closing.");
      } finally { finalizeJob.current=null; }
    })();
    finalizeJob.current=job; return job;
  }
  async function downloadRecording() {
    const session=takeSession.current; if(!session) return;
    let blob=session.result?.blob;
    if(!blob && session.kind==="audio") { session.result=await recorder.current!.encodeSealed(); blob=session.result.blob; }
    blob ??= new Blob([JSON.stringify(session.clip)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a"); a.href=url; a.download=session.kind==="audio"?"Unsaved take.wav":"Unsaved MIDI take.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const beginCapture=useEffectEvent(captureStarted);
  const endRecording = useEffectEvent(() => {
    void finishRecording();
  });
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const seconds = Math.max(
        0,
        (takeSession.current?.endTime ?? engineRef.current?.rawContext?.currentTime ?? 0) - recordingAt.current,
      );
      beginCapture();
      setRecordSeconds(seconds);
      if (
        takeSession.current?.phase === "capturing" && recordKind === "audio" &&
        seconds * (engineRef.current?.rawContext?.sampleRate ?? 48000) * 3 >
          99 * 1024 * 1024
      ) {
        endRecording();
        setMessage("The take reached the file limit. Preserving it now…");
      }
    }, 20);
    return () => clearInterval(timer);
  }, [recording, recordKind]);

  async function openProject(id: string) {
    if(!finishEdit())return;
    if (takeSession.current) return;
    setBusy("Opening song…");
    try {
      if (
        JSON.stringify(projectRef.current) !==
        (meta.current.get(projectRef.current.id)?.fingerprint ?? "")
      ) {
        const saved = await saveNow();
        if (user && !saved) {
          setBusy("");
          return;
        }
      }
      const cloud = await loadProject(id);
      loadDocument(cloud.document, cloud.revision);
      setLibraryOpen(false);
      notify("Song opened.");
    } catch (error) {
      report(error);
    } finally {
      setBusy("");
    }
  }
  async function newProject(demo = false) {
    if(!finishEdit())return;
    if (takeSession.current) return;
    const current = committedRef.current;
    const details = meta.current.get(current.id);
    await saveDraft({
      owner,
      document: current,
      revision: details?.revision ?? 0,
      savedFingerprint: details?.fingerprint ?? "",
      updatedAt: new Date().toISOString(),
    });
    if (user && JSON.stringify(current) !== details?.fingerprint) {
      const saved = await saveNow();
      if (!saved) return;
    }
    loadDocument(demo ? createDemo() : createProject());
    setMode("arrange");
    setLibraryOpen(false);
    notify(demo ? "Original demo opened." : "A blank song is ready.");
  }
  async function removeProject(id: string) {
    if(takeSession.current || importCount.current) return;
    try {
      await deleteCloudProject(id);
      await clearDraft(owner, id);
      if (projectRef.current.id === id) loadDocument(createProject());
      await refreshLibrary();
      notify("Project deleted.");
    } catch (error) {
      report(error);
    }
  }
  async function keepConflictCopy() {
    if (!conflict) return;
    const document = {
      ...conflict.incoming,
      id: conflict.recoveryId ?? uid(),
      title: conflict.incoming.title.slice(0, 178) + " · recovered copy",
    };
    if (!loadDocument(document, 0, "", "discard")) return;
    const saved = await saveNow(document);
    if (saved)
      notify(
        "Your edit was saved as a separate song. The other device version remains available.",
      );
  }
  function useCloudConflict() {
    if (!conflict) return;
    if (!loadDocument(conflict.current.document, conflict.current.revision,
      JSON.stringify(conflict.current.document), "discard")) return;
    notify(
      "Cloud version loaded. Your other edit is kept in recovery versions.",
    );
  }
  async function hydrateWaveform(id: string) {
    if (waveforms[id]) return;
    try {
      const audio = await getEngine();
      const decoded = await audio.decode(await resolveAsset(owner, id));
      const peaks = await getProcessor().peaks(decoded);
      setWaveforms((w) => ({ ...w, [id]: peaks }));
    } catch (error) {
      report(error);
    }
  }

  const library=useReusableLibrary({owner,project,hydrated:hydrated&&readyViewScope===viewScope,
    document:()=>committedRef.current,currentOwner:()=>ownerRef.current,
    destination:()=>({trackId:selectedTrackRef.current?.id??"",sectionId:selectedSectionId,clipId:selectedClipId}),
    revisions:libraryRevisions,finishEdit,hasDraft:()=>!!activeEdit.current||!!activeGesture.current,recording:()=>!!takeSession.current,
    commit,select:(trackId,clipId)=>{if(clipId)selectClip(trackId,clipId);else selectTrack(trackId);},getEngine,notify});
  useLayoutEffect(()=>{cancelLibraryOperationRef.current=library.cancelLibraryOperation;cancelLibraryPreviewRef.current=library.cancelLibraryPreview;},[library]);
  return {
    ...library,
    automationLane:automationFocus.scope===JSON.stringify([owner,project.id])?automationFocus.parameter:"volume" as AutomationParameter,
    setAutomationLane,openAutomation,
    user,
    owner,
    signIn,
    project,
    projectRef,committedRef,ownerRef,
    history,
    transaction,ownsEdit,beginEdit,finishEdit,cancelEdit,invalidateEdit,beginGesture,ownsGesture,gestureParent,finishGesture,cancelGesture,invalidateGesture,assignModulation,editConflict,reapplyEdit,discardEdit:()=>setEditConflict(null),registerInteraction,
    applyChord,selectedChordId,setSelectedChordId,
    dispatch: changeHistory as React.Dispatch<HistoryAction>,
    mode,
    setMode,
    detailTool,
    setDetailTool,
    songViewport,
    setSongViewport,
    songViewportReady:hydrated&&readyViewScope===viewScope,
    clipEditorRequest,
    viewPreferenceError:viewPreferenceFailure.key===viewKey?viewPreferenceFailure.message:"",
    selectedTrack,
    selectedTrackId,
    selectedSection,
    selectedSectionId,
    selectedClip,
    selectedClipId,
    setSelectedSectionId,
    selectTrack,
    selectClip,
    setSelectedClipId,
    selectedNotes,
    setSelectedNotes,
    heldNotes,
    latch,
    setLatch,
    octave,
    setOctave,
    libraryOpen,
    setLibraryOpen,
    exportOpen,
    setExportOpen,
    deviceOpen,
    setDeviceOpen,
    projects,
    saveStatus,
    deviceDraftStatus: draftReceipt?.owner === owner && draftReceipt.projectId === project.id && draftReceipt.fingerprint === deviceDraftFingerprint ? draftReceipt.saved ? "Device draft saved" : "Device draft unavailable" : "Device draft pending",
    retryDeviceDraft,
    message,
    error:errorScope.mode===mode&&errorScope.projectId===project.id?error:"",
    busy,
    setBusy,
    ready,
    hydrated:hydrated&&readyViewScope===viewScope,
    engine,
    getEngine,
    getProcessor,
    isPlaying,
    loop,
    setLoop,
    metronome,
    setMetronome,
    recordKind,
    setRecordKind,
    recordCountIn,setRecordCountIn,recordingDestination,setRecordingDestination,recordingTargetName,recordingDestinationMissing,recordingInput,checkRecordingInput,
    recording,
    recordingPhase,
    retryRecording,
    downloadRecording,
    recordSeconds,
    monitor,
    setMonitor,
    microphoneId,
    setMicrophoneId,
    microphones,
    midiInputs,
    midiInputId,
    setMidiInputId,
    midiEnabled,
    enableMidi,
    refreshDevices,
    recorder,
    waveforms,
    hydrateWaveform,
    conflict,
    keepConflictCopy,
    useCloudConflict,
    commit,
    edit,
    updateTrack,
    updateClip,
    insertClip,
    addTrack,
    loadDocument,
    notify,
    report,
    play,
    stop,
    seek,
    audition,
    previewPhrase,
    previewTake,
    cancelPreview,
    writingActions,
    registerWritingActions,
    releaseSource,releaseHeld,
    noteOn,
    noteOff,
    expression,
    performMacro,performanceMacros:runtimeMacros[selectedTrack?.id??""]??selectedTrack?.modulation?.macros??([0,0,0,0] as [number,number,number,number]),
    beginMidiLearn,cancelMidiLearn,midiLearning,
    beginRecording,
    finishRecording,
    addAudio,
    saveNow,
    refreshLibrary,
    openProject,
    newProject,
    removeProject,
  };
}
type StudioController = ReturnType<typeof useStudioController>;
const StudioContext = createContext<StudioController | null>(null);
export function StudioProvider({
  children,
  initialProject,
  user,
}: {
  children: ReactNode;
  initialProject: ProjectDocument;
  user: StudioUser;
}) {
  const value = useStudioController(initialProject, user);
  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}
export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("Studio controls require a studio provider.");
  return context;
}
export function useTransport(active=true) {
  const { engine } = useStudio();
  const toolActive=useToolVisibility(), visible=active&&toolActive;
  const [state, setState] = useState<TransportState>({
    playing: false,
    tick: 0,
    countIn: false,
    loading: false,
    activity: "idle",
    previewId: null,
  });
  useEffect(() => {
    if (!engine || !visible) return;
    let last = 0;
    let previous = engine.state;
    return engine.subscribe((next) => {
      const now = performance.now();
      if (
        now - last > 80 ||
        next.playing !== previous.playing ||
        next.loading !== previous.loading || next.activity!==previous.activity || next.previewId!==previous.previewId
      ) {
        last = now;
        previous = next;
        setState(next);
      }
    });
  }, [engine,visible]);
  return state;
}
