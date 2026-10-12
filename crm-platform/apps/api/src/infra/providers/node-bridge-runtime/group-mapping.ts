/**
 * Pure helpers for personal-number groups (no library import at runtime, so the unit tests need no socket): the metadata to the snapshot
 * the platform stores, WhatsApp's per-person status codes to outcomes, the refusal of a group call to a reason (and whether it is a
 * limit/ban signal that starts the cooldown), and the invite code of a link.
 */
import type { GroupParticipantSnapshot, GroupSnapshot } from './inbound.port';

/** The part of Baileys' `GroupMetadata` read here (structural, so tests need no library). */
export interface RawGroupMetadata {
  id: string;
  addressingMode?: 'pn' | 'lid' | string | null;
  owner?: string | null;
  ownerJid?: string | null;
  subject?: string | null;
  creation?: number | null;
  desc?: string | null;
  restrict?: boolean | null;
  announce?: boolean | null;
  memberAddMode?: boolean | null;
  joinApprovalMode?: boolean | null;
  size?: number | null;
  inviteCode?: string | null;
  participants?: Array<{
    id: string;
    lid?: string | null;
    jid?: string | null;
    name?: string | null;
    notify?: string | null;
    admin?: 'admin' | 'superadmin' | null;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
  }> | null;
}

/** Who the connected number is, in the ids a group may use for it (phone id and anonymous id), device part stripped. */
export interface SelfIds {
  jid: string | null;
  lid: string | null;
}

/** Members kept on a snapshot. */
export const ROSTER_MAX = 1024;

/** `1234@s.whatsapp.net`, `1234:7@s.whatsapp.net`, `1234:7` -> `1234` */
export const jidUser = (jid: string): string => jid.split('@')[0]!.split(':')[0]!;
/** The id without its device part (`1234:7@s.whatsapp.net` -> `1234@s.whatsapp.net`). */
export const bareDevice = (jid: string): string => {
  const [user, domain] = jid.split('@');
  return domain ? `${user!.split(':')[0]}@${domain}` : user!.split(':')[0]!;
};
/** The bare group id: `120363...@g.us` -> `120363...`. */
export const bareGroupId = (jid: string): string => jid.replace(/@g\.us$/, '');
/** The id WhatsApp wants for a group, from a bare id or a full one. */
export const toGroupJid = (g: string): string =>
  g.endsWith('@g.us') ? g : `${g.replace(/[^\d-]/g, '')}@g.us`;
/** `@<token>` text WhatsApp draws as a tag for a mention of this id. */
export const mentionToken = (jid: string): string => `@${jidUser(jid)}`;

/**
 * Is this string the id of a group and not a phone number? A group id is bare digits with a dash (old ids) or longer than any phone number
 * (E.164 allows 15 digits; modern group ids are 18). A send that was meant for a person never has either.
 */
export function looksLikeGroupId(to: string): boolean {
  if (to.endsWith('@g.us')) return true;
  if (to.includes('@')) return false;
  return /^\d+-\d+$/.test(to) || to.replace(/\D+/g, '').length > 15;
}

const isPhoneJid = (j: string) => j.endsWith('@s.whatsapp.net');
const isLidJid = (j: string) => j.endsWith('@lid');

function participantOf(
  p: NonNullable<RawGroupMetadata['participants']>[number],
): GroupParticipantSnapshot {
  const phoneId = p.jid && isPhoneJid(p.jid) ? p.jid : isPhoneJid(p.id) ? p.id : null;
  const lidId = p.lid && isLidJid(p.lid) ? p.lid : isLidJid(p.id) ? p.id : null;
  const admin =
    p.admin === 'superadmin' || p.isSuperAdmin
      ? 'superadmin'
      : p.admin === 'admin' || p.isAdmin
        ? 'admin'
        : null;
  return {
    jid: p.id,
    phone: phoneId ? jidUser(phoneId).replace(/\D+/g, '') || null : null,
    lid: lidId ? jidUser(lidId) : null,
    name: p.name || p.notify || null,
    admin,
  };
}

/** Does this member entry stand for the connected number? */
export function isSelf(p: GroupParticipantSnapshot, self: SelfIds): boolean {
  const selfUser = self.jid ? jidUser(self.jid) : null;
  const selfLid = self.lid ? jidUser(self.lid) : null;
  return (
    (selfUser !== null && (p.phone === selfUser || jidUser(p.jid) === selfUser)) ||
    (selfLid !== null && (p.lid === selfLid || jidUser(p.jid) === selfLid))
  );
}

