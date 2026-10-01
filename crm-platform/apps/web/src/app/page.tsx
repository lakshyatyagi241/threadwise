import { redirect } from 'next/navigation';
import { getSession, homePathFor } from '@/lib/auth/server';

/** The home router (TW-AUTH-011): a signed-in visitor goes to their landing page, a guest to sign-in. */
export default async function Home() {
  const { session, expired } = await getSession();
  if (!session) redirect(expired ? '/api/auth/refresh?next=/' : '/login');
  redirect(homePathFor(session));
}
