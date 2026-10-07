/**
 * The allow-list of workspaces that may use the unofficial WhatsApp engine (owner decision 2026-10-06). The platform switch stays
 * the global kill-switch: a workspace gets the engine only while the switch is ON and the workspace is on this list.
 */

export const NOTE_MAX = 500;
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN = 2;
export const PAGE_SIZE = 25;
export const OPTION_LIMIT = 20;

/** Structural shape of the API row (the contract's `UnofficialWorkspace`). */
export interface WorkspaceRowInput {
  orgUuid: string;
  name: string;
  slug: string;
  planSlug: string | null;
  enabledAt: string;
  enabledBy: { operatorUuid?: string | undefined; name?: string | undefined } | null;
  note: string;
  deviceCount: number;
  activeDeviceCount?: number | undefined;
}

export interface WorkspaceRow {
  orgUuid: string;
  name: string;
  slug: string;
  planSlug: string | null;
  enabledAt: string;
  /** The operator's name, or null when the row was added by the system or the operator is gone. */
  enabledByName: string | null;
  note: string;
  deviceCount: number;
  /** Null when the API did not say. */
  activeDeviceCount: number | null;
}

export function toRow(w: WorkspaceRowInput): WorkspaceRow {
  const name = w.enabledBy?.name?.trim();
  return {
    orgUuid: w.orgUuid,
    name: w.name,
    slug: w.slug,
    planSlug: w.planSlug,
    enabledAt: w.enabledAt,
    enabledByName: name ? name : null,
    note: w.note,
    deviceCount: w.deviceCount,
    activeDeviceCount: w.activeDeviceCount ?? null,
  };
}

export const toRows = (list: readonly WorkspaceRowInput[]): WorkspaceRow[] => list.map(toRow);

/** Structural shape of one "add a workspace" search result. */
export interface WorkspaceOptionInput {
  orgUuid: string;
  name: string;
  slug: string;
  planSlug: string | null;
  ownerEmail: string | null;
  alreadyEnabled: boolean;
}

export interface WorkspaceOption extends WorkspaceOptionInput {
  /** An already allowed workspace is shown but cannot be added again. */
  canAdd: boolean;
}

export const toOptions = (list: readonly WorkspaceOptionInput[]): WorkspaceOption[] =>
  list.map((o) => ({ ...o, canAdd: !o.alreadyEnabled }));

/** A search runs only for a real term: one character would match nearly everything. */
export const searchTerm = (typed: string): string => typed.trim();
export const searchReady = (typed: string): boolean => searchTerm(typed).length >= SEARCH_MIN;

export type NoteCheck = { ok: true; value: string | undefined } | { ok: false; error: 'tooLong' };

/** The optional note: trimmed, blank means none, at most 500 characters. */
export function checkNote(raw: string): NoteCheck {
  const value = raw.trim();
  if (value.length > NOTE_MAX) return { ok: false, error: 'tooLong' };
  return { ok: true, value: value === '' ? undefined : value };
}

export type PanelBanner = 'engineOff' | null;

/** The warning: the list has workspaces on it but the global switch is off, so none of them can use the engine yet. */
export function panelBanner(platformOn: boolean, workspaceCount: number): PanelBanner {
  return !platformOn && workspaceCount > 0 ? 'engineOff' : null;
}

/** What the sidebar badge on the Node bridge entry says: off wins, then "on but nobody is allowed", otherwise no badge. */
export type NavBadgeState = 'notSupported' | 'noWorkspaces' | null;

export function navBadgeState(platformOn: boolean, workspaceCount: number): NavBadgeState {
  if (!platformOn) return 'notSupported';
  return workspaceCount === 0 ? 'noWorkspaces' : null;
}

/** Who can change the list: only a super admin. Anyone else who can read it sees it read-only. */
export const canChangeList = (role: string): boolean => role === 'super_admin';
