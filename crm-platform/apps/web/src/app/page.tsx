import { redirect } from 'next/navigation';
import { getOperatorSession, getSession, homePathFor } from '@/lib/auth/server';

/**
 * The home router (WD-AUTH-011): a signed-in visitor goes to their landing page, a platform operator to the
 * console, a lapsed session is refreshed first, and everyone else to sign-in.
 */
export default async function Home() {
  const { session, expired } = await getSession();
  if (session) redirect(homePathFor(session));
  if (expired) redirect('/api/auth/refresh?next=/');
  const operator = await getOperatorSession();
  if (operator.session) redirect('/admin');
  redirect('/login');
}
