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
import { applyPreview, previewEdit, commitTransaction, rebaseTransaction, type EditTransaction } from "../../lib/music/transactions";
import { chordCommand, type ChordCommand } from "../../lib/music/chord-commands";
import {
  createDemo,
  createProject,
  createTrack,
  emptyClip,
  projectEnd,
  secondsToTick,
  TRACK_COLORS,
} from "../../lib/music/project";
import {
  uid,
  type AssetReference,
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

export type StudioMode = "write" | "arrange" | "sound" | "mix";
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
  const [editConflict,setEditConflict]=useState<EditTransaction|null>(null);
  const project=useMemo(()=>applyPreview(history.present,transaction),[history.present,transaction]),projectRef=useRef(project);
  const [selectedChordId,setSelectedChordId]=useState("");
  const selectionHistory=useRef(new WeakMap<ProjectDocument,string>());
  const [mode, setModeState] = useState<StudioMode>("write");
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
  const audioIntent = useRef(0);
  const pendingPreview=useRef<{identity:string;token:number}|null>(null);
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
  const [recording, setRecording] = useState(false);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");
  const takeSession = useRef<TakeSession | null>(null);
  const finalizeJob = useRef<Promise<void> | null>(null);
  const importCount = useRef(0);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [monitor, setMonitorState] = useState(false);
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

  useLayoutEffect(() => {
    projectRef.current = project;
    ownerRef.current = owner;
    selectedTrackRef.current = selectedTrack;
    conflictRef.current = conflict;
    midiInputRef.current = midiInputId;
    if(selectedClipId&&selectedTrack?.clips.some(c=>c.id===selectedClipId))clipsByTrack.current.set(selectedTrack.id,selectedClipId);
  }, [project, owner, selectedTrack, selectedClipId, conflict, midiInputId]);
  const viewLoaded=useRef("");
  useEffect(()=>{if(!hydrated)return;let active=true;const id=project.id;queueMicrotask(()=>{if(!active)return;try{const view=JSON.parse(localStorage.getItem("chordz-view-v1:"+id)??"null");if(view?.version===1){if(["write","arrange","sound","mix"].includes(view.mode))setModeState(view.mode);if(project.tracks.some(t=>t.id===view.track))setSelectedTrackId(view.track);if(project.sections.some(sec=>sec.id===view.section))setSectionState(view.section);if(project.chords.some(c=>c.id===view.chord))setSelectedChordId(view.chord);if(view.clips&&typeof view.clips==="object")for(const t of project.tracks){const clip=view.clips[t.id];if(t.clips.some(c=>c.id===clip))clipsByTrack.current.set(t.id,clip);}setSelectedClipId(clipsByTrack.current.get(view.track)??"");}}catch{}viewLoaded.current=id;});return()=>{active=false;};
    // Restore once per document; editing does not reread old selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[project.id,hydrated]);
  useEffect(()=>{if(viewLoaded.current!==project.id)return;try{localStorage.setItem("chordz-view-v1:"+project.id,JSON.stringify({version:1,mode,track:selectedTrackId,section:selectedSectionId,chord:selectedChordId,clips:Object.fromEntries(clipsByTrack.current)}));}catch{}},[project.id,mode,selectedTrackId,selectedSectionId,selectedChordId,selectedClipId]);
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
    activeEdit.current=next;setTransaction(next);projectRef.current=applyPreview(committedRef.current,next);
  }
  function beginEdit(owner:string){
    if(fieldOwner.current===owner&&activeEdit.current)return true;
    if(!finishEdit())return false;
    fieldOwner.current=owner;renderEdit({owner,projectId:committedRef.current.id,label:"Edit",patches:[],invalid:null});return true;
  }
  function ownsEdit(owner:string){return activeEdit.current?.owner===owner;}
  function invalidateEdit(invalid:string|null,owner?:string){if(activeEdit.current&&(!owner||ownsEdit(owner)))renderEdit({...activeEdit.current,invalid});}
  function cancelEdit(owner?:string){if(owner&&!ownsEdit(owner))return false;if(!activeEdit.current)return false;fieldOwner.current="";renderEdit(null);return true;}
  function finishEdit(owner?:string){
    if(owner&&!ownsEdit(owner))return true;
    const tx=activeEdit.current;if(!tx)return true;
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
  function setMode(value:StudioMode){if(finishEdit()){setModeState(value);setMessage("");}}
  function setSelectedSectionId(value:string){if(finishEdit())setSectionState(value);}
  function commit(next: ProjectDocument, label: string, takeCommit=false) {
    if (takeSession.current?.phase === "finalizing" && !takeCommit) { setError("Wait for your take to finish saving before editing."); return false; }
    const current=committedRef.current;
    if(!projectSchema.safeParse(next).success){setError("The proposed edit is outside the supported project limits.");return false;}
    if(takeSession.current && !takeCommit && (JSON.stringify(next.tracks)!==JSON.stringify(current.tracks) || JSON.stringify(next.master)!==JSON.stringify(current.master) || next.tempo!==current.tempo || JSON.stringify(next.timeSignature)!==JSON.stringify(current.timeSignature))) { setError("Finish recording before changing playback or instruments."); return false; }
    if(JSON.stringify(next)===JSON.stringify(current))return true;
    selectionHistory.current.set(current,selectedChordId);
    committedRef.current=next;projectRef.current=applyPreview(next,activeEdit.current);
    setSaveStatus(user ? "Device draft · saving…" : "Device draft");
    dispatch({ type: "commit", project: next, label });return true;
  }
  function changeHistory(action: HistoryAction) {
    if(takeSession.current) return;
    if((action.type==="undo"||action.type==="redo")&&cancelInteraction.current?.())return;
    if(activeEdit.current){cancelEdit();return;}
    const next=historyReducer({...history,present:committedRef.current},action);
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
  function selectTrack(id: string) {
    if(!finishEdit())return;
    if(id!==selectedTrackId)setSelectedClipId(clipsByTrack.current.get(id)??"");
    setSelectedTrackId(id);
  }
  function selectClip(trackId: string, clipId: string) {
    if(!finishEdit())return;
    setSelectedTrackId(trackId);
    setSelectedClipId(clipId);
    setMode("arrange");
  }
  function insertClip(trackId:string,clip:Clip,label="Insert phrase"){
    if(takeSession.current){report(new Error("Finish recording before inserting another phrase."));return false;}
    if(!finishEdit())return false;
    const doc=committedRef.current;if(!doc.tracks.some(t=>t.id===trackId))return false;
    if(!commit({...doc,tracks:doc.tracks.map(t=>t.id===trackId?{...t,clips:[...t.clips,clip]}:t)},label))return false;
    setSelectedTrackId(trackId);setSelectedClipId(clip.id);return true;
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
    if (takeSession.current || importCount.current) { report(new Error("Finish recording or importing before opening another song.")); return false; }
    if(editPolicy === "discard") { cancelEdit(); setError(""); }
    else if(!finishEdit())return false;
    setEditConflict(null);
    const sameProject=committedRef.current.id===document.id;
    const trackId=sameProject&&document.tracks.some(t=>t.id===selectedTrackId)?selectedTrackId:document.tracks[0]?.id??"";
    const sectionId=sameProject&&document.sections.some(sec=>sec.id===selectedSectionId)?selectedSectionId:document.sections[1]?.id??document.sections[0].id;
    const chordId=sameProject&&document.chords.some(c=>c.id===selectedChordId)?selectedChordId:"";
    const clipId=sameProject&&document.tracks.find(t=>t.id===trackId)?.clips.some(c=>c.id===selectedClipId)?selectedClipId:"";
    committedRef.current=document;setSelectedChordId(chordId);
    pendingPreview.current=null;++audioIntent.current; heldInputs.current.clear(); controlTargets.current.clear(); controllerStates.current.clear(); syncHeld();
    engineRef.current?.stop();
    projectRef.current = document;
    dispatch({ type: "load", project: document });
    meta.current.set(document.id, { revision, fingerprint });
    setSelectedTrackId(trackId);
    setSelectedSectionId(sectionId);
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
        await saveDraft({
          owner,
          document:
            projectRef.current.id === snapshot.id
              ? projectRef.current
              : snapshot,
          revision: result.revision,
          savedFingerprint: fingerprint,
          updatedAt: new Date().toISOString(),
        });
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
          effectNotify("Your latest device draft has been restored.");
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
    const timer = setTimeout(() => {
      if (takeSession.current?.phase === "finalizing" || !projectSchema.safeParse(project).success) return;
      const details = meta.current.get(project.id) ?? {
        revision: 0,
        fingerprint: "",
      };
      void saveDraft({
        owner,
        document: project,
        revision: details.revision,
        savedFingerprint: details.fingerprint,
        updatedAt: new Date().toISOString(),
      }).catch(effectReport);
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
    if(projectSchema.safeParse(project).success)engineRef.current?.updateProject(project);
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
  function cancelPreview() { pendingPreview.current=null;++audioIntent.current; engineRef.current?.cancelAudition(); }
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
      for(const [id,input] of heldInputs.current) if(input.trackId===take.trackId) take.open.set(id,{id:uid(),pitch:input.pitch,tick:0,velocity:input.velocity});
      const values=new Map<PerformanceEvent["type"],number>();
      for(const {trackId,event} of controllerStates.current.values()) if(trackId===take.trackId) values.set(event.type,event.type==="sustain"?Math.max(values.get(event.type)??0,event.value):event.value);
      take.events.push(...[...values].map(([type,value])=>({type,value,tick:0})));
    }
  }
  function takeTick() {
    const session = takeSession.current;
    return session ? secondsToTick(Math.max(0,(engineRef.current?.rawContext?.currentTime ?? 0)-session.startTime),session.tempo) : 0;
  }
  async function noteOn(pitch: number, velocity = 0.75, inputId = "pointer:" + pitch) {
    captureStarted();
    const session = takeSession.current;
    const track = session?.kind === "midi" ? projectRef.current.tracks.find(t=>t.id===session.trackId) : selectedTrackRef.current;
    if (!track || track.kind === "audio") return;
    if (heldInputs.current.has(inputId)) noteOff(pitch,inputId);
    const input = { trackId: track.id,pitch,velocity }; heldInputs.current.set(inputId,input); syncHeld();
    if (latch) setSelectedNotes(notes=>notes.includes(pitch)?notes:[...notes,pitch]);
    const take = midiTake.current;
    if(take && session?.phase === "capturing" && take.trackId===track.id) take.open.set(inputId,{ id:uid(),pitch,tick:takeTick(),velocity });
    try { const audio = await getEngine(); if(heldInputs.current.get(inputId)!==input) return;
      await audio.noteOn(track.id,pitch,velocity,inputId);

    } catch(error) { if(heldInputs.current.get(inputId)===input) { heldInputs.current.delete(inputId); syncHeld(); } report(error); }
  }
  function noteOff(pitch: number, inputId = "pointer:" + pitch) {
    captureStarted();
    const input = heldInputs.current.get(inputId); heldInputs.current.delete(inputId); syncHeld();
    if(input) engineRef.current?.noteOff(input.trackId,input.pitch,inputId);
    const take=midiTake.current, open=take?.open.get(inputId);
    if(take && open) { const end=takeTick();
      if(end>open.tick) take.notes.push({id:open.id,pitch:open.pitch,tick:Math.round(open.tick),duration:Math.max(1,Math.round(end-open.tick)),velocity:open.velocity});
      take.open.delete(inputId);
    }
  }
  function releaseHeld(prefix:string){for(const [id,input]of heldInputs.current)if(id.startsWith(prefix))noteOff(input.pitch,id);}
  function releaseSource(prefix: string) {
    for(const [source] of controlTargets.current) if(source.startsWith(prefix.replace(/:$/, ""))) { expression("sustain",0,source); controlTargets.current.delete(source); }
    for(const key of controllerStates.current.keys()) if(key.startsWith(prefix.replace(/:$/, ""))) controllerStates.current.delete(key);
    for(const [id,input] of heldInputs.current) if(id.startsWith(prefix)) noteOff(input.pitch,id);
    engineRef.current?.releaseSource(prefix);
  }
  const controlTargets = useRef(new Map<string,string>());
  const controllerStates = useRef(new Map<string,{trackId:string;event:PerformanceEvent}>());
  function expression(type: PerformanceEvent["type"], value: number, source="performance") {
    captureStarted();
    const session=takeSession.current;
    const heldTrack=[...heldInputs.current].find(([id])=>id.startsWith(source+":"))?.[1].trackId;
    const target=controlTargets.current.get(source) ?? heldTrack ?? (session?.kind==="midi"?session.trackId:selectedTrackRef.current?.id);
    if(!target) return; if((type==="sustain" && value>=0.5)||heldTrack) controlTargets.current.set(source,target);
    const event={tick:0,type,value}; controllerStates.current.set(source+":"+type,{trackId:target,event}); engineRef.current?.expression(target,event,undefined,false,source);
    const take=midiTake.current;
    if(take && session?.phase==="capturing" && target===take.trackId) take.events.push({...event,tick:Math.round(takeTick())});
    if(type==="sustain" && value<0.5) controlTargets.current.delete(source);
  }
  useEffect(() => {
    if(midiInputId!=="all") for(const [id,input] of heldInputs.current) if(id.startsWith("midi:") && !id.startsWith("midi:"+midiInputId+":")) { inputHandlers.current.noteOff(input.pitch,id); engineRef.current?.releaseSource(id.slice(0,id.lastIndexOf(":"))); }
  },[midiInputId]);
  const inputHandlers = useRef({ noteOn, noteOff, expression, releaseSource });
  useLayoutEffect(() => {
    inputHandlers.current = { noteOn, noteOff, expression, releaseSource };
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
    setMonitorState(value);
    recorder.current?.setMonitoring(value);
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
      commit(
        { ...current, assets: [...current.assets, asset], tracks },
        "Add audio take",
      );
      if(!activeEdit.current){setSelectedTrackId(track.id);setSelectedClipId(clip.id);setMode("arrange");}
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
    if(transportJob.current) return;
    if(importCount.current) { report(new Error("Wait for the audio import to finish before recording.")); return; }
    const doc=projectRef.current, target=selectedTrackRef.current;
    if(recordKind==="midi" && target?.kind!=="instrument") { report(new Error("Select an instrument track to record MIDI.")); return; }
    const newTrack=recordKind==="audio" && target?.kind!=="audio" ? createTrack("piano","Microphone",TRACK_COLORS[doc.tracks.length%8],"audio") : null;
    if(newTrack && doc.tracks.length>=64) { report(new Error("This project already has 64 tracks.")); return; }
    const session: TakeSession={id:uid(),owner,projectId:doc.id,trackId:newTrack?.id??target!.id,startTick:engineRef.current?.state.tick??0,tempo:doc.tempo,
      kind:recordKind,phase:"preparing",startTime:Infinity,reset:false,clipId:uid(),assetId:uid(),newTrack};
    takeSession.current=session; phase(session,"preparing"); cancelPreview();
    try {
      const audio=await getEngine(); if(takeSession.current!==session) return;
      audio.setLoop(false); audio.setMetronome(metronome);
      if(session.kind==="audio") {
        const mic=new MicrophoneRecorder(); recorder.current=mic;
        await mic.prepare(await audio.unlock(),microphoneId||undefined,audio.monitorDestination!);
        if(takeSession.current!==session) { mic.dispose(); return; }
        mic.setMonitoring(monitor);
      }
      await audio.play(session.startTick,1);
      if(takeSession.current!==session) return;
      session.startTime=audio.recordingStartTime;
      recordingAt.current=session.startTime; recordingTick.current=session.startTick;
      if(session.kind==="audio") recorder.current!.start(session.startTime,audio.rawContext!);
      else midiTake.current={trackId:session.trackId,startTick:session.startTick,open:new Map(),notes:[],events:[]};
      phase(session,"count-in"); setRecordSeconds(0); notify("One bar count-in, then recording.");
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
      takeSession.current=null; recorder.current?.dispose(); recorder.current=null; midiTake.current=null;
      audio?.stop(); heldInputs.current.clear(); syncHeld(); setRecording(false); setRecordingPhase("idle"); setBusy("");
      notify("Recording cancelled before capture."); return Promise.resolve();
    }
    if(session.endTime===undefined) {
      session.endTime=now;
      const take=midiTake.current;
      if(take) {
        const end=secondsToTick(now-session.startTime,session.tempo);
        for(const open of take.open.values()) if(end>open.tick) take.notes.push({id:open.id,pitch:open.pitch,tick:Math.round(open.tick),duration:Math.max(1,Math.round(end-open.tick)),velocity:open.velocity});
        take.open.clear();
        session.clip={...emptyClip(session.startTick,Math.max(1,end),"MIDI take"),id:session.clipId,notes:take.notes,events:take.events};
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
          const target=current.tracks.find(t=>t.id===session.trackId)??session.newTrack;
          if(!target) throw new Error("The recording destination is missing.");
          const clip=session.clip;
          const next={...current,assets:asset&&!current.assets.some(a=>a.id===asset!.id)?[...current.assets,asset]:current.assets,
            tracks:current.tracks.some(t=>t.id===target.id)?current.tracks.map(t=>t.id===target.id?{...t,clips:t.clips.some(c=>c.id===clip.id)?t.clips:[...t.clips,clip]}:t):[...current.tracks,{...target,clips:[clip]}]};
          const details=meta.current.get(current.id);
          const receipt=await preserveTake({owner:session.owner,document:next,revision:details?.revision??0,savedFingerprint:details?.fingerprint??"",updatedAt:new Date().toISOString()},
            {takeId:session.id,projectId:session.projectId,clipId:clip.id},asset?{owner:session.owner,projectId:session.projectId,asset,blob:session.result!.blob}:undefined);
          if(!receipt.already) commit(next,session.kind==="audio"?"Add audio take":"Record performance",true);
          if(asset) setWaveforms(w=>({...w,[asset!.id]:session.result!.peaks}));
          setSelectedTrackId(target.id); setSelectedClipId(clip.id);
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
    setMode("write");
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

  return {
    user,
    owner,
    signIn,
    project,
    projectRef,committedRef,
    history,
    transaction,ownsEdit,beginEdit,finishEdit,cancelEdit,invalidateEdit,editConflict,reapplyEdit,discardEdit:()=>setEditConflict(null),registerInteraction,
    applyChord,selectedChordId,setSelectedChordId,
    dispatch: changeHistory as React.Dispatch<HistoryAction>,
    mode,
    setMode,
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
    message,
    error:errorScope.mode===mode&&errorScope.projectId===project.id?error:"",
    busy,
    setBusy,
    ready,
    hydrated,
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
    cancelPreview,
    writingActions,
    registerWritingActions,
    releaseSource,releaseHeld,
    noteOn,
    noteOff,
    expression,
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
export function useTransport() {
  const { engine } = useStudio();
  const [state, setState] = useState<TransportState>({
    playing: false,
    tick: 0,
    countIn: false,
    loading: false,
    activity: "idle",
    previewId: null,
  });
  useEffect(() => {
    if (!engine) return;
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
  }, [engine]);
  return state;
}
