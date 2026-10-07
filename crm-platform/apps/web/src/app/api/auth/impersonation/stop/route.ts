import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, clearSessionCookies } from '@/lib/auth/cookies';
import { consolePathFrom } from '@/features/workspaces-teams-tenancy/lib/impersonation';
import { clientIpFrom } from '@/lib/auth/client-ip';
import { isSameOrigin, problem } from '@/lib/auth/proxy';
import { apiBase } from '@/lib/auth/server';

/**
 * POST /api/auth/impersonation/stop: ends the act-as session on the API, then removes the act-as cookie from this browser (page code
 * cannot: it is httpOnly). The operator's own console cookies are a different set and stay. The body carries only where to go next.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return problem(403, 'FORBIDDEN', 'Cross-origin request refused');
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ returnPath: consolePathFrom(null) });

  const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
  const ip = clientIpFrom(req.headers);
  if (ip) headers.set('x-forwarded-for', ip);
  const upstream = await fetch(`${apiBase()}/v2/auth/impersonation/stop`, {
    method: 'POST',
    headers,
    cache: 'no-store',
  });
  // An ended or expired session answers 401: the cookie is dead anyway, so it goes either way.
  if (!upstream.ok && upstream.status !== 401) {
    return problem(upstream.status, 'IMPERSONATION_STOP_FAILED', 'Could not stop the session');
  }
  const json = upstream.ok
    ? ((await upstream.json().catch(() => null)) as { returnUrl?: unknown } | null)
    : null;
  clearSessionCookies(store);
  return NextResponse.json({ returnPath: consolePathFrom(json?.returnUrl) });
}
