import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  WA_DEVICE_GROUP_PARTICIPANTS_PER_CALL_MAX,
  type PersonalDevice,
  type UpdateWaDeviceGroupInput,
  type WaDeviceGroup,
  type WaGroupParticipantOutcome,
  type WaGroupParticipantResult,
} from '@crm/contracts';

/** Permissions of the Groups tab (decision D4). Read is the tab's key; every write has its own. */
export const GROUP_PERMISSIONS = {
  read: 'wa.groups.read',
  create: 'wa.groups.create',
  manage: 'wa.groups.manage',
  leave: 'wa.groups.leave',
} as const;

export interface GroupPerms {
  create: boolean;
  manage: boolean;
  leave: boolean;
}

export type GroupNotice = {
  tone: 'success' | 'warning' | 'danger';
  text: string;
  requestId?: string;
};

/** The cap of numbers per call (D11); one place so the form, the hints and the tests agree. */
export const NUMBERS_PER_CALL = WA_DEVICE_GROUP_PARTICIPANTS_PER_CALL_MAX;

/**
 * The number the page shows: the one named in `?device=` when it is a number of this workspace, else the first connected one, else the
 * first at all (an offline number still shows its groups, read-only, with the reason). `null` when the workspace has no number.
 */
export function pickDevice(
  devices: readonly PersonalDevice[],
  deviceId: string | undefined,
): PersonalDevice | null {
  return (
    devices.find((d) => d.id === deviceId) ??
    devices.find((d) => d.connectionState === 'connected') ??
    devices[0] ??
    null
  );
}

export const isOnline = (d: Pick<PersonalDevice, 'connectionState'>): boolean =>
  d.connectionState === 'connected';

/** Which block the state endpoint's reason draws above the list (the list stays: it is the stored directory). */
export function offlineReason(
  state: { connected: boolean; reason: string } | undefined,
): 'not_connected' | 'worker_unavailable' | null {
  if (!state || state.connected) return null;
  return state.reason === 'worker_unavailable' ? 'worker_unavailable' : 'not_connected';
}

// --- numbers typed into a form ------------------------------------------------------------------------------------------------

export interface ParsedNumbers {
  /** E.164, de-duplicated, in the order typed. */
  valid: string[];
  /** What the person typed that is not a phone number (shown back so they can fix it). */
  invalid: string[];
  /** How many repeats were dropped. */
  duplicates: number;
  /** The connected number itself was in the list (WhatsApp adds it on its own). */
  includesSelf: boolean;
  /** More valid numbers than one call takes. */
  overCap: boolean;
}

