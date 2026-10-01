"use client";
import {DraftInput} from "./draft-field";
import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Download,
  Plus,
  Trash2,
  History,
  Music2,
} from "lucide-react";
import { useStudio } from "./use-studio";
import { encodeMp3Buffer } from "../../lib/audio/mp3-client";
import { Modal, IconButton } from "./primitives";
import {
  downloadBlob,
  exportMidi,
  projectBackup,
  restoreBackup,
  safeFilename,
  zipFiles,
  type ExportFormat,
} from "../../lib/audio/export";
import {acquireExportWriter,checkExportActive,exportRange,waitForExport} from "../../lib/audio/export-range";
import {
  keepPendingAsset,
  resolveAsset,
  listDrafts,
  type RecoveryDraft,
} from "../../lib/client/storage";
import { loadVersions } from "../../lib/client/cloud";
import { uid, type ProjectDocument } from "../../lib/music/types";
import "./export-dialog.css";
type DirectoryHandle = {
  getDirectoryHandle: (
    name: string,
    options: { create: boolean },
  ) => Promise<DirectoryHandle>;
  getFileHandle: (
    name: string,
    options: { create: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      write: (blob: Blob) => Promise<void>;
      close: () => Promise<void>;
      abort:()=>Promise<void>;
    }>;
  }>;
};
export function StudioDialogs() {
  const s = useStudio();
  const [deleting, setDeleting] = useState(""),
    [format, setFormat] = useState<ExportFormat>("wav"),
    [stem, setStem] = useState("all"),
    [scope,setScope]=useState<"song"|"section">("song"),
    [includeTails,setIncludeTails]=useState(true),
    [destination,setDestination]=useState<"download"|"folder">("download"),
    [exporting,setExporting]=useState(false),
    [progress, setProgress] = useState(""),
    [versions, setVersions] = useState<
      {
        id: string;
        document: ProjectDocument;
        kind: string;
        createdAt: string;
      }[]
    >([]),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [drafts, setDrafts] = useState<RecoveryDraft[]>([]);
  const exportJob=useRef<{controller:AbortController;owner:string;projectId:string}|null>(null);
  useEffect(()=>()=>{exportJob.current?.controller.abort();},[]);
  useEffect(()=>{
    const job=exportJob.current;
    if(job&&(job.owner!==s.owner||job.projectId!==s.project.id))job.controller.abort();
  },[s.owner,s.project.id]);
  function cancelExport(){exportJob.current?.controller.abort();}
  async function runExport() {
    if(exportJob.current||s.busy)return;
    if(s.recordingPhase!=="idle"){s.report(new Error("Finish or preserve your recording before exporting."));return;}
    if(!s.finishEdit())return;
    // Settle edits, then capture the committed song and every choice before a picker or loader.
    const project=structuredClone(s.committedRef.current),owner=s.owner,
      chosen={format,stem,scope,includeTails,destination,sectionId:s.selectedSectionId},
      job={controller:new AbortController(),owner,projectId:project.id};
    exportJob.current=job;setExporting(true);s.setBusy("Exporting…");setProgress("Preparing export…");
    const active=()=>{
      checkExportActive(job.controller.signal);
      if(exportJob.current!==job||s.ownerRef.current!==owner||s.projectRef.current.id!==project.id)
        throw new DOMException("Export cancelled because the song or account changed.","AbortError");
    };
    const wait=<T,>(promise:Promise<T>)=>waitForExport(promise,job.controller.signal);
    const progress=(text:string)=>{active();setProgress(text);};
    let directory: DirectoryHandle | undefined;
    try {
      const audio=chosen.format==="wav"||chosen.format==="mp3"||chosen.format==="stems",
        range=audio&&chosen.scope==="section"?exportRange(project,chosen.sectionId):undefined,
        section=range?project.sections.find(section=>section.id===chosen.sectionId):undefined,
        name=safeFilename(project.title)+(section?" · "+safeFilename(section.name):"");
      if (chosen.destination === "folder") {
        const picker = (
          window as unknown as {
            showDirectoryPicker?: (options: {
              mode: string;
            }) => Promise<DirectoryHandle>;
          }
        ).showDirectoryPicker;
        if (!picker)
          throw new Error(
            "Folder access is unavailable in this browser. Choose Browser download.",
          );
        directory = await wait(picker({ mode: "readwrite" }));active();
        directory = await wait(directory.getDirectoryHandle(
          name + " " + Date.now(),
          { create: true },
        ));active();
      }
      const save=async(blob:Blob,filename:string)=>{
        active();
        if(directory){
          const handle=await wait(directory.getFileHandle(filename,{create:true}));active();
          const writer=await acquireExportWriter(handle.createWritable(),job.controller.signal);
          try{active();await wait(writer.write(blob));active();await wait(writer.close());}
          catch(error){void writer.abort().catch(()=>{});throw error;}
        }else downloadBlob(blob,filename);
      };
      if (chosen.format === "midi") {
        await save(
          new Blob([exportMidi(project) as BlobPart], { type: "audio/midi" }),
          name + ".mid",
        );
      } else if (chosen.format === "backup") {
        progress("Packing your song and private audio…");
        await save(
          new Blob(
            [
              (await wait(projectBackup(project, (id) =>{active();return resolveAsset(owner,id);}))) as BlobPart,
            ],
            { type: "application/zip" },
          ),
          name + ".chordz.zip",
        );
      } else {
        const engine = await wait(s.getEngine());active();
        const options={range,includeTails:chosen.includeTails,signal:job.controller.signal};
        if (chosen.format === "stems") {
          const unmuted = {
            ...project,
            tracks: project.tracks.map((t) => ({
              ...t,
              mute: false,
              solo: false,
            })),
          };
          const tracks =
            chosen.stem === "all"
              ? unmuted.tracks
              : unmuted.tracks.filter((t) => t.id === chosen.stem);
          if(!tracks.length)throw new Error("Choose an available stem track.");
          const files:Record<string,Uint8Array>={};let total=0;
          for (let i = 0; i < tracks.length; i++) {
            progress(
              `Rendering ${i + 1} / ${tracks.length} · ${tracks[i].name}`,
            );
            const buffer = await wait(engine.render(unmuted, tracks[i].id,undefined,options));active();
            const blob = await wait(s.getProcessor().encode(buffer, 24));active();
            const filename = `${String(i + 1).padStart(2, "0")} ${safeFilename(tracks[i].name)}.wav`;
            if(!directory&&chosen.stem==="all"){
              total+=blob.size;
              if(total>512*1024*1024)throw new Error("These stems exceed the 512 MB ZIP limit. Choose a folder or export one track at a time.");
              files[filename]=new Uint8Array(await wait(blob.arrayBuffer()));active();
            }else await save(blob,directory?filename:name+" "+filename);
          }
          if(!directory&&chosen.stem==="all"){
            progress("Packing stems…");
            await save(new Blob([await wait(zipFiles(files)) as BlobPart],{type:"application/zip"}),name+".stems.zip");
          }
        } else {
          progress("Rendering "+(section?section.name:"full song")+(chosen.includeTails?" with effect tails…":" to the musical boundary…"));
          const buffer = await wait(engine.render(project,undefined,undefined,options));active();
          await save(
            chosen.format === "mp3"
              ? await wait(encodeMp3Buffer(buffer, (percent) =>{if(!job.controller.signal.aborted&&exportJob.current===job)setProgress(`Encoding MP3 · ${percent}%`);},job.controller.signal))
              : await wait(s.getProcessor().encode(buffer, 24)),
            name + (chosen.format === "mp3" ? ".mp3" : ".wav"),
          );
        }
      }
      active();
      s.notify("Export complete.");
      setProgress("Export complete.");
    } catch (error) {
      if(exportJob.current===job){
        if(error instanceof DOMException&&error.name==="AbortError")setProgress("Export cancelled. Completed folder files are kept.");
        else {setProgress("");s.report(error);}
      }
    } finally {
      if(exportJob.current===job){exportJob.current=null;setExporting(false);s.setBusy("");}
    }
  }
  async function restore(file: File) {
    try {
      s.setBusy("Restoring backup…");
      const { document, assets } = restoreBackup(
        new Uint8Array(await file.arrayBuffer()),
      );
      const ids = new Map(document.assets.map((a) => [a.id, uid()]));
      const restored: ProjectDocument = {
        ...document,
        id: uid(),
        title: document.title.slice(0, 187) + " · restored",
        assets: document.assets.map((a) => ({ ...a, id: ids.get(a.id)! })),
        tracks: document.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({
            ...c,
            audio: c.audio
              ? { ...c.audio, assetId: ids.get(c.audio.assetId)! }
              : undefined,
          })),
        })),
        userInstruments: document.userInstruments.map((i) => ({
          ...i,
          zones: i.zones.map((z) => ({
            ...z,
            assetId: z.assetId ? ids.get(z.assetId) : undefined,
          })),
        })),
      };
      for (const old of document.assets) {
        const asset = restored.assets.find((a) => a.id === ids.get(old.id))!;
        await keepPendingAsset({
          owner: s.owner,
          projectId: restored.id,
          asset,
          blob: new Blob([assets.get(old.id)! as BlobPart], { type: old.mime }),
        });
      }
      s.loadDocument(restored, 0, "");
      s.setLibraryOpen(false);
      s.notify("Backup restored as a new song.");
    } catch (error) {
      s.report(error);
    } finally {
      s.setBusy("");
    }
  }
  return (
    <>
      <Modal
        open={s.libraryOpen}
        onClose={() => s.setLibraryOpen(false)}
        title="Your songs"
        description={
          s.user
            ? "Private projects, available wherever you sign in."
            : "Sign in with ChatGPT for private cloud projects."
        }
        wide
      >
        {s.error && (
          <p className="studio-notice error" role="alert">
            {s.error}
          </p>
        )}
        <div className="library-actions">
          <button
            className="primary-button"
            onClick={() => void s.newProject(false)}
          >
            <Plus size={16} />
            Blank song
          </button>
          <button
            className="secondary-button"
            onClick={() => void s.newProject(true)}
          >
            <Music2 size={16} />
            Original demo
          </button>
          <label className="secondary-button file-button">
            Restore backup
            <DraftInput
              type="file"
              accept=".zip,.chordz"
              onChange={(e) => {
                if (e.target.files?.[0]) void restore(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          {s.user ? (
            <button
              className="text-button"
              data-edit-policy="bypass"
              onClick={async () => {
                try {
                  setDrafts(await listDrafts(s.owner));
                  setVersions(
                    s.saveStatus.includes("Demo")
                      ? []
                      : await loadVersions(s.project.id).catch(() => []),
                  );
                  setRecoveryOpen(true);
                } catch (error) {
                  s.report(error);
                }
              }}
            >
              <History size={15} />
              Recovery versions
            </button>
          ) : (
            <a
              className="primary-button"
              href="/signin-with-chatgpt?return_to=/"
              onClick={(e) => {
                e.preventDefault();
                void s.signIn().catch(s.report);
              }}
            >
              Sign in with ChatGPT
            </a>
          )}
        </div>
        <div className="project-library">
          {s.projects.map((project) => (
            <div className="library-project" key={project.id}>
              <FolderOpen size={22} />
              <button onClick={() => void s.openProject(project.id)}>
                <strong>{project.title}</strong>
                <span>
                  {project.key} {project.mode} · {project.tempo} BPM ·{" "}
                  {project.trackCount} tracks
                </span>
                <small>{new Date(project.updatedAt).toLocaleString()}</small>
              </button>
              {deleting === project.id ? (
                <div className="button-row">
                  <button
                    className="danger-button"
                    onClick={() => {
                      void s.removeProject(project.id);
                      setDeleting("");
                    }}
                  >
                    Delete song
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setDeleting("")}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <IconButton
                  label={"Delete " + project.title}
                  onClick={() => setDeleting(project.id)}
                >
                  <Trash2 size={16} />
                </IconButton>
              )}
            </div>
          ))}
          {!s.projects.length && (
            <div className="empty-state">
              Your saved songs will appear here. Explore the current demo or
              begin a blank song.
            </div>
          )}
        </div>
      </Modal>
      <Modal
        open={s.exportOpen}
        onClose={() => {
          if (!s.busy) s.setExportOpen(false);
        }}
        title="Take your music with you"
        description="The same instruments and effects render playback and your export."
        className="studio-export-dialog"
      >
        {s.error && (
          <p className="studio-notice error" role="alert">
            {s.error}
          </p>
        )}
        <label className="field">
          Export format
          <select
            aria-label="Export format"
            value={format}
            onChange={(e) => {
              const value = e.target.value;
              if (
                value === "wav" ||
                value === "mp3" ||
                value === "stems" ||
                value === "midi" ||
                value === "backup"
              )
                setFormat(value);
            }}
            disabled={!!s.busy}
          >
            <option value="wav">Stereo WAV · 48 kHz / 24-bit</option>
            <option value="mp3">Stereo MP3 · 48 kHz / 320 kbps</option>
            <option value="stems">Individual track stems · WAV</option>
            <option value="midi">MIDI · notes & expression</option>
            <option value="backup">
              Portable project · includes user audio
            </option>
          </select>
        </label>
        {(format==="wav"||format==="mp3"||format==="stems")&&<>
          <label className="field">Export range<select aria-label="Export range" value={scope} disabled={!!s.busy} onChange={e=>setScope(e.target.value==="section"?"section":"song")}>
            <option value="song">Full song</option><option value="section">Selected section · {s.selectedSection.name}</option>
          </select></label>
          <label className="checkbox-label"><input type="checkbox" aria-label="Include effect tails" checked={includeTails} disabled={!!s.busy} onChange={e=>setIncludeTails(e.target.checked)}/>Include effect tails</label>
        </>}
        <label className="field">Destination<select aria-label="Export destination" value={destination} disabled={!!s.busy} onChange={e=>setDestination(e.target.value==="folder"?"folder":"download")}>
          <option value="download">Browser download{format==="stems"&&stem==="all"?" · one ZIP":""}</option><option value="folder">Choose folder · requires browser support</option>
        </select></label>
        <p className="helper" role="status" aria-label="Export summary">
          {format==="backup"?"Complete project · all private audio":format==="midi"?"Full song · editable notes and expression":scope==="section"?"Selected section · "+s.selectedSection.name:"Full song"}
          {(format==="wav"||format==="mp3"||format==="stems")&&(includeTails?" · includes effect tails":" · ends at the musical boundary")}
          {destination==="folder"?" · choose a new export folder":" · downloads to your browser"}
        </p>
        {format === "stems" && (
          <label className="field">
            Track
            <select
              aria-label="Stem track"
              value={stem}
              disabled={!!s.busy}
              onChange={(e) => setStem(e.target.value)}
            >
              <option value="all">All tracks</option>
              {s.project.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="helper">
          {format === "backup"
            ? "Factory instruments reload from Chordz. All your recordings and imported samples are included."
            : format === "midi"
              ? "MIDI exports the complete composition regardless of mute or solo. Sound patches and automation remain in a project backup."
            : format === "stems"
              ? "Stems share the chosen start and length, include track effects, and export regardless of mute or solo. ZIP downloads are limited to 512 MB; larger exports can use a folder."
              : format === "mp3"
                ? "MP3 includes the current mix and automation at 320 kbps. Encoding stays on your device."
                : "WAV includes the current mix and automation. Section exports retain sounds already playing at the section start."}
        </p>
        <button
          className="primary-button"
          disabled={!!s.busy||s.recordingPhase!=="idle"}
          onClick={() => void runExport()}
        >
          <Download size={17} />
          {s.busy
            ? "Working…"
            : "Export " +
              (format === "backup" ? "backup" : format.toUpperCase())}
        </button>
        {exporting&&<button className="secondary-button" data-edit-policy="bypass" onClick={cancelExport}>Cancel export</button>}
        <output aria-live="polite" className="helper">
          {s.busy &&
          !progress.startsWith("Encoding ") &&
          s.message.startsWith("Rendering ")
            ? s.message
            : progress}
        </output>
      </Modal>
      <Modal
        open={s.deviceOpen}
        onClose={() => s.setDeviceOpen(false)}
        title="Performance inputs"
        description="Connect an instrument, or record a microphone take with one bar of count-in."
      >
        {s.error && (
          <p className="studio-notice error" role="alert">
            {s.error}
          </p>
        )}
        <h3>MIDI controller</h3>
        <button
          className="secondary-button"
          onClick={() => void s.enableMidi()}
        >
          {s.midiEnabled ? "Refresh MIDI devices" : "Enable MIDI input"}
        </button>
        <label className="field">
          MIDI input
          <select
            aria-label="MIDI input"
            value={s.midiInputId}
            onChange={(e) => s.setMidiInputId(e.target.value)}
          >
            <option value="all">All connected devices</option>
            {s.midiInputs.map((input) => (
              <option value={input.id} key={input.id}>
                {input.name}
              </option>
            ))}
          </select>
        </label>
        <p className="helper">
          Velocity, sustain, pitch bend, modulation and expression are recorded.
          Computer keyboard input is always available.
        </p>
        <h3>Microphone</h3>
        <label className="field">
          Input
          <select
            aria-label="Microphone input"
            value={s.microphoneId}
            onChange={(e) => s.setMicrophoneId(e.target.value)}
          >
            <option value="">Default microphone</option>
            {s.microphones.map((mic, i) => (
              <option value={mic.deviceId} key={mic.deviceId}>
                {mic.label || "Microphone " + (i + 1)}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <DraftInput
            type="checkbox"
            checked={s.monitor}
            onChange={(e) => s.setMonitor(e.target.checked)}
          />
          Monitor input · use headphones
        </label>
        <p className="helper">
          Allow microphone access when recording starts. Trim and align the take
          in Arrange.
        </p>
      </Modal>
      <Modal
        open={!!s.conflict}
        onClose={() => {}}
        title="Both versions are safe"
        description="Another device saved this song while you were editing. Choose which version to continue."
      >
        <button
          className="primary-button"
          data-edit-policy="bypass"
          onClick={() => void s.keepConflictCopy()}
        >
          Keep my edit as a new song
        </button>
        <button className="secondary-button" data-edit-policy="bypass" onClick={s.useCloudConflict}>
          Open the cloud version
        </button>
        <p className="helper">
          Your incoming edit is also retained in recovery versions.
        </p>
      </Modal>
      <Modal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title="Recovery versions"
        description="Restore a device draft, or keep a cloud recovery version as a separate song."
      >
        {s.error && (
          <p className="studio-notice error" role="alert">
            {s.error}
          </p>
        )}
        <h3>Device drafts</h3>
        {drafts.map((draft) => (
          <button
            className="recovery-version"
            data-edit-policy="bypass"
            key={draft.document.id}
            onClick={() => {
              if (!s.loadDocument(
                draft.document,
                draft.revision,
                draft.savedFingerprint,
                "discard",
              )) return;
              setRecoveryOpen(false);
              s.setLibraryOpen(false);
            }}
          >
            <strong>{draft.document.title}</strong>
            <span>{new Date(draft.updatedAt).toLocaleString()}</span>
          </button>
        ))}
        <h3>Cloud recovery</h3>
        {versions.map((version) => (
          <button
            className="recovery-version"
            data-edit-policy="bypass"
            key={version.id}
            onClick={() => {
              if (!s.loadDocument(
                {
                  ...version.document,
                  id: uid(),
                  title: version.document.title + " · recovered",
                },
                0,
                "",
                "discard",
              )) return;
              setRecoveryOpen(false);
              s.setLibraryOpen(false);
            }}
          >
            <strong>{version.document.title}</strong>
            <span>
              {version.kind} · {new Date(version.createdAt).toLocaleString()}
            </span>
          </button>
        ))}
        {!versions.length && (
          <p className="helper">
            No conflicting versions have been recorded for this song.
          </p>
        )}
      </Modal>
    </>
  );
}
