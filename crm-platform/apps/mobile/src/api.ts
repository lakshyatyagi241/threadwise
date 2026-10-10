import * as SecureStore from 'expo-secure-store';

export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:53000').replace(/\/$/, '');
const KEY = 'threadwise.session';

export type Session = { accessToken: string; refreshToken: string; orgSlug: string };

let session: Session | null = null;
let onExpired: (() => void) | null = null;

export const setOnSessionExpired = (fn: () => void) => (onExpired = fn);
export const getSession = () => session;

/** Media urls are authenticated: resolve against the API and send the bearer token. */
export const mediaSource = (url: string) => ({
  uri: url.startsWith('http') ? url : `${API_BASE}${url}`,
  headers: session ? { Authorization: `Bearer ${session.accessToken}` } : undefined,
});

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  session = raw ? (JSON.parse(raw) as Session) : null;
  return session;
}

export async function saveSession(s: Session | null) {
  session = s;
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(KEY);
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | undefined>; form?: FormData };

const qs = (q?: Opts['query']) => {
  const p = Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== '');
  return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
};

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
export const newId = uuid;

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/v2/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session!.refreshToken }),
      });
      if (!res.ok) return false;
      const t = (await res.json()) as { accessToken: string; refreshToken: string };
      await saveSession({ ...session!, accessToken: t.accessToken, refreshToken: t.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (method !== 'GET') headers['Idempotency-Key'] = uuid();
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}/v2${path}${qs(opts.query)}`, {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });

  if (res.status === 401 && !retried && session && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, opts, true);
    await saveSession(null);
    onExpired?.();
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // The API answers RFC 7807: { title, detail, code }.
    throw new ApiError(json?.detail ?? json?.title ?? json?.message ?? `Request failed (${res.status})`, res.status, json?.code);
  }
  return json as T;
}