/** The platform's snapshot of a group read from WhatsApp. */
export function toSnapshot(g: RawGroupMetadata, self: SelfIds): GroupSnapshot {
  const all = (g.participants ?? []).map(participantOf);
  const me = all.find((p) => isSelf(p, self));
  return {
    jid: g.id,
    groupId: bareGroupId(g.id),
    subject: g.subject ?? null,
    description: g.desc ?? null,
    size: g.size ?? (all.length || null),
    isAdmin: me?.admin != null,
    announce: g.announce === true,
    restrict: g.restrict === true,
    joinApproval: g.joinApprovalMode === true,
    memberAddMode: g.memberAddMode === false ? 'admin_add' : 'all_member_add',
    owner: g.ownerJid ?? g.owner ?? null,
    creation:
      typeof g.creation === 'number' && g.creation > 0
        ? new Date(g.creation * 1000).toISOString()
        : null,
    addressingMode: g.addressingMode === 'lid' ? 'lid' : g.addressingMode === 'pn' ? 'pn' : null,
    inviteCode: g.inviteCode || null,
    participants: all.slice(0, ROSTER_MAX),
  };
}

/** Does any of these ids stand for the connected number? (A `group-participants.update` lists ids, not members.) */
export function includesSelf(ids: string[], self: SelfIds): boolean {
  const user = self.jid ? jidUser(self.jid) : null;
  const lid = self.lid ? jidUser(self.lid) : null;
  return ids.some((id) => {
    const u = jidUser(id);
    return (user !== null && u === user) || (lid !== null && u === lid);
  });
}

// --- per-person results ------------------------------------------------------------------------------------------------------

export type ParticipantChange = 'add' | 'remove' | 'promote' | 'demote';
export type ParticipantOutcome =
  | 'ok'
  | 'already_member'
  | 'not_member'
  | 'not_on_whatsapp'
  | 'privacy_blocked'
  | 'not_allowed'
  | 'group_full'
  | 'failed';

/**
 * What WhatsApp's status code for one person means for the action asked. `200` is done. On an add: 403 is their privacy setting (the
 * number is not in their contacts), 404 is a number not on WhatsApp, 409 is already in, 419 is a full group. On the other actions 404 and
 * 409 mean the person is not in the group.
 */
export function participantOutcome(change: ParticipantChange, status: string): ParticipantOutcome {
  const code = String(status).trim();
  if (code === '200' || code === '') return 'ok';
  if (code === '419') return 'group_full';
  if (change === 'add') {
    if (code === '403') return 'privacy_blocked';
    if (code === '404') return 'not_on_whatsapp';
    if (code === '409') return 'already_member';
    return 'failed';
  }
  if (code === '403' || code === '401') return 'not_allowed';
  if (code === '404' || code === '409') return 'not_member';
  return 'failed';
}

// --- refusals ----------------------------------------------------------------------------------------------------------------

/** Why a group call failed, in the terms the API maps to its error codes. */
export type GroupFailureReason =
  | 'not_admin'
  | 'not_found'
  | 'limit_reached'
  | 'bad_invite'
  /** WhatsApp said forbidden: usually removed from the group, or a limit/ban signal. Starts the cooldown. */
  | 'forbidden'
  /** WhatsApp's own rate limit (`rate-overlimit`, 429). Starts the cooldown. */
  | 'whatsapp_rate_limited'
  | 'unknown';

/** WhatsApp's refusal of an IQ: Baileys throws a Boom whose message is the error text and whose `data` is the numeric code. */
export function classifyGroupError(err: unknown, forInvite = false): GroupFailureReason {
  const e = err as { message?: unknown; data?: unknown; output?: { statusCode?: number } } | null;
  const text = String(e?.message ?? '').toLowerCase();
  const data =
    typeof e?.data === 'number' ? e.data : typeof e?.data === 'string' ? Number(e.data) : null;
  const code = data ?? e?.output?.statusCode ?? null;
  if (text.includes('rate-overlimit') || text.includes('rate limit') || code === 429)
    return 'whatsapp_rate_limited';
  if (
    forInvite &&
    (text.includes('gone') ||
      text.includes('not-found') ||
      text.includes('invalid') ||
      code === 410 ||
      code === 404 ||
      code === 400)
  ) {
    return 'bad_invite';
  }
  if (text.includes('resource-limit') || text.includes('full') || code === 419)
    return 'limit_reached';
  if (text.includes('not-authorized') || text.includes('not-allowed') || code === 401)
    return 'not_admin';
  if (text.includes('forbidden') || code === 403) return 'forbidden';
  if (
    text.includes('item-not-found') ||
    text.includes('not-found') ||
    text.includes('gone') ||
    code === 404 ||
    code === 410
  )
    return 'not_found';
  return 'unknown';
}

/** Reasons that look like a limit or ban signal: the device's group operations pause (the cooldown). A plain "not admin" never does. */
export const COOLDOWN_REASONS: ReadonlySet<GroupFailureReason> = new Set([
  'forbidden',
  'whatsapp_rate_limited',
]);

// --- invite links ------------------------------------------------------------------------------------------------------------

/** The code of a `chat.whatsapp.com` link, or of a bare code; null when it is neither. Mirrors `parseWaGroupInviteCode` in @crm/contracts. */
export function inviteCodeOf(input: string): string | null {
  const t = input.trim();
  const m = /^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]+)\/?(?:\?.*)?$/i.exec(
    t,
  );
  const code = m ? m[1]! : t;
  return /^[A-Za-z0-9]{10,40}$/.test(code) ? code : null;
}
