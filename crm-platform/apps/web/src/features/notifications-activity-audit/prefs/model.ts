import type {
  NotificationPreferenceItem,
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
} from '@crm/contracts';
import {
  NOTIFICATION_GROUPS,
  TYPE_CATALOGUE,
  isKnownType,
  typeMeta,
  type NotificationGroup,
} from '../lib/catalogue';

/**
 * The pure parts of the per-person notification preferences: how a list of preferences reads on screen (what is on, what is
 * disabled and why), how a change or a reset alters it, and the one question the live alerts ask ("may this type pop up or ping?").
 * No React, no network, so every rule is tested without a browser.
 *
 * A preference has three channels, all about THIS person: the bell (the row exists and the badge counts it), the pop-up (a toast
 * while the tab is in front) and the sound (the ping). The pop-up and the sound ride on the bell row, so they are off whenever the
 * bell is off. The workspace owner's own toggle for an event (Settings, Notifications) sits above all three: when the workspace
 * turned the event off nothing reaches anybody, so the person's switches are shown off and cannot be changed.
 */

export const PREF_CHANNELS = ['bell', 'toast', 'sound'] as const;
export type PrefChannel = (typeof PREF_CHANNELS)[number];
export type PrefFlags = Record<PrefChannel, boolean>;

/** What the person stored for each channel: a boolean is their choice, `null` means "follow the default". */
export type PrefOverrides = Record<PrefChannel, boolean | null>;

export interface PrefEntry {
  /** The notification type (`new_message`, `device_disconnected`, ...). */
  type: string;
  group: NotificationGroup;
  /** In force right now: the person's choice, else the workspace's toggle, else the default. */
  flags: PrefFlags;
  /** What applies with no choice made (the bell's is the workspace owner's toggle). */
  defaults: PrefFlags;
  /** The person's own choices; `null` follows the default. */
  overrides: PrefOverrides;
  /** False when the workspace owner turned the event off for everybody. */
  workspaceEnabled: boolean;
}

/** A server item as the screen uses it. */
export function entryFromItem(item: NotificationPreferenceItem): PrefEntry {
  return {
    type: item.type,
    group: item.group,
    flags: { bell: item.bell, toast: item.toast, sound: item.sound },
    defaults: { bell: item.workspaceInapp, toast: item.defaults.toast, sound: item.defaults.sound },
    overrides: { ...item.overrides },
    workspaceEnabled: item.workspaceInapp,
  };
}

export function stateFromResponse(res: NotificationPreferencesResponse): PrefsState {
  return { entries: res.items.map(entryFromItem) };
}

export type CellReason =
  /** The workspace turned the event off. */
  | 'workspace'
  /** The bell is off, and the pop-up and sound need it. */
  | 'bell_off'
  /** This kind of notification has no pop-up or no sound at all. */
  | 'not_available';

export interface Cell {
  /** What the switch shows. A disabled cell shows off. */
  on: boolean;
  disabled: boolean;
  reason: CellReason | null;
}

export interface RowView {
  type: string;
  group: NotificationGroup;
  /** The person changed at least one switch away from the default. */
  custom: boolean;
  /** The workspace turned the event off. */
  blocked: boolean;
  cells: Record<PrefChannel, Cell>;
}

/** The person chose at least one channel themselves. */
export function isCustom(entry: PrefEntry): boolean {
  return PREF_CHANNELS.some((c) => entry.overrides[c] !== null);
}

/** How one entry reads on screen. */
export function rowView(entry: PrefEntry): RowView {
  const meta = typeMeta(entry.type);
  const blocked = !entry.workspaceEnabled;
  const off = (reason: CellReason): Cell => ({ on: false, disabled: true, reason });
  const bell: Cell = blocked
    ? off('workspace')
    : { on: entry.flags.bell, disabled: false, reason: null };
  const dependent = (channel: 'toast' | 'sound', available: boolean): Cell => {
    if (blocked) return off('workspace');
    if (!available) return off('not_available');
    if (!entry.flags.bell) return off('bell_off');
    return { on: entry.flags[channel], disabled: false, reason: null };
  };
  return {
    type: entry.type,
    group: entry.group,
    custom: isCustom(entry),
    blocked,
    cells: { bell, toast: dependent('toast', meta.toast), sound: dependent('sound', meta.sound) },
  };
}

export interface RowGroup {
  group: NotificationGroup;
  rows: RowView[];
}

