"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { defaultWorkspaceLayouts, isWorkspaceLayouts, workspaceLayoutKey, type WorkspaceLayouts } from "../../lib/client/workspace-layout";

export function useWorkspaceLayout(owner: string, projectId: string) {
  const key = workspaceLayoutKey(owner, projectId);
  const currentKey = useRef(key);
  const sessionLayouts = useRef(new Map<string, {value:WorkspaceLayouts; error:string}>());
  useLayoutEffect(() => { currentKey.current = key; }, [key]);
  const [state, setState] = useState<{key:string; value:WorkspaceLayouts; ready:boolean; error:string}>({key, value:defaultWorkspaceLayouts(), ready:false, error:""});
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const cached = sessionLayouts.current.get(key);
      let value = cached?.value ?? defaultWorkspaceLayouts(), error = cached?.error ?? "";
      if (!cached) try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const stored: unknown = JSON.parse(raw);
          if (stored && typeof stored === "object" && "version" in stored && stored.version === 1 && "layouts" in stored && isWorkspaceLayouts(stored.layouts)) value = stored.layouts;
        }
      } catch { error = "Layout preferences could not be read. This session still works."; }
      sessionLayouts.current.set(key, {value, error});
      setState({key, value, ready:true, error});
    });
    return () => { active = false; };
  }, [key]);
  const value = state.key === key ? state.value : defaultWorkspaceLayouts();
  function update(change: (current: WorkspaceLayouts) => WorkspaceLayouts) {
    if (currentKey.current !== key || state.key !== key || !state.ready) return;
    const next = change(sessionLayouts.current.get(key)?.value ?? state.value);
    let error = "";
    try { localStorage.setItem(key, JSON.stringify({version:1, layouts:next})); }
    catch { error = "Layout preferences could not be saved. Your layout is kept for this session."; }
    sessionLayouts.current.set(key, {value:next, error});
    setState({key, value:next, ready:true, error});
  }
  return {layouts:value, key, ready:state.key === key && state.ready, update, reset:() => update(defaultWorkspaceLayouts), error:state.key === key ? state.error : ""};
}
