import { WEBHOOK_ALL, WEBHOOK_URL_MAX } from '@crm/contracts';

/** A form's events: `*` stands for all of them; picking every one by hand is the same as `*`. */
export function eventsForSave(picked: readonly string[], all: readonly string[]): string[] {
  if (picked.length === 0 || picked.includes(WEBHOOK_ALL)) return [WEBHOOK_ALL];
  return picked.length === all.length ? [WEBHOOK_ALL] : [...picked];
}

/** What is wrong with the address, before the server is asked (the server still has the last word). */
export function urlProblem(raw: string): 'empty' | 'tooLong' | 'notHttps' | 'invalid' | null {
  const v = raw.trim();
  if (!v) return 'empty';
  if (v.length > WEBHOOK_URL_MAX) return 'tooLong';
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return 'invalid';
  }
  return url.protocol === 'https:' ? null : 'notHttps';
}

/** The host and the start of the path, with the rest hidden: a path often carries a token. */
export function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname === '/' ? '' : u.pathname;
    return path.length > 18 ? `${u.host}${path.slice(0, 14)}…` : `${u.host}${path}`;
  } catch {
    return raw.slice(0, 32);
  }
}

export type Health = 'off' | 'failing' | 'healthy' | 'idle';

export function healthOf(w: {
  active: boolean;
  isFailing: boolean;
  successCount: number;
  failureCount: number;
}): Health {
  if (!w.active) return 'off';
  if (w.isFailing) return 'failing';
  return w.successCount + w.failureCount === 0 ? 'idle' : 'healthy';
}
