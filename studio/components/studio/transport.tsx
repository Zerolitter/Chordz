"use client";
import {DraftInput} from "./draft-field";
import {
  Pause,
  Play,
  Square,
  Circle,
  Repeat2,
  Timer,
  Volume2,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useStudio, useTransport } from "./use-studio";
import { IconButton, Meter } from "./primitives";
import { PPQ } from "../../lib/music/types";
import { RecordingSetup } from "./recording-setup";
import {
  projectEnd,
  tickToSeconds,
  ticksPerBar,
} from "../../lib/music/project";

export function Transport() {
  const s = useStudio(),
    state = useTransport();
  const [meter, setMeter] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setMeter(
          s.recording
            ? (s.recorder.current?.meter() ?? 0)
            : (s.engine?.meter().master ?? 0),
        ),
      100,
    );
    return () => clearInterval(timer);
  }, [s.engine, s.recording,s.recorder]);
  const bar = Math.floor(state.tick / ticksPerBar(s.project)) + 1,
    beat =
      (Math.floor(state.tick / ((PPQ * 4) / s.project.timeSignature[1])) %
        s.project.timeSignature[0]) +
      1;
  const seconds = tickToSeconds(state.tick, s.project.tempo);
  const duration = tickToSeconds(projectEnd(s.project), s.project.tempo);
  const format = (n: number) =>
    `${Math.floor(n / 60)}:${Math.floor(n % 60)
      .toString()
      .padStart(2, "0")}`;
  return (
    <section className="transport" aria-label="Playback and recording">
      <div className="transport-main">
        <IconButton
          label={state.playing ? "Pause song" : "Play song"}
          className="play-button"
          data-playing={state.playing}
          disabled={!!s.busy || s.recording}
          onClick={() => void s.play()}
        >
          {state.playing ? (
            <Pause size={21} fill="currentColor" />
          ) : (
            <Play size={21} fill="currentColor" />
          )}
        </IconButton>
        <IconButton label="Stop song" data-edit-policy="bypass" onClick={s.stop}>
          <Square size={17} fill="currentColor" />
        </IconButton>
        <IconButton
          label={s.recording ? "Finish recording" : "Start recording"}
          data-edit-policy={s.recording ? "bypass" : undefined}
          className={"record-button " + (s.recording ? "active" : "")}
          disabled={!!s.busy}
          onClick={() => void s.beginRecording()}
        >
          <Circle size={18} fill={s.recording ? "currentColor" : "none"} />
        </IconButton>
        <select
          aria-label="Recording source"
          value={s.recordKind}
          onChange={(e) => s.setRecordKind(e.target.value as "audio" | "midi")}
          disabled={s.recording}
        >
          <option value="midi">MIDI</option>
          <option value="audio">Microphone</option>
        </select>
        <span className="transport-divider" />
        <IconButton
          label="Loop song"
          aria-pressed={s.loop}
          className={s.loop ? "active" : ""}
          onClick={() => s.setLoop(!s.loop)}
          disabled={s.recording}
        >
          <Repeat2 size={19} />
        </IconButton>
        <IconButton
          label="Metronome"
          aria-pressed={s.metronome}
          className={s.metronome ? "active" : ""}
          onClick={() => s.setMetronome(!s.metronome)}
        >
          <Timer size={19} />
        </IconButton>
      </div>
      <RecordingSetup />
      {s.recordingPhase === "recovery-error" && <div role="alert" data-edit-policy="bypass"><span className="tiny">Take kept in memory — not saved to this device or cloud. Retry or download before closing.</span><button className="secondary-button" onClick={()=>void s.retryRecording()}>Retry take save</button><button className="secondary-button" onClick={()=>void s.downloadRecording().catch(s.report)}>Download unsaved take</button></div>}
      <div className="transport-position">
        <span className="mono transport-bars">
          {String(bar).padStart(3, "0")}
          <i>:</i>
          {beat}
          <i>:</i>
          {String(Math.floor(((state.tick % PPQ) / PPQ) * 100)).padStart(
            2,
            "0",
          )}
        </span>
        <span className="tiny">
          {s.recordingPhase === "preparing" ? "Preparing recording…" : s.recordingPhase === "finalizing" ? "Saving take…" : s.recordingPhase === "recovery-error" ? "Take held in memory" : s.recordingPhase === "count-in" || state.countIn
            ? "Count-in"
            : s.recording
              ? "Recording · " + format(s.recordSeconds)
              : state.activity==="audition-loading"?"Loading audition…":state.activity==="audition"?"Audition · song paused":state.activity==="tail"&&state.previewId?"Audition tail · song paused":state.activity==="song-loading"?"Loading song…":format(seconds) + " / " + format(duration)}
        </span>
      </div>
      <div className="transport-scrub">
        <DraftInput
          aria-label="Song playhead"
          type="range"
          min={0}
          max={projectEnd(s.project)}
          step={PPQ / 4}
          value={Math.min(state.tick, projectEnd(s.project))}
          onChange={(e) => void s.seek(Number(e.target.value))}
          disabled={s.recording || !!s.busy}
        />
        <div>
          <span className="tiny">
            {state.previewId
              ? state.loading ? "Loading preview…" : state.activity === "tail" ? "Preview tail · press Stop" : "Preview playing · press again to stop"
              : state.loading
              ? "Loading sounds…"
              : s.ready
                ? "Audio enabled"
                : "Press play to enable audio"}
          </span>
          <span className="tiny">
            {s.project.tempo} BPM · {s.project.timeSignature.join("/")}
          </span>
        </div>
      </div>
      <div className="transport-output">
        <Volume2 size={18} />
        <Meter
          value={meter}
          label={s.recording ? "Microphone input" : "Master output"}
        />
        <IconButton
          label="Audio and MIDI devices"
          onClick={() => {
            s.setDeviceOpen(true);
            void s.refreshDevices();
          }}
        >
          <SlidersHorizontal size={18} />
        </IconButton>
      </div>
    </section>
  );
}
