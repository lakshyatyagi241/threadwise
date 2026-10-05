import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadSiteContent } from '@/features/marketing-site-cms/public/load';
import { pageMetadata } from '@/features/marketing-site-cms/site/page-meta';
import { SiteFrame } from '@/features/marketing-site-cms/site/site-frame';
import { SitePage } from '@/features/marketing-site-cms/site/site-page';
import {
  ShopHome,
  pageParam,
  resolveShopForHost,
  shopHomeMetadata,
} from '@/features/storefront-builder/public';
import { getOperatorSession, getSession, homePathFor } from '@/lib/auth/server';

type Props = { searchParams: Promise<{ page?: string | string[] }> };

/**
 * The shop this request host serves (a verified custom domain or `<slug>.<storefront host>`, WD-STORE-021), else null. The
 * app's own host never serves a shop. WaDesk resolves this before anything else on `/`, so shops keep working whatever the
 * rest of the site does.
 */
async function shopForRequestHost(): Promise<string | null> {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (!host) return null;
  const appHost = process.env.WEB_APP_URL
    ? new URL(process.env.WEB_APP_URL).host.toLowerCase()
    : '';
  if (host === appHost) return null;
  return resolveShopForHost(host);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const slug = await shopForRequestHost();
  return slug ? shopHomeMetadata(slug, pageParam((await searchParams).page)) : pageMetadata('home');
}

/**
 * The home router (WD-AUTH-011): on a shop's own host the root is the shop itself (WD-STORE-021); otherwise a signed-in
 * visitor goes to their landing page, a platform operator to the console and a lapsed session is refreshed first. A
 * guest sees the marketing homepage (WD-CMS-001), or is sent to sign-in while the operator has the homepage switched off.
 */
export default async function Home({ searchParams }: Props) {
  const shop = await shopForRequestHost();
  if (shop) return <ShopHome slug={shop} page={pageParam((await searchParams).page)} />;
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
