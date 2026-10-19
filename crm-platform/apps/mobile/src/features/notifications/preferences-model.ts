import type {
  NotificationGroup,
  NotificationPreferenceItem,
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
} from '@crm/contracts';
import { NOTIFICATION_CATALOG, NOTIFICATION_GROUPS } from '@crm/contracts';

/**
 * The pure parts of the per-person notification preferences, ported from the web (`prefs/model.ts`): how a list of preferences reads on
 * screen (what is on, what is disabled and why), and how a change or a reset alters it. No React, no network.
 *
 * A preference has four channels, all about THIS person: the bell (the row exists and the badge counts it), the pop-up, the sound and the
 * push (an OS notification on their enabled devices). The pop-up, the sound and the push ride on the bell row, so they are off whenever
 * the bell is off. The workspace owner's toggle for an event is only the DEFAULT of the bell: the person's own choice wins.
 */

export const preferencesKey = ['notifications', 'preferences'] as const;

export const PREF_CHANNELS = ['bell', 'toast', 'sound', 'push'] as const;
export type PrefChannel = (typeof PREF_CHANNELS)[number];
export type PrefFlags = Record<PrefChannel, boolean>;

/** What the person stored for each channel: a boolean is their choice, `null` means "follow the default". */
export type PrefOverrides = Record<PrefChannel, boolean | null>;

export interface PrefEntry {
  type: string;
  group: NotificationGroup;
  /** In force right now: the person's choice, else the workspace's toggle, else the default. */
  flags: PrefFlags;
  /** What applies with no choice made (the bell's is the workspace owner's toggle). */
  defaults: PrefFlags;
  overrides: PrefOverrides;
  /** False when the workspace owner has the event off by default. The person's own choice still applies to them. */
  workspaceEnabled: boolean;
}

export interface PrefsState {
  entries: PrefEntry[];
}

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

export const stateFromResponse = (res: NotificationPreferencesResponse): PrefsState => ({
  entries: res.items.map(entryFromItem),
});

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
  /** The workspace has the event off by default: the row carries a note, and the switches stay usable. */
  blocked: boolean;
  cells: Record<PrefChannel, Cell>;
}

export const isCustom = (entry: PrefEntry): boolean =>
  PREF_CHANNELS.some((c) => entry.overrides[c] !== null);

/** Whether a kind of notification has a pop-up or a sound at all (the shared catalogue the server also uses); a type it does not list has neither. */
export const availability = (type: string): { toast: boolean; sound: boolean } =>
  Object.hasOwn(NOTIFICATION_CATALOG, type)
    ? NOTIFICATION_CATALOG[type as keyof typeof NOTIFICATION_CATALOG]
    : { toast: false, sound: false };

/**
 * How one entry reads on screen. A workspace that has the event off does NOT disable the person's switches (the server lets their choice
 * win): the bell simply shows off until they turn it on for themselves, and `blocked` drives the note on the row.
 */
export function rowView(entry: PrefEntry): RowView {
  const available = availability(entry.type);
  const off = (reason: CellReason): Cell => ({ on: false, disabled: true, reason });
  const dependent = (channel: 'toast' | 'sound' | 'push', exists: boolean): Cell => {
    if (!exists) return off('not_available');
    if (!entry.flags.bell) return off('bell_off');
    return { on: entry.flags[channel], disabled: false, reason: null };
  };
  return {
    type: entry.type,
    group: entry.group,
    custom: isCustom(entry),
    blocked: !entry.workspaceEnabled,
    cells: {
      bell: { on: entry.flags.bell, disabled: false, reason: null },
      toast: dependent('toast', available.toast),
      sound: dependent('sound', available.sound),
      push: dependent('push', true),
    },
  };
}

/** The order the web lists the types in, inside each group. A type this build does not list comes after them, by name. */
const TYPE_ORDER: readonly string[] = [
  'new_chat',
  'new_message',
  'chat_waiting',
  'conversation_assigned',
  'snooze_wake',
  'mention',
  'task_assigned',
  'task_due',
  'task_completed',
  'new_lead',
  'form_submission',
  'form_needs_review',
  'form_payment',
  'form_payment_duplicate',
  'sales_doc_decided',
  'wallet_low_balance',
  'wallet_credited',
  'billing_payment_failed',
  'billing_subscription_canceled',
  'device_connected',
  'device_disconnected',
  'device_logged_out',
  'broadcast_completed',
  'broadcast_failed',
  'campaign_completed',
  'campaign_failed',
  'scheduled_completed',
  'scheduled_failed',
  'teamchat_mention',
  'teamchat_message',
  'email_bounced',
  'sla_breached',
  'member_leave_started',
  'assignment_blocked_by_leave',
  'appointment_calendar_drift',
  'waba_group_join_request',
  'waba_group_suspended',
  'waba_group_suspension_cleared',
  'device_group_join_request',
  'device_group_removed',
  'marketplace_renewal_due',
  'marketplace_payment_failed',
  'marketplace_subscription_ended',
  'test',
];

export interface RowGroup {
  group: NotificationGroup;
  rows: RowView[];
}

/** The entries by group, in the screen's order; known types in catalogue order, then any type this build does not know. */
export function groupRows(entries: readonly PrefEntry[]): RowGroup[] {
  const order = (type: string) => {
    const index = TYPE_ORDER.indexOf(type);
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

const replace = (state: PrefsState, type: string, next: PrefEntry): PrefsState => ({
  entries: state.entries.map((e) => (e.type === type ? next : e)),
});

/**
 * Turns one switch. A switch put back to the value it would have anyway goes back to following the default (`null`), so a later change of
 * the default still reaches this person. A change to a disabled cell is ignored, so the state can never hold a choice the screen did not
 * allow.
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

export const customCount = (state: PrefsState): number => state.entries.filter(isCustom).length;

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
export const customTypes = (state: PrefsState): string[] =>
  state.entries.filter(isCustom).map((e) => e.type);
