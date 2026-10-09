/**
 * Campaigns, Create is one screen at `/campaigns/create`. Its sender-number select is the switch: a verified Meta (WhatsApp Cloud API)
 * number turns the screen into the guided four-step flow (the "wizard": contacts, groups, segments or CSV, schedule, recurring,
 * retries, the phone-style preview); every other number, and a Meta number that is not verified yet, keeps the classic builder with its
 * own preview. "Verified" is the server's word: `guided` on the sender (`GET /v2/broadcast-wizard/senders`).
 */
export type CreateFlow = 'wizard' | 'classic';

export const CREATE_PATH = '/campaigns/create';

interface SenderLike {
  key: string;
  guided: boolean;
}

/** The flow a number opens: the guided one only for a number the server says is verified. */
export function flowFor(senders: readonly SenderLike[], senderKey: string): CreateFlow {
  return senders.some((s) => s.key === senderKey && s.guided) ? 'wizard' : 'classic';
}

/** The screen's address with the number (`?sender=`) or the guided draft (`?draft=`) it is on. */
export function createPath(o: { sender?: string | null; draft?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (o.draft) q.set('draft', o.draft);
  else if (o.sender) q.set('sender', o.sender);
  const s = q.toString();
  return s === '' ? CREATE_PATH : `${CREATE_PATH}?${s}`;
}

/** The `?sender=` of an address, kept only when it looks like a sender key (`<engine>:<id>`). */
export function senderParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^[a-z0-9_]+:[a-z0-9_-]{1,60}$/i.test(s) ? s : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The `?draft=` of an address, only when it is an id. */
export function draftParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s && UUID.test(s) ? s : '';
}
