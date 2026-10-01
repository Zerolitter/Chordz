"use client";
import { useState } from "react";
import type { NoteClipboard } from "../../lib/music/note-editing";

export type NoteEditorSession = {
  selection: string[]; editor: "notes" | "drums"; fold: boolean; highlight: boolean;
  scale: string; left: number; top: number | null; cursor: number;
};
const emptySession = (): NoteEditorSession => ({ selection: [], editor: "notes", fold: false, highlight: false, scale: "song", left: 0, top: null, cursor: 0 });

export const noteEditorContext = (owner: string, projectId: string, trackId = "", clipId = "") =>
  [owner, projectId, trackId, clipId].map(encodeURIComponent).join(":");

/** Editor state follows its source phrase; clipboard content stays within one owner. */
export function useNoteEditorSession(owner: string, context: string) {
  const [sessions, setSessions] = useState(() => new Map<string, NoteEditorSession>());
  const [clipboard, setClipboard] = useState<{ owner: string; value: NoteClipboard } | null>(null);
  const session = sessions.get(context) ?? emptySession();
  function update(value: Partial<NoteEditorSession> | ((current: NoteEditorSession) => Partial<NoteEditorSession>), targetContext = context) {
    setSessions(previous => {
      const current = previous.get(targetContext) ?? emptySession(), next = new Map(previous);
      next.set(targetContext, { ...current, ...(typeof value === "function" ? value(current) : value) });
      return next;
    });
  }
  function rememberScroll(left: number, top: number) {
    setSessions(previous => {
      const current = previous.get(context) ?? emptySession();
      if (current.left === left && current.top === top) return previous;
      const next = new Map(previous); next.set(context, { ...current, left, top }); return next;
    });
  }
  function copy(value: NoteClipboard) { setClipboard({ owner, value }); }
  return { session, update, rememberScroll, copy, clipboard: clipboard?.owner === owner ? clipboard.value : null };
}

export type NoteEditorSessionController = ReturnType<typeof useNoteEditorSession>;
