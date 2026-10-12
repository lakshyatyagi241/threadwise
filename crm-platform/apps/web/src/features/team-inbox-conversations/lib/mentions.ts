import { WA_DEVICE_GROUP_MENTIONS_MAX, type WaGroupMention } from '@crm/contracts';

/**
 * @mentions in a personal-number group message.
 *
 * What a person types is `@Name`. WhatsApp draws a mention only when the BODY holds `@<the user part of the member's id>` and the
 * member's id is in `mentions`, so `prepareMentions` swaps each picked `@Name` for `@<user>` at send time and sends the members as
 * `mentions: [{ jid, name }]`. The thread then shows `@Name` again from the stored `mentions` (`displayMentions`). Everything here
 * is plain strings: a member's name is never treated as markup.
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces `token` where it stands alone (not followed by more letters or digits, so `@Ann` leaves `@Anna` alone). */
function replaceToken(text: string, token: string, replacement: string): string {
  return text.replace(new RegExp(`${escapeRe(token)}(?![\\p{L}\\p{N}_])`, 'gu'), () => replacement);
}

/** A member the picker offers (`GET /inbox/conversations/:id/group-members`). */
export interface MentionMember {
  jid: string;
  name: string | null;
  /** E.164 (`+digits`); null for a member WhatsApp shows only by an anonymous id. */
  phone: string | null;
}

/** A member the person picked, with the exact token typed into the box. */
export interface PickedMention {
  jid: string;
  name: string;
  /** What the box holds for this member: `@` and the label. */
  token: string;
}

/** The user part of a WhatsApp id: `919876543210@s.whatsapp.net` and `919876543210:12@s.whatsapp.net` give `919876543210`. */
export function jidUser(jid: string): string {
  return (jid.split('@')[0] ?? '').split(':')[0] ?? '';
}

/** What the person sees for a member: the name, else the number, else a short form of the id. */
export function memberLabel(m: MentionMember): string {
  return (m.name?.trim() || m.phone || jidUser(m.jid)).replace(/\s+/g, ' ');
}

/** The `@` the caret is right after, and what was typed since: `@Pri|` gives `{ start: 0, query: 'Pri' }`. null when not in a mention. */
export function activeMention(
  text: string,
  caret: number,
  maxQuery = 40,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // A mention starts at the beginning or after a space: an email address is not one.
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null;
  const query = before.slice(at + 1);
  // A trailing space ends the mention (right after a pick, the caret sits after `@Name `).
  if (query.length > maxQuery || /[\n\r]/.test(query) || /\s$/.test(query)) return null;
  return { start: at, query };
}

/** Puts the picked member into the text in place of `@query` and keeps the caret after it. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  member: MentionMember,
): { text: string; caret: number; picked: PickedMention } {
  const label = memberLabel(member);
  const token = `@${label}`;
  const next = `${text.slice(0, start)}${token} ${text.slice(caret)}`;
  return {
    text: next,
    caret: start + token.length + 1,
    picked: { jid: member.jid, name: label, token },
  };
}

/**
 * The body and the `mentions` of a send. A picked member whose token the person deleted or edited is dropped; the rest are swapped
 * to `@<user>`. At most `WA_DEVICE_GROUP_MENTIONS_MAX`; a repeated member counts once.
 */
export function prepareMentions(
  text: string,
  picked: readonly PickedMention[],
): { body: string; mentions: WaGroupMention[] } {
  let body = text;
  const kept = new Set<string>();
  // Longest tokens first, so `@Ann Lee` is replaced before `@Ann`.
  const ordered = [...picked].sort((a, b) => b.token.length - a.token.length);
  for (const p of ordered) {
    if (kept.has(p.jid) || replaceToken(body, p.token, '') === body) continue;
    if (kept.size >= WA_DEVICE_GROUP_MENTIONS_MAX) break;
    body = replaceToken(body, p.token, `@${jidUser(p.jid)}`);
    kept.add(p.jid);
  }
  // The members are listed in the order they were picked.
  const mentions: WaGroupMention[] = [];
  for (const p of picked) {
    if (!kept.has(p.jid) || mentions.some((m) => m.jid === p.jid)) continue;
    mentions.push({ jid: p.jid, name: p.name.slice(0, 100) });
  }
  return { body, mentions };
}

/** A stored body with `@<user>` shown as `@Name` for the members it mentions (names come from the message's `mentions`). */
export function displayMentions(
  body: string | null,
  mentions: ReadonlyArray<{ jid: string; name?: string | undefined }> | undefined,
): string | null {
  if (body === null || !mentions || mentions.length === 0) return body;
  let out = body;
  for (const m of mentions) {
    const name = m.name?.trim();
    if (!name) continue;
    const user = jidUser(m.jid);
    if (!user) continue;
    out = replaceToken(out, `@${user}`, `@${name}`);
  }
  return out;
}
