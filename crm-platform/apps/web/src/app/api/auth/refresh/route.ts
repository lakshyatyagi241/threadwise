import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from '@/lib/auth/cookies';
import { refreshTokens } from '@/lib/auth/server';

/** Only same-site relative paths, so this cannot be turned into an open redirect. */
function safeNext(value: string | null): string {
  return value && /^\/(?!\/)[\w\-./?=&%]*$/.test(value) ? value : '/dashboard';
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = await cookies();
  const rt = store.get(REFRESH_COOKIE)?.value;
  const tokens = rt ? await refreshTokens(rt) : null;
  if (!tokens) {
    clearSessionCookies(store);
    return NextResponse.redirect(new URL('/login', url));
  }
  setSessionCookies(store, tokens);
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next')), url));
}