/** The entries by group, in the screen's order; known types in catalogue order, then any type this build does not know. */
export function groupRows(entries: readonly PrefEntry[]): RowGroup[] {
  const known = Object.keys(TYPE_CATALOGUE);
  const order = (type: string) => {
    const index = isKnownType(type) ? known.indexOf(type) : -1;
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const rows = entries.map(rowView);
  return NOTIFICATION_GROUPS.map((group) => ({
    group,
    rows: rows
      .filter((r) => r.group === group)
      .sort((a, b) => order(a.type) - order(b.type) || a.type.localeCompare(b.type)),
  })).filter((g) => g.rows.length > 0);
}

// --- changes --------------------------------------------------------------------------------------------------------------------

export interface PrefsState {
  entries: PrefEntry[];
}

const replace = (state: PrefsState, type: string, next: PrefEntry): PrefsState => ({
  entries: state.entries.map((e) => (e.type === type ? next : e)),
});

/**
 * Turns one switch. A switch put back to the value it would have anyway goes back to following the default (`null`), so a later
 * change of the default still reaches this person. Turning the bell off leaves the pop-up and sound choices as they were (they
 * come back with the bell) but the screen shows them off. A change to a disabled cell (workspace off, bell off, not available) is
 * ignored, so the state can never hold a choice the screen did not allow.
 */
export function applyChange(
  state: PrefsState,
  type: string,
  channel: PrefChannel,
  value: boolean,
): PrefsState {
  const entry = state.entries.find((e) => e.type === type);
  if (!entry) return state;
  const cell = rowView(entry).cells[channel];
  if (cell.disabled || entry.flags[channel] === value) return state;
  return replace(state, type, {
    ...entry,
    flags: { ...entry.flags, [channel]: value },
    overrides: { ...entry.overrides, [channel]: value === entry.defaults[channel] ? null : value },
  });
}

const resetOne = (e: PrefEntry): PrefEntry => ({
  ...e,
  flags: { ...e.defaults },
  overrides: { bell: null, toast: null, sound: null },
});

/** One type back to the default. The same state object comes back when nothing changes. */
export function resetEntry(state: PrefsState, type: string): PrefsState {
  const entry = state.entries.find((e) => e.type === type);
  if (!entry || !isCustom(entry)) return state;
  return replace(state, type, resetOne(entry));
}

/** Everything back to the defaults. */
export function resetAll(state: PrefsState): PrefsState {
  if (!state.entries.some(isCustom)) return state;
  return { entries: state.entries.map((e) => (isCustom(e) ? resetOne(e) : e)) };
}

export function customCount(state: PrefsState): number {
  return state.entries.filter(isCustom).length;
}

type UpdateItem = UpdateNotificationPreferencesRequest['items'][number];

/** The request for one switch: the choice the state now holds for that channel (`null` = follow the default). */
export function changeRequest(
  state: PrefsState,
  type: string,
  channel: PrefChannel,
): UpdateNotificationPreferencesRequest | null {
  const entry = state.entries.find((e) => e.type === type);
  if (!entry) return null;
  return { items: [{ type, [channel]: entry.overrides[channel] } as UpdateItem] };
}

/** The request that sends `types` back to following the defaults; null when there is nothing to send. */
export function resetRequest(
  types: readonly string[],
): UpdateNotificationPreferencesRequest | null {
  if (types.length === 0) return null;
  return {
    items: types.map((type) => ({ type, bell: null, toast: null, sound: null }) as UpdateItem),
  };
}

/** The types the person changed, for "reset everything". */
export function customTypes(state: PrefsState): string[] {
  return state.entries.filter(isCustom).map((e) => e.type);
}

// --- the live alerts ask ------------------------------------------------------------------------------------------------------

/**
 * Whether a notification of `type` may pop up (`toast`) or ping (`sound`) for this person. With no preferences loaded (offline, an
 * older server, still loading) the type's own default applies, so alerts keep working. The workspace's off switch and the
 * person's bell switch both silence the extras: the bell row is the thing a pop-up or ping is about.
 */
export function mayAlert(
  entries: readonly PrefEntry[] | undefined,
  type: string,
  channel: 'toast' | 'sound',
): boolean {
  const meta = typeMeta(type);
  if (!meta[channel]) return false;
  const entry = entries?.find((e) => e.type === type);
  if (!entry) return true;
  return entry.workspaceEnabled && entry.flags.bell && entry.flags[channel];
}
