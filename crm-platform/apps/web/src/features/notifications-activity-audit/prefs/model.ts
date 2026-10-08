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
 * A preference has four channels, all about THIS person: the bell (the row exists and the badge counts it), the pop-up (a toast
 * while the tab is in front), the sound (the ping) and the push (an OS notification on their enabled devices, even with the CRM
 * closed). The pop-up, the sound and the push ride on the bell row, so they are off whenever the bell is off.
 *
 * The workspace owner's toggle for an event (Settings, Notifications) is only the DEFAULT of the bell: the server rule is that the
 * person's own choice wins (`resolveNotificationChannels`). So when the workspace has an event off the person's switches stay usable
 * (the bell shows off until they turn it on for themselves) and the row carries a small note saying so.
 */

export const PREF_CHANNELS = ['bell', 'toast', 'sound', 'push'] as const;
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
  /** False when the workspace owner has the event off by default. The person's own choice still applies to them. */
  workspaceEnabled: boolean;
}

/** A server item as the screen uses it. */
export function entryFromItem(item: NotificationPreferenceItem): PrefEntry {
  return {
    type: item.type,
    group: item.group,
    flags: { bell: item.bell, toast: item.toast, sound: item.sound, push: item.push },
    defaults: {
      bell: item.workspaceInapp,
      toast: item.defaults.toast,
      sound: item.defaults.sound,
      push: item.defaults.push,
    },
    overrides: { ...item.overrides },
    workspaceEnabled: item.workspaceInapp,
  };
}

export function stateFromResponse(res: NotificationPreferencesResponse): PrefsState {
  return { entries: res.items.map(entryFromItem) };
}

export type CellReason =
  /** The bell is off, and the pop-up, sound and push need it. */
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
  /** The workspace has the event off by default: the row shows a note, and the switches stay usable. */
  blocked: boolean;
  cells: Record<PrefChannel, Cell>;
}

/** The person chose at least one channel themselves. */
export function isCustom(entry: PrefEntry): boolean {
  return PREF_CHANNELS.some((c) => entry.overrides[c] !== null);
}

/**
 * How one entry reads on screen. A workspace that has the event off does NOT disable the person's switches (the server lets their
 * choice win): the bell simply shows off until they turn it on for themselves, and `blocked` drives the note on the row.
 */
export function rowView(entry: PrefEntry): RowView {
  const meta = typeMeta(entry.type);
  const off = (reason: CellReason): Cell => ({ on: false, disabled: true, reason });
  const bell: Cell = { on: entry.flags.bell, disabled: false, reason: null };
  const dependent = (channel: 'toast' | 'sound' | 'push', available: boolean): Cell => {
    if (!available) return off('not_available');
    if (!entry.flags.bell) return off('bell_off');
    return { on: entry.flags[channel], disabled: false, reason: null };
  };
  return {
    type: entry.type,
    group: entry.group,
    custom: isCustom(entry),
    blocked: !entry.workspaceEnabled,
    cells: {
      bell,
      toast: dependent('toast', meta.toast),
      sound: dependent('sound', meta.sound),
      push: dependent('push', true),
    },
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
  overrides: { bell: null, toast: null, sound: null, push: null },
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
    items: types.map(
      (type) => ({ type, bell: null, toast: null, sound: null, push: null }) as UpdateItem,
    ),
  };
}

/** The types the person changed, for "reset everything". */
export function customTypes(state: PrefsState): string[] {
  return state.entries.filter(isCustom).map((e) => e.type);
}

// --- the live alerts ask ------------------------------------------------------------------------------------------------------

/**
 * Whether a notification of `type` may pop up (`toast`) or ping (`sound`) for this person. With no preferences loaded (offline, an
 * older server, still loading) the type's own default applies, so alerts keep working. The person's bell switch silences the extras:
 * the bell row is the thing a pop-up or ping is about. (The workspace's toggle only sets the bell's default; a person who turned the
 * bell on for themselves keeps their alerts.)
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
  return entry.flags.bell && entry.flags[channel];
}

/**
 * Whether a browser push (an OS notification on this person's devices) is on for `type`. Used to avoid showing the same event twice:
 * when this browser has push enabled and it is on for the type, the in-page desktop alert for a background tab is left to the push.
 * With no preferences loaded the catalogue default applies (a chat event: on).
 */
export function mayPush(entries: readonly PrefEntry[] | undefined, type: string): boolean {
  const entry = entries?.find((e) => e.type === type);
  if (!entry) return isKnownType(type) ? typeMeta(type).push : false;
  return entry.flags.bell && entry.flags.push;
}
