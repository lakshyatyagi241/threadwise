import type { SenderHidden } from '@crm/contracts';
import { isUnofficialEngine } from '@/lib/unofficial-whatsapp';

/**
 * Why the "Send from" list has nothing to pick, from the numbers the server left out (`hidden`). The most actionable cause wins: a
 * number that is still connecting or failed can be finished, a disconnected one reconnected, and only then a personal number that the
 * workspace may not use. `none` means the workspace has no number at all.
 */
export type SenderEmptyCause = 'none' | 'pending' | 'error' | 'disconnected' | 'personal_off';

export interface SenderEmpty {
  cause: SenderEmptyCause;
  /** How many numbers that cause covers (0 for `none`). */
  count: number;
  /** The screen that fixes it: the WhatsApp numbers screen, or the personal numbers screen when only personal numbers are involved. */
  href: string;
}

export const NUMBERS_HREF = '/channels/whatsapp';
export const DEVICES_HREF = '/devices';
export const SMS_HREF = '/sms';
export const EMAIL_HREF = '/email';

const matching = (hidden: readonly SenderHidden[], f: (h: SenderHidden) => boolean) =>
  hidden.filter(f);
const sum = (rows: readonly SenderHidden[]) => rows.reduce((n, h) => n + h.count, 0);
/** Only personal numbers are involved: their own screen shows the status; any official number sends the person to the numbers screen. */
const hrefOf = (rows: readonly SenderHidden[]) =>
  rows.length > 0 && rows.every((h) => isUnofficialEngine(h.engine)) ? DEVICES_HREF : NUMBERS_HREF;

/** `sms` is the SMS card: every cause is fixed on the SMS screen. `email` is the Email card: every cause is fixed on the Email screen. */
export function senderEmpty(
  hidden: readonly SenderHidden[] | undefined,
  o: { sms?: boolean; email?: boolean } = {},
): SenderEmpty {
  const list = hidden ?? [];
  const own = o.sms || o.email;
  const fallback = o.sms ? SMS_HREF : o.email ? EMAIL_HREF : NUMBERS_HREF;
  const rowsOf = (reason: SenderHidden['reason']) => matching(list, (h) => h.reason === reason);
  const steps: Array<[SenderHidden['reason'], SenderEmptyCause]> = [
    ['pending', 'pending'],
    ['error', 'error'],
    ['not_connected', 'disconnected'],
    // A personal number that is off cannot be fixed by the workspace: the way forward is an official number.
    ['unofficial_disabled', 'personal_off'],
  ];
  for (const [reason, cause] of steps) {
    const rows = rowsOf(reason);
    if (rows.length === 0) continue;
    return {
      cause,
      count: sum(rows),
      href: own || cause === 'personal_off' ? fallback : hrefOf(rows),
    };
  }
  return { cause: 'none', count: 0, href: fallback };
}

/**
 * The server's `hidden` plus the personal numbers this screen filtered out itself (the entitlement call said the engine is off while the
 * server's list still carried them), so the reason is never lost to a race between the two answers.
 */
export function withClientHidden(
  all: readonly { key: string; engine?: string | null }[] | undefined,
  offered: readonly { key: string }[] | undefined,
  hidden: readonly SenderHidden[] | undefined,
): SenderHidden[] {
  const base = [...(hidden ?? [])];
  if (!all || !offered) return base;
  const keep = new Set(offered.map((s) => s.key));
  const dropped = all.filter(
    (s) =>
      !keep.has(s.key) && (s.engine ? isUnofficialEngine(s.engine) : s.key.startsWith('baileys:')),
  ).length;
  if (dropped === 0) return base;
  const at = base.findIndex((h) => h.engine === 'baileys' && h.reason === 'unofficial_disabled');
  if (at >= 0) base[at] = { ...base[at]!, count: base[at]!.count + dropped };
  else base.push({ engine: 'baileys', reason: 'unofficial_disabled', count: dropped });
  return base;
}

/**
 * The number a screen starts on when the person has only numbers the guided flow cannot send from: the workspace's default, else the
 * first. The guided flow only auto-picks a verified number, so without this the picker stays blank and Next stays blocked.
 */
export function classicFallback<T extends { guided: boolean; isDefault: boolean }>(
  senders: readonly T[],
): T | null {
  if (senders.length === 0 || senders.some((s) => s.guided)) return null;
  return senders.find((s) => s.isDefault) ?? senders[0] ?? null;
}
