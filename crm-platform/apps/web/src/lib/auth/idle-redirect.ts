import { ApiError } from '@/lib/api/errors';
import { loginPath } from './next-path';

/**
 * Where a browser call that was refused for inactivity sends the person: sign-in with the reason and the limit, and
 * the page they were on as `?next=`, exactly like the server layouts do on a full page load (TW-AUTH-033). Null when
 * the error is not an idle timeout. Pure, so the rule is tested without a browser.
 */
export function idleLoginTarget(error: unknown, currentPath: string | null): string | null {
  if (!(error instanceof ApiError) || !error.isIdleTimeout) return null;
  return loginPath(currentPath, { expired: true, idleMinutes: error.idleMinutes });
}

/** The page the browser is on, as a path with its query. */
function here(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Browser-side half of the idle rule. Every staff call goes through the API client, so a session that ended while the
 * page was open takes the person to the sign-in page with the idle notice instead of leaving a screen full of
 * failing requests. Returns true when it started the navigation. Never navigates away from the sign-in pages.
 */
export function redirectOnIdle(error: unknown): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.pathname === '/login') return false;
  const to = idleLoginTarget(error, here());
  if (!to) return false;
  window.location.assign(to);
  return true;
}
