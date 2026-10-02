import { logoutStaff } from '@/lib/auth/logout';
import { redirectTo } from '@/lib/auth/proxy';

/**
 * Sign out by address (TW-AUTH-012): bookmarks, links in old emails and the browser's own address bar all reach
 * this, as they did in Reference, where GET and POST both ended the session. It revokes the session on the API,
 * clears the cookies and lands on sign-in. The redirect is relative so it stays on whatever host asked.
 */
async function signOut(req: Request): Promise<Response> {
  await logoutStaff(req);
  return redirectTo('/login', 303);
}

export const GET = signOut;
export const POST = signOut;
