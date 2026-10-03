import 'server-only';
import {
  hostResolveResponseSchema,
  publicHomeSchema,
  publicOrderSchema,
  publicProductPageSchema,
  type PublicHome,
  type PublicOrder,
  type PublicProductPage,
} from '@crm/contracts';
import { headers } from 'next/headers';
import { cache } from 'react';
import type { ZodType } from 'zod';
import { apiBase } from '@/lib/auth/server';

/** Server-side reads of the public shop API. No session is involved: the shop is named by its slug. */
const base = () => `${apiBase()}/v2/store-public`;

async function clientHeaders(): Promise<Record<string, string>> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
  return { Accept: 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) };
}

/** The parsed body, or null when the API says the shop, product or order does not exist (or the shop is disabled). */
async function getPublic<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  const res = await fetch(`${base()}${path}`, {
    cache: 'no-store',
    headers: await clientHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Public shop API answered ${res.status} for ${path.split('?')[0]}`);
  return schema.parse(await res.json());
}

const seg = encodeURIComponent;

// `cache` makes the page and its generateMetadata share one call per request (the API counts a view per call).
export const getPublicHome = cache((slug: string, page: number): Promise<PublicHome | null> =>
  getPublic(`/${seg(slug)}/home?page=${page}`, publicHomeSchema),
);

export const getPublicProduct = cache(
  (slug: string, productSlug: string): Promise<PublicProductPage | null> =>
    getPublic(`/${seg(slug)}/products/${seg(productSlug)}`, publicProductPageSchema),
);

export const getPublicOrder = cache((slug: string, token: string): Promise<PublicOrder | null> =>
  getPublic(`/${seg(slug)}/orders/${seg(token)}`, publicOrderSchema),
);

/**
 * The shop a request host serves (a verified custom domain, TW-STORE-021), or null. Never throws: a failed lookup must not turn
 * the root page of the app into an error page.
 */
export async function resolveShopForHost(host: string): Promise<string | null> {
  const clean = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (!clean) return null;
  try {
    const res = await fetch(`${base()}/host?host=${seg(clean)}`, {
      cache: 'no-store',
      headers: await clientHeaders(),
    });
    if (!res.ok) return null;
    const parsed = hostResolveResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.slug : null;
  } catch {
    return null;
  }
}

/** `https://host` of the current request, for absolute URLs in metadata (the request's own host, so custom domains carry theirs). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto =
    h.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