/** Splits on new lines, commas, semicolons and spaces between numbers; `00` and a bare country code are read as `+`. */
export function parseNumbers(text: string, selfE164?: string | null): ParsedNumbers {
  const out: ParsedNumbers = {
    valid: [],
    invalid: [],
    duplicates: 0,
    includesSelf: false,
    overCap: false,
  };
  const seen = new Set<string>();
  // A number may contain spaces, dashes and brackets ("+91 98765-43210"): split on separators that cannot be inside one first.
  const parts = text
    .split(/[\n\r,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const raw of parts) {
    let s = raw.replace(/[\s().-]/g, '');
    if (s.startsWith('00')) s = `+${s.slice(2)}`;
    else if (!s.startsWith('+')) s = `+${s}`;
    const parsed = /^\+\d+$/.test(s) ? parsePhoneNumberFromString(s) : undefined;
    if (!parsed || !parsed.isValid()) {
      out.invalid.push(raw);
      continue;
    }
    const e164 = parsed.number;
    if (selfE164 && e164 === selfE164) {
      out.includesSelf = true;
      continue;
    }
    if (seen.has(e164)) {
      out.duplicates += 1;
      continue;
    }
    seen.add(e164);
    out.valid.push(e164);
  }
  out.overCap = out.valid.length > NUMBERS_PER_CALL;
  return out;
}

/** A person may submit when there is at least one number, none is wrong, and the call stays inside the cap. */
export const numbersOk = (p: ParsedNumbers): boolean =>
  p.valid.length > 0 && p.invalid.length === 0 && !p.overCap;

// --- results of a participants call -----------------------------------------------------------------------------------------

export interface ResultSummary {
  ok: number;
  failed: WaGroupParticipantResult[];
  /** How many people ended with each outcome other than `ok`. */
  byOutcome: Partial<Record<WaGroupParticipantOutcome, number>>;
}

export function summarizeResults(results: readonly WaGroupParticipantResult[]): ResultSummary {
  const failed: WaGroupParticipantResult[] = [];
  const byOutcome: ResultSummary['byOutcome'] = {};
  let ok = 0;
  for (const r of results) {
    if (r.outcome === 'ok') {
      ok += 1;
      continue;
    }
    failed.push(r);
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
  }
  return { ok, failed, byOutcome };
}

// --- selection --------------------------------------------------------------------------------------------------------------

/** Ticks one more member, never past the per-call cap. */
export function toggleSelected(
  selected: readonly string[],
  key: string,
  max: number = NUMBERS_PER_CALL,
): string[] {
  if (selected.includes(key)) return selected.filter((s) => s !== key);
  return selected.length >= max ? [...selected] : [...selected, key];
}

// --- editing -----------------------------------------------------------------------------------------------------------------

export interface EditDraft {
  subject: string;
  description: string;
  announce: boolean;
  restrict: boolean;
  joinApproval: boolean;
  memberAddMode: 'all_member_add' | 'admin_add';
}

export const draftOf = (g: WaDeviceGroup): EditDraft => ({
  subject: g.subject ?? '',
  description: g.description ?? '',
  announce: g.announce,
  restrict: g.restrict,
  joinApproval: g.joinApproval,
  memberAddMode: g.memberAddMode,
});

/** The fields of the edit form that differ from the group, ready for the PATCH body; null when nothing changed or the subject is blank. */
export function editPatch(g: WaDeviceGroup, d: EditDraft): UpdateWaDeviceGroupInput | null {
  const subject = d.subject.trim();
  const description = d.description.trim();
  if (!subject) return null;
  const patch: UpdateWaDeviceGroupInput = {};
  if (subject !== (g.subject ?? '')) patch.subject = subject;
  if (description !== (g.description ?? '')) patch.description = description;
  if (d.announce !== g.announce) patch.announce = d.announce;
  if (d.restrict !== g.restrict) patch.restrict = d.restrict;
  if (d.joinApproval !== g.joinApproval) patch.joinApproval = d.joinApproval;
  if (d.memberAddMode !== g.memberAddMode) patch.memberAddMode = d.memberAddMode;
  return Object.keys(patch).length > 0 ? patch : null;
}

// --- who may do what -------------------------------------------------------------------------------------------------------

/**
 * What a row offers. A group the number left is kept read-only (D5); a number that is not an admin of the group cannot change it (the
 * API would refuse with WA_GROUP_NOT_ADMIN: the button is shown disabled with the reason instead of failing after the click).
 */
export function rowAccess(
  g: Pick<WaDeviceGroup, 'left' | 'isAdmin'>,
  perms: GroupPerms,
  online: boolean,
) {
  const live = !g.left && online;
  return {
    /** Anything at all reaches WhatsApp only while the number is online and in the group. */
    live,
    /** Admin-only changes: subject, description, settings, picture, members, requests, link. */
    canAdminister: perms.manage && live && g.isAdmin,
    /** The reason the manage buttons are off, for the hint. */
    blockedBy: g.left ? 'left' : !online ? 'offline' : !g.isAdmin ? 'notAdmin' : null,
    canLeave: perms.leave && live,
    /** Members can be read from the stored roster even while offline. */
    canSeeMembers: perms.manage,
  } as const;
}

/** The badges of a row, in the order drawn. */
export function rowBadges(
  g: WaDeviceGroup,
): Array<'admin' | 'notAdmin' | 'left' | 'announce' | 'restrict' | 'approval'> {
  const out: Array<'admin' | 'notAdmin' | 'left' | 'announce' | 'restrict' | 'approval'> = [];
  if (g.left) out.push('left');
  else out.push(g.isAdmin ? 'admin' : 'notAdmin');
  if (g.announce) out.push('announce');
  if (g.restrict) out.push('restrict');
  if (g.joinApproval) out.push('approval');
  return out;
}

// --- picture --------------------------------------------------------------------------------------------------------------

/** What the picker accepts, before any upload (the API checks the bytes again). */
export function checkPicture(
  file: { type: string; size: number },
  max: number,
  types: readonly string[],
): 'ok' | 'type' | 'size' {
  if (!types.includes(file.type)) return 'type';
  if (file.size > max) return 'size';
  return 'ok';
}

// --- rate limit -----------------------------------------------------------------------------------------------------------

/** "1:05" for 65 seconds, "0:09" for 9. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds left until `iso` (never negative); null when there is no time. */
export function secondsUntil(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - nowMs) / 1000)) : null;
}

/** Copies text; falls back to a hidden textarea where the Clipboard API needs a secure context. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** A name for a member row or a join request: the name, else the number, else a placeholder the caller translates (`null`). */
export const personLabel = (p: { name: string | null; phone: string | null }): string | null =>
  p.name?.trim() || p.phone || null;
