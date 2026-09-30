"use client";
import {DraftInput} from "./draft-field";
import Link from "next/link";
import {
  FolderOpen,
  Download,
  Undo2,
  Redo2,
  Cloud,
  Upload,
  ChevronRight,
} from "lucide-react";
import { StudioProvider, useStudio, type StudioUser } from "./use-studio";
import { IconButton, BrandMark } from "./primitives";
import { WritePanel } from "./write-panel";
import { ArrangePanel } from "./arrange-panel";
import { SoundPanel } from "./sound-panel";
import { MixerPanel } from "./mixer-panel";
import { TrackList } from "./track-list";
import { Piano } from "./piano";
import { Transport } from "./transport";
import { Shortcuts } from "./shortcuts";
import { StudioDialogs } from "./studio-dialogs";
import type { ProjectDocument, Mode } from "../../lib/music/types";
export default function Studio({
  initialProject,
  user,
}: {
  initialProject: ProjectDocument;
  user: StudioUser;
}) {
  return (
    <StudioProvider initialProject={initialProject} user={user}>
      <StudioShell />
    </StudioProvider>
  );
}
function StudioShell() {
  const s = useStudio();
  return (
    <main className="studio-shell" onClickCapture={e=>{const target=(e.target as HTMLElement).closest("button");if(target&&!["Undo","Redo","Stop song","Stop all sound","Finish take"].includes(target.getAttribute("aria-label")??target.textContent??"")&&!s.finishEdit()){e.preventDefault();e.stopPropagation();}}}>
      <h1 className="sr-only">Chordz music studio</h1>
      <header className="studio-header">
        <Link href="/" className="brand">
          <BrandMark />
          <span>
            chordz<span className="brand-dot">.</span>
          </span>
        </Link>
        <span className="header-divider" />
        <div className="project-heading">
          <DraftInput
            aria-label="Song title"
            value={s.project.title}
            maxLength={160}
            onChange={(e) =>
              s.edit((p) => ({ ...p, title: e.target.value }), "Rename song")
            }
            disabled={!s.hydrated || s.recording}
          />
          <span className="save-status">
            <i className={s.saveStatus.includes("Saved") ? "saved" : ""} />
            {s.saveStatus}
          </span>
        </div>
        <div className="header-actions">
          <Shortcuts />
          <IconButton
            label="Undo"
            disabled={!s.history.past.length || s.recording}
            onClick={() => s.dispatch({ type: "undo" })}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={!s.history.future.length || s.recording}
            onClick={() => s.dispatch({ type: "redo" })}
          >
            <Redo2 size={18} />
          </IconButton>
          <IconButton
            label="Save song"
            onClick={() => void s.saveNow()}
            disabled={!!s.busy || !s.hydrated}
          >
            <Cloud size={19} />
          </IconButton>
          <button
            className="secondary-button library-button"
            onClick={() => {
              s.setLibraryOpen(true);
              void s.refreshLibrary();
            }}
          >
            <FolderOpen size={17} />
            Songs
          </button>
          <button
            className="primary-button export-button"
            onClick={() => {if(s.finishEdit())s.setExportOpen(true);}}
          >
            <Download size={16} />
            Export
          </button>
          {s.user ? (
            <a
              className="avatar"
              title={"Signed in as " + s.user.displayName + " · sign out"}
              href="/signout-with-chatgpt?return_to=/"
            >
              {s.user.displayName.slice(0, 1).toUpperCase()}
            </a>
          ) : (
            <a
              className="sign-in"
              href="/signin-with-chatgpt?return_to=/"
              onClick={(e) => {
                e.preventDefault();
                void s.signIn().catch(s.report);
              }}
            >
              Sign in <ChevronRight size={14} />
            </a>
          )}
        </div>
      </header>
      <div className="workspace-bar">
        <nav aria-label="Studio workspace">
          {(["write", "arrange", "sound", "mix"] as const).map((mode, i) => (
            <button
              key={mode}
              className={s.mode === mode ? "active" : ""}
              aria-current={s.mode === mode ? "page" : undefined}
              onClick={() => s.setMode(mode)}
            >
              <span className="mono">0{i + 1}</span>
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </nav>
        <div className="song-settings">
          <label>
            Key
            <select
              aria-label="Song key"
              value={s.project.key}
              onChange={(e) =>
                s.edit((p) => ({ ...p, key: e.target.value }), "Change key")
              }
            >
              {[
                "C",
                "Db",
                "D",
                "Eb",
                "E",
                "F",
                "Gb",
                "G",
                "Ab",
                "A",
                "Bb",
                "B",
              ].map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </label>
          <select
            aria-label="Song scale"
            value={s.project.mode}
            onChange={(e) =>
              s.edit(
                (p) => ({ ...p, mode: e.target.value as Mode }),
                "Change scale",
              )
            }
          >
            {[
              "major",
              "minor",
              "dorian",
              "mixolydian",
              "harmonic-minor",
              "pentatonic",
            ].map((mode) => (
              <option key={mode} value={mode}>
                {mode.replace("-", " ")}
              </option>
            ))}
          </select>
          <label>
            Tempo
            <DraftInput
              aria-label="Tempo"
              type="number"
              min={20}
              max={400}
              value={s.project.tempo}
              disabled={s.recording}
              onChange={(e) =>
                s.edit(
                  (p) => ({
                    ...p,
                    tempo: Math.max(20, Math.min(400, Number(e.target.value))),
                  }),
                  "Change tempo",
                )
              }
            />
          </label>
          <label>
            Meter
            <DraftInput
              aria-label="Beats per bar"
              type="number"
              min={1}
              max={16}
              value={s.project.timeSignature[0]}
              onChange={(e) =>
                s.edit(
                  (p) => ({
                    ...p,
                    timeSignature: [
                      Math.max(1, Math.min(16, Number(e.target.value))),
                      p.timeSignature[1],
                    ],
                  }),
                  "Change meter",
                )
              }
            />
            <span>/</span>
            <select
              aria-label="Beat denominator"
              value={s.project.timeSignature[1]}
              onChange={(e) =>
                s.edit(
                  (p) => ({
                    ...p,
                    timeSignature: [p.timeSignature[0], Number(e.target.value)],
                  }),
                  "Change meter",
                )
              }
            >
              {[2, 4, 8, 16].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div
        className="studio-body"
        inert={!s.hydrated || !!s.busy ? true : undefined}
      >
        <TrackList />
        <div className="workspace">
          <div className="workspace-content">
            <div hidden={s.mode!=="write"}><WritePanel /></div>
            <div hidden={s.mode!=="arrange"}><ArrangePanel /></div>
            <div hidden={s.mode!=="sound"}><SoundPanel /></div>
            <div hidden={s.mode!=="mix"}><MixerPanel /></div>
          </div>
          <div className="workspace-bottom">
            <div className="import-row">
              <span className="tiny">
                Perform into {s.selectedTrack?.name ?? "your ensemble"}
              </span>
              <label className="text-button file-button">
                <Upload size={14} />
                Import audio
                <DraftInput
                  type="file"
                  accept="audio/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file)
                      try {
                        s.setBusy("Importing audio…");
                        await s.addAudio(file, file.name);
                      } catch (error) {
                        s.report(error);
                      } finally {
                        s.setBusy("");
                      }
                  }}
                />
              </label>
              <label className="text-button file-button">
                Map a sample
                <DraftInput
                  type="file"
                  accept="audio/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file)
                      try {
                        s.setBusy("Mapping sample…");
                        await s.addAudio(file, file.name, 0, true);
                      } catch (error) {
                        s.report(error);
                      } finally {
                        s.setBusy("");
                      }
                  }}
                />
              </label>
            </div>
            <Piano />
          </div>
        </div>
      </div>
      <div
        className={"studio-notice " + (s.error ? "error" : "")}
        role={s.error ? "alert" : "status"}
      >
        {!s.hydrated
          ? "Opening your studio…"
          : s.busy ||
            s.error ||
            s.message ||
            "Your next song starts with a few notes."}
        {s.error && (
          <button onClick={() => s.notify("Ready to try again.")}>
            Dismiss
          </button>
        )}
      </div>
      <Transport />
      {s.editConflict&&<div className="edit-conflict" role="alert">A newer edit was kept. Your proposal is available. <button onClick={s.reapplyEdit}>Reapply</button><button onClick={s.discardEdit}>Discard</button></div>}
      <StudioDialogs />
    </main>
  );
}
