export const WORKSPACE_MODES = ["arrange", "write", "sound", "mix"] as const;
export type WorkspaceMode = typeof WORKSPACE_MODES[number];
export interface WorkspaceLayout {
  browserOpen: boolean;
  browserWidth: number;
  detailOpen: boolean;
  detailRatio: number;
  mixerOpen: boolean;
  mixerRatio: number;
}
export type WorkspaceLayouts = Record<WorkspaceMode, WorkspaceLayout>;

export function defaultWorkspaceLayouts(): WorkspaceLayouts {
  const base: WorkspaceLayout = { browserOpen: true, browserWidth: 236, detailOpen: true, detailRatio: .4, mixerOpen: false, mixerRatio: .52 };
  return { arrange: { ...base }, write: { ...base }, sound: { ...base }, mix: { ...base, browserOpen: false, detailOpen: false, mixerOpen: true } };
}

export const workspaceLayoutKey = (owner: string, projectId: string) => `chordz-layout-v1:${encodeURIComponent(owner)}:${encodeURIComponent(projectId)}`;

export function isWorkspaceLayouts(value: unknown): value is WorkspaceLayouts {
  if (!value || typeof value !== "object" || Object.keys(value).length !== WORKSPACE_MODES.length) return false;
  const layouts = value as Record<string, unknown>;
  return WORKSPACE_MODES.every(mode => {
    const entry = layouts[mode];
    if (!entry || typeof entry !== "object") return false;
    const p = entry as Record<string, unknown>;
    return Object.keys(p).length === 6 && typeof p.browserOpen === "boolean" && typeof p.detailOpen === "boolean" && typeof p.mixerOpen === "boolean"
      && typeof p.browserWidth === "number" && Number.isFinite(p.browserWidth) && p.browserWidth >= 180 && p.browserWidth <= 360
      && [p.detailRatio, p.mixerRatio].every(n => typeof n === "number" && Number.isFinite(n) && n >= .2 && n <= .7);
  });
}

/** Requested geometry is never rewritten by temporary viewport constraints. */
export function effectiveWorkspaceLayout(profile: WorkspaceLayout, width: number, height: number, detailVisible: boolean) {
  const available = Math.max(0, height - 72);
  const minimumCanvas = width < 700 ? 160 : 220;
  const browserWidth = profile.browserOpen && width >= 1100 && height >= 520 ? profile.browserWidth : 0;
  const detailHeight = detailVisible ? Math.max(0, Math.min(Math.max(220, available * (width < 700 ? .6 : profile.detailRatio)), available - minimumCanvas)) : 0;
  const mixerRoom = available - minimumCanvas - detailHeight - (detailVisible ? 6 : 0);
  const mixerHeight = profile.mixerOpen && mixerRoom >= 180 ? Math.min(available * profile.mixerRatio, mixerRoom) : 0;
  return { browserWidth, detailHeight, mixerHeight, canvasHeight: Math.max(0, available - detailHeight - mixerHeight - (detailVisible ? 6 : 0) - (mixerHeight ? 6 : 0)) };
}
