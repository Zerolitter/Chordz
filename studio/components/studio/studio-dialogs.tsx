"use client";
import {DraftInput} from "./draft-field";
import { useState } from "react";
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
  type ExportFormat,
} from "../../lib/audio/export";
import {
  keepPendingAsset,
  resolveAsset,
  listDrafts,
  type RecoveryDraft,
} from "../../lib/client/storage";
import { loadVersions } from "../../lib/client/cloud";
import { uid, type ProjectDocument } from "../../lib/music/types";
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
    }>;
  }>;
};
export function StudioDialogs() {
  const s = useStudio();
  const [deleting, setDeleting] = useState(""),
    [format, setFormat] = useState<ExportFormat>("wav"),
    [stem, setStem] = useState("all"),
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
  async function runExport() {
    if(!s.finishEdit())return;
    setProgress("");
    let directory: DirectoryHandle | undefined;
    try {
      if (format === "stems" && stem === "all") {
        const picker = (
          window as unknown as {
            showDirectoryPicker?: (options: {
              mode: string;
            }) => Promise<DirectoryHandle>;
          }
        ).showDirectoryPicker;
        if (!picker)
          throw new Error(
            "Choose one track at a time in this browser. Chrome and Edge can save all stems into a folder.",
          );
        directory = await picker({ mode: "readwrite" });
        directory = await directory.getDirectoryHandle(
          safeFilename(s.project.title) + " " + Date.now(),
          { create: true },
        );
      }
      s.setBusy("Exporting…");
      const project = structuredClone(s.project),
        name = safeFilename(project.title);
      if (format === "midi") {
        downloadBlob(
          new Blob([exportMidi(project) as BlobPart], { type: "audio/midi" }),
          name + ".mid",
        );
      } else if (format === "backup") {
        setProgress("Packing your song and private audio…");
        downloadBlob(
          new Blob(
            [
              (await projectBackup(project, (id) =>
                resolveAsset(s.owner, id),
              )) as BlobPart,
            ],
            { type: "application/zip" },
          ),
          name + ".chordz.zip",
        );
      } else {
        const engine = await s.getEngine();
        if (format === "stems") {
          const unmuted = {
            ...project,
            tracks: project.tracks.map((t) => ({
              ...t,
              mute: false,
              solo: false,
            })),
          };
          const tracks =
            stem === "all"
              ? unmuted.tracks
              : unmuted.tracks.filter((t) => t.id === stem);
          for (let i = 0; i < tracks.length; i++) {
            setProgress(
              `Rendering ${i + 1} / ${tracks.length} · ${tracks[i].name}`,
            );
            const buffer = await engine.render(unmuted, tracks[i].id);
            const blob = await s.getProcessor().encode(buffer, 24);
            const filename = `${String(i + 1).padStart(2, "0")} ${safeFilename(tracks[i].name)}.wav`;
            if (directory) {
              const writer = await (
                await directory.getFileHandle(filename, { create: true })
              ).createWritable();
              await writer.write(blob);
              await writer.close();
            } else downloadBlob(blob, name + " " + filename);
          }
        } else {
          setProgress("Rendering stereo mix with effect tails…");
          const buffer = await engine.render(project);
          downloadBlob(
            format === "mp3"
              ? await encodeMp3Buffer(buffer, (percent) =>
                  setProgress(`Encoding MP3 · ${percent}%`),
                )
              : await s.getProcessor().encode(buffer, 24),
            name + (format === "mp3" ? ".mp3" : ".wav"),
          );
        }
      }
      s.notify("Export complete.");
      setProgress("Export complete.");
    } catch (error) {
      setProgress("");
      if (!(error instanceof DOMException && error.name === "AbortError"))
        s.report(error);
    } finally {
      s.setBusy("");
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
        {format === "stems" && (
          <label className="field">
            Track
            <select
              aria-label="Stem track"
              value={stem}
              onChange={(e) => setStem(e.target.value)}
            >
              <option value="all">All tracks · save into a folder</option>
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
            : format === "stems"
              ? "Stems start at the song beginning, include effects and tails, and export regardless of mute or solo."
              : format === "mp3"
                ? "MP3 includes the current mix, automation, and effect tails at 320 kbps. Encoding stays on your device."
                : "WAV includes the current mix, automation, and effect tails."}
        </p>
        <button
          className="primary-button"
          disabled={!!s.busy}
          onClick={() => void runExport()}
        >
          <Download size={17} />
          {s.busy
            ? "Working…"
            : "Export " +
              (format === "backup" ? "backup" : format.toUpperCase())}
        </button>
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
