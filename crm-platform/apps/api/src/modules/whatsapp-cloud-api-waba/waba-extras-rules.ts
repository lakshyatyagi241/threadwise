/** Pure rules for the number extras (TW-WABA-023, 025, 026): no database, no network. */
import { WABA_FREE_CONVERSATIONS_PER_MONTH, type WabaConversations } from '@crm/contracts';

const BAD_SUFFIXES = [
  '.com',
  '.org',
  '.net',
  '.in',
  '.co',
  '.io',
  '.me',
  '.info',
  '.biz',
  '.app',
  '.dev',
  '.xyz',
  '.shop',
  '.store',
  '.online',
  '.site',
];

/**
 * Meta's handle rules as Reference mirrored them: 3 to 24 characters of lowercase letters, numbers, `.` and `_`; at least one letter;
 * no leading or trailing dot and no `..`; not starting with `www`; not ending like a web address. Returns the reason, or null when
 * the handle is acceptable. Checked before any call to Meta.
 */
export function usernameProblem(handle: string): string | null {
  const u = handle.trim().toLowerCase();
  if (u.length < 3 || u.length > 24 || !/^[a-z0-9._]+$/.test(u)) {
    return 'A username is 3 to 24 characters: lowercase letters, numbers, . and _.';
  }
  if (!/[a-z]/.test(u)) return 'A username must contain at least one letter.';
  if (u.startsWith('.') || u.endsWith('.') || u.includes('..')) {
    return 'A username cannot start or end with a dot, or have two dots in a row.';
  }
  if (u.startsWith('www')) return 'A username cannot start with "www".';
  if (BAD_SUFFIXES.some((s) => u.endsWith(s))) {
    return 'A username cannot end like a web address (.com, .org and so on).';
  }
  return null;
}

/** Up to five valid, distinct handles: Meta's reserved one first, then the brand name joined, dotted and underscored. */
export function usernameSuggestions(reserved: string | null, brand: string | null): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const u = (raw ?? '').trim().toLowerCase();
    if (u && !out.includes(u) && usernameProblem(u) === null) out.push(u);
  };
  add(reserved);
  const words = (brand ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length) {
    add(words.join(''));
    add(words.join('.'));
    add(words.join('_'));
  }
  return out.slice(0, 5);
}

export interface UsernameState {
  username: string | null;
  status: 'reserved' | 'approved' | null;
}

/** What `meta_json` holds for the handle. */
export function usernameOf(meta: Record<string, unknown> | null): UsernameState {
  const u = typeof meta?.wa_username === 'string' && meta.wa_username ? meta.wa_username : null;
  const s = meta?.wa_username_status;
  return { username: u, status: u ? (s === 'approved' ? 'approved' : 'reserved') : null };
}

/**
 * The `business_username_update` webhook (TW-WABA-026) as a patch of `meta_json`. A deleted, removed or released status clears the
 * three keys (null here, which the repository keeps as null and the reader treats as none); otherwise the handle and status follow
 * what Meta said, and an unknown status keeps the previous one (or `reserved`).
 */
export function usernameUpdatePatch(
  value: Record<string, unknown>,
  previous: UsernameState,
  now: string,
): Record<string, unknown> | null {
  const named = String(value.username ?? value.requested_username ?? '').trim();
  const raw = String(value.status ?? value.username_status ?? '')
    .trim()
    .toLowerCase();
  if (['deleted', 'removed', 'released'].includes(raw)) {
    return { wa_username: null, wa_username_status: null, wa_username_at: null };
  }
  const status = raw === 'reserved' || raw === 'approved' ? raw : (previous.status ?? 'reserved');
  return {
    ...(named ? { wa_username: named } : {}),
    wa_username_status: status,
    wa_username_at: now,
  };
}

interface AnalyticsPoint {
  conversation_type?: string;
  conversation?: number;
  cost?: number;
}

/**
 * Meta's conversation analytics for the month as the free-allowance card (TW-WABA-023): a data point is free when its type contains
 * FREE, everything else is paid. QUIRK kept from Reference: the allowance is a constant 1000, though Meta moved to per-message pricing
 * on 1 July 2025 and these numbers may be obsolete, so the card is optional and omitted whenever analytics did not answer.
 */
export function conversationsFrom(points: AnalyticsPoint[] | null): WabaConversations | null {
  if (!points) return null;
  let free = 0;
  let paid = 0;
  let cost = 0;
  for (const p of points) {
    const n = Number(p.conversation ?? 0);
    if (
      String(p.conversation_type ?? '')
        .toUpperCase()
        .includes('FREE')
    )
      free += n;
    else paid += n;
    cost += Number(p.cost ?? 0);
  }
  return {
    freeUsed: free,
    freeTotal: WABA_FREE_CONVERSATIONS_PER_MONTH,
    freeLeft: Math.max(0, WABA_FREE_CONVERSATIONS_PER_MONTH - free),
    paid,
    total: free + paid,
    cost: Math.round(cost * 100) / 100,
  };
}
