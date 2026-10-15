import { isHelpAgentNavBlocked, isHelpAgentRouteDisabled } from '@crm/contracts';

/**
 * Where the Help assistant may be and may go (docs/specs/help-agent-assistant.md section 6.2). Same-origin app routes only: never
 * another site, never the operator screens, the API, sign-in/out or the public pages, and never the screens where customer text
 * lives (the inbox, team chat, support threads).
 */

export type NavVerdict =
  { ok: true; path: string } | { ok: false; reason: 'external' | 'blocked_route' | 'bad_url' };

/** Whether the assistant may open `target` (a path or a URL) from a page on `origin`. */
export function checkNavigation(target: string, origin: string): NavVerdict {
  let url: URL;
  try {
    url = new URL(target, origin);
  } catch {
    return { ok: false, reason: 'bad_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'bad_url' };
  if (url.origin !== origin) return { ok: false, reason: 'external' };
  if (isHelpAgentNavBlocked(url.pathname)) return { ok: false, reason: 'blocked_route' };
  return { ok: true, path: url.pathname };
}

/** Whether the assistant may be used, or keep running, on this page. */
export function assistantAllowedOn(pathname: string): boolean {
  return !isHelpAgentRouteDisabled(pathname) && !isHelpAgentNavBlocked(pathname);
}
