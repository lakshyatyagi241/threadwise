import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
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
  return slug ? shopHomeMetadata(slug, pageParam((await searchParams).page)) : {};
}

/**
 * The home router (WD-AUTH-011): a signed-in visitor goes to their landing page, a platform operator to the
 * console, a lapsed session is refreshed first, and everyone else to sign-in. On a shop's own host the root is the
 * shop itself (WD-STORE-021).
 */
export default async function Home({ searchParams }: Props) {
  const shop = await shopForRequestHost();
  if (shop) return <ShopHome slug={shop} page={pageParam((await searchParams).page)} />;
  const { session, expired } = await getSession();
  if (session) redirect(homePathFor(session));
  if (expired) redirect('/api/auth/refresh?next=/');
  const operator = await getOperatorSession();
  if (operator.session) redirect('/admin');
  redirect('/login');
}
