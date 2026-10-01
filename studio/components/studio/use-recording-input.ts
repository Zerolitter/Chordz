"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { MicrophoneRecorder } from "../../lib/audio/recording";
import type { StudioEngine } from "../../lib/audio/engine";

/** A disposable level check, separate from the measured take lifecycle. */
export function useRecordingInput(scope: string, getEngine: () => Promise<StudioEngine>) {
  const currentScope = useRef(scope);
  const job = useRef<{ scope: string; input: MicrophoneRecorder } | null>(null);
  const input = useRef<MicrophoneRecorder | null>(null);
  const monitoring = useRef(false);
  const [state, setState] = useState({ scope, phase: "idle", message: "" });
  function dispose() {
    job.current?.input.dispose();
    job.current = null;
    input.current = null;
  }
  useLayoutEffect(() => {
    currentScope.current = scope;
    return dispose;
  }, [scope]);
  function release() {
    dispose();
    setState({ scope: currentScope.current, phase: "idle", message: "" });
  }
  async function check(deviceId: string, monitor: boolean) {
    dispose();
    monitoring.current = monitor;
    const check = { scope: currentScope.current, input: new MicrophoneRecorder() };
    job.current = check;
    setState({ scope: check.scope, phase: "checking", message: "Checking microphone…" });
    try {
      const engine = await getEngine();
      if (job.current !== check || currentScope.current !== check.scope) return;
      await check.input.prepare(await engine.unlock(), deviceId || undefined, engine.monitorDestination!);
      if (job.current !== check || currentScope.current !== check.scope) { check.input.dispose(); return; }
      check.input.setMonitoring(monitoring.current);
      input.current = check.input;
      setState({ scope: check.scope, phase: "ready", message: "Input ready · level check only" });
    } catch (error) {
      check.input.dispose();
      if (job.current !== check || currentScope.current !== check.scope) return;
      job.current = null;
      setState({ scope: check.scope, phase: "problem", message: error instanceof Error ? error.message : "Microphone unavailable." });
    }
  }
  function setMonitoring(value: boolean) {
    monitoring.current = value;
    input.current?.setMonitoring(value);
  }
  return { input, check, release, setMonitoring, state: state.scope === scope ? state : { scope, phase: "idle", message: "" } };
}
