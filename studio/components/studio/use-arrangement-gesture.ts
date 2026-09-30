"use client";
import { useEffect, useEffectEvent, useRef } from "react";
import { useStudio } from "./use-studio";

/** Pointer previews share the studio's field transaction and rollback rules. */
export function useArrangementGesture<T>(owner: string) {
  const s = useStudio(), active = useRef<T | null>(null);
  function cancel() {
    if (!active.current) return false;
    active.current = null;
    return s.cancelEdit(owner);
  }
  const cancelCurrent = useEffectEvent(cancel);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && cancelCurrent()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      cancelCurrent();
    };
  }, []);
  return {
    active,
    begin(data: T) {
      if (s.recording || !s.beginEdit(owner)) return false;
      active.current = data;
      return true;
    },
    owns: () => active.current !== null && s.ownsEdit(owner),
    update(data: T) { active.current = data; },
    finish() {
      if (!active.current) return;
      active.current = null;
      s.finishEdit(owner);
    },
    cancel,
  };
}
