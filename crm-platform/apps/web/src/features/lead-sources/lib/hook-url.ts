/**
 * The public address of a source's hook. The API answers only `hookPath` (`/v2/public/lead-hooks/<token>`), because the browser talks
 * to it through the same-origin proxy and does not know its public origin. The marketplace API, by contrast, returns an absolute
 * `inbound.url`; a `url` on the lead-sources response would make this helper unnecessary (recorded as an API gap).
 *
 * Order: `NEXT_PUBLIC_API_PUBLIC_URL` when set; else the origin of `NEXT_PUBLIC_REALTIME_URL` (this repo's README documents it as the
 * API origin plus `/realtime`); else the path alone with a hint to put the API address in front of it.
 */

export interface HookUrlEnv {
  apiPublicUrl?: string | null;
  realtimeUrl?: string | null;
}

export type HookUrlSource = 'public' | 'realtime' | 'none';

export interface HookUrl {
  /** The full address, or null when the browser cannot tell the API's origin. */
  url: string | null;
  /** What the API answered, always. */
  path: string;
  source: HookUrlSource;
}

const clean = (v: string | null | undefined): string => (v ?? '').trim();

function originOf(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export function leadHookUrl(hookPath: string, env: HookUrlEnv): HookUrl {
  const path = hookPath.startsWith('/') ? hookPath : `/${hookPath}`;
  if (/^https?:\/\//i.test(hookPath)) return { url: hookPath, path: hookPath, source: 'public' };

  const pub = clean(env.apiPublicUrl);
  if (pub) {
    // A public URL may carry a prefix (a reverse proxy mounting the API under /api); keep it, drop trailing slashes.
    const base = pub.replace(/\/+$/, '');
    if (originOf(base)) return { url: `${base}${path}`, path, source: 'public' };
  }
  const realtime = clean(env.realtimeUrl);
  if (realtime) {
    const origin = originOf(realtime);
    if (origin) return { url: `${origin}${path}`, path, source: 'realtime' };
  }
  return { url: null, path, source: 'none' };
}

/**
 * The environment as the server pages read it: runtime variables win over the ones inlined at build, like the app layout does for
 * the realtime address. Only ever called on the server; the pages hand the result to the client components as a prop.
 */
export function hookEnvFromProcess(): HookUrlEnv {
  return {
    apiPublicUrl: process.env.API_PUBLIC_URL ?? process.env.NEXT_PUBLIC_API_PUBLIC_URL ?? null,
    realtimeUrl: process.env.REALTIME_URL ?? process.env.NEXT_PUBLIC_REALTIME_URL ?? null,
  };
}
