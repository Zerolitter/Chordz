"use client";
import {DraftInput} from "./draft-field";
import Link from "next/link";
import { useEffect, type CSSProperties } from "react";
import {
  FolderOpen,
  Download,
  Undo2,
  Redo2,
  Cloud,
  ChevronRight,
} from "lucide-react";
import { StudioProvider, useStudio, type StudioUser } from "./use-studio";
import { BrandMark, IconButton } from "./primitives";
import { WorkspacePrototype } from "./workspace-prototype";
import { releasePerformanceDockInputs } from "./performance-dock";
import { releaseSoundPanelInputs } from "./sound-panel";
import { freezeToolGestures } from "./tool-visibility";
import { AppearanceSettings } from "./appearance-settings";
import { usePreference } from "./use-preference";
import { DEFAULT_APPEARANCE, isAppearance, trackDisplayColor } from "../../lib/client/appearance";
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
  const [appearance, setAppearance, appearanceError] = usePreference("appearance", DEFAULT_APPEARANCE, isAppearance);
  useEffect(() => {
    for (const [name, value] of Object.entries({ "--amber": appearance.accent, "--primary": appearance.accent, "--ring": appearance.accent, "--rail-width": appearance.railWidth + "px" })) document.documentElement.style.setProperty(name, value);
    document.documentElement.dataset.density = appearance.density;
  }, [appearance]);
  return (
    <main className="studio-shell" data-density={appearance.density} style={{ "--rail-width": appearance.railWidth + "px", "--track-color": s.selectedTrack ? trackDisplayColor(s.project, s.selectedTrack) : appearance.accent } as CSSProperties} onClickCapture={e=>{const target=(e.target as HTMLElement).closest("button");if(target&&!target.closest('[data-edit-policy="bypass"]')&&!s.finishEdit()){e.preventDefault();e.stopPropagation();}}}>
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
          <span role="status" aria-label="Device draft status" className="device-draft-status">{s.deviceDraftStatus}
            {s.deviceDraftStatus === "Device draft unavailable" && <><span> · Keep this tab open; retry or export a backup.</span><button className="text-button" data-edit-policy="bypass" disabled={s.recording || !!s.busy} onClick={() => void s.retryDeviceDraft()}>Retry device draft</button></>}
          </span>
        </div>
        <div className="header-actions">
          <AppearanceSettings value={appearance} onChange={setAppearance} storageError={appearanceError} />
          <Shortcuts />
          <IconButton
            label="Undo"
            data-edit-policy="bypass"
            disabled={!s.history.past.length || s.recording}
            onClick={() => s.dispatch({ type: "undo" })}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Redo"
            data-edit-policy="bypass"
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
            data-edit-policy="bypass"
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
      <Transport />
      <div className="workspace-bar">
        <nav aria-label="Studio workspace">
          {(["arrange", "write", "sound", "mix"] as const).map((mode, i) => (
            <button
              key={mode}
              className={s.mode === mode ? "active" : ""}
              aria-label={"0" + (i + 1) + " " + mode[0].toUpperCase() + mode.slice(1)}
              aria-current={s.mode === mode ? "page" : undefined}
              data-edit-policy="bypass"
              onClick={() => { freezeToolGestures("detail"); freezeToolGestures("mixer"); releasePerformanceDockInputs(s); releaseSoundPanelInputs(s); s.setMode(mode); }}
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
        inert={!s.hydrated || (!!s.busy && !s.bounceState.busy) ? true : undefined}
      >
        <WorkspacePrototype />
      </div>
      {(!s.hydrated || s.busy || s.error || s.message) && <div
        className={"studio-notice " + (s.error ? "error" : "")}
        role={s.error ? "alert" : "status"}
      >
        {!s.hydrated
          ? "Opening your studio…"
          : s.busy ||
            s.error ||
            s.message}
        {s.error && (
          <button onClick={() => s.notify("Ready to try again.")}>
            Dismiss
          </button>
        )}
      </div>}
      {s.editConflict&&<div className="edit-conflict" role="alert" data-edit-policy="bypass">A newer edit was kept. Your proposal is available. <button onClick={s.reapplyEdit}>Reapply</button><button onClick={s.discardEdit}>Discard</button></div>}
      <StudioDialogs />
    </main>
  );
}
