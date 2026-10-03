import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicHome, requestOrigin } from '../api/server';
import { Catalog } from '../components/catalog';
import { Hero } from '../components/hero';
import { ShopFrame } from '../components/shop-frame';
import { shopPath } from '../lib/links';
import { homeMetadata } from '../lib/seo';

/** `?page=` as Reference read it: a whole number from 1, anything else is page 1. */
export function pageParam(raw: string | string[] | undefined): number {
  const n = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The shop's home page (TW-STORE-009). An unknown or disabled shop is a 404. */
export async function ShopHome({ slug, page = 1 }: { slug: string; page?: number }) {
  const home = await getPublicHome(slug, page);
  if (!home) notFound();
  return (
    <ShopFrame shop={home.shop} products={home.products}>
      <Hero shop={home.shop} />
      <Catalog key={home.page} home={home} />
    </ShopFrame>
  );
}

export async function shopHomeMetadata(slug: string, page = 1): Promise<Metadata> {
  const home = await getPublicHome(slug, page);
  if (!home) return { title: 'Store', robots: { index: false } };
  const origin = await requestOrigin();
  return homeMetadata(home.shop, `${origin}${shopPath(slug)}${page > 1 ? `?page=${page}` : ''}`);
}
