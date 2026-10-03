import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { loadSiteContent } from '@/features/marketing-site-cms/public/load';
import { pageMetadata } from '@/features/marketing-site-cms/site/page-meta';
import { SiteFrame } from '@/features/marketing-site-cms/site/site-frame';
import { SitePage } from '@/features/marketing-site-cms/site/site-page';
import { getOperatorSession, getSession, homePathFor } from '@/lib/auth/server';

export const generateMetadata = (): Promise<Metadata> => pageMetadata('home');

/**
 * The home router (TW-AUTH-011): a signed-in visitor goes to their landing page, a platform operator to the
 * console and a lapsed session is refreshed first. A guest sees the marketing homepage (TW-CMS-001), or is sent to
 * sign-in while the operator has the homepage switched off.
 */
export default async function Home() {
  const { session, expired } = await getSession();
  if (session) redirect(homePathFor(session));
  if (expired) redirect('/api/auth/refresh?next=/');
  const operator = await getOperatorSession();
  if (operator.session) redirect('/admin');
  const content = await loadSiteContent();
  if (!content.homepageEnabled) redirect('/login');
  return (
    <SiteFrame content={content} current="/">
      <SitePage page="home" content={content} />
    </SiteFrame>
  );
}
