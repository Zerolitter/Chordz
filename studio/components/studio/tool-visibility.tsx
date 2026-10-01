"use client";
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";

const ToolVisibility = createContext<{ active: boolean; scope?: string }>({ active: true });
const inputTerminators = new Map<string, Set<() => void>>();

/** End only inputs registered by this tool, before a hide request can be blocked by a draft. */
export function freezeToolGestures(scope: string) {
  for (const terminate of [...(inputTerminators.get(scope) ?? [])]) terminate();
}

/** Hidden tool bodies stay mounted while their input gestures and live polls stop. */
export function ToolVisibilityProvider({ active, scope, children }: { active: boolean; scope?: string; children: ReactNode }) {
  const parent = useContext(ToolVisibility);
  return <ToolVisibility.Provider value={{ active: parent.active && active, scope: scope ?? parent.scope }}>{children}</ToolVisibility.Provider>;
}

export function useToolVisibility() { return useContext(ToolVisibility).active; }

export function useToolInputTermination(terminate: () => void) {
  const { scope } = useContext(ToolVisibility), latest = useRef(terminate);
  useLayoutEffect(() => { latest.current = terminate; });
  useLayoutEffect(() => {
    if (!scope) return;
    const registered = () => latest.current();
    const owned = inputTerminators.get(scope) ?? new Set<() => void>();
    owned.add(registered); inputTerminators.set(scope, owned);
    return () => { owned.delete(registered); if (!owned.size) inputTerminators.delete(scope); };
  }, [scope]);
}
