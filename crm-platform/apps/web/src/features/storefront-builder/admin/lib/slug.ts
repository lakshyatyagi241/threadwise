import { STORE_SLUG_MAX } from '@crm/contracts';

/** What the wizard shows while the merchant types a shop name: lower case, accents dropped, words joined by dashes. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, STORE_SLUG_MAX);
}

export const SLUG_FALLBACK = 'your-shop';

/** The slug readout of the create form (the server settles the final one, adding `-2`, `-3` ... when it is taken). */
export function previewSlug(shopName: string): string {
  return slugify(shopName) || SLUG_FALLBACK;
}

/**
 * The address a shop will have once its slug is `nextSlug`, derived from the address it has now (`publicUrl`, as the
 * server computed it for `currentSlug`). A custom domain does not contain the slug and stays as it is; the path form
 * (`/s/<slug>`) and the subdomain form (`<slug>.host`) both swap the slug.
 */
export function previewPublicUrl(publicUrl: string, currentSlug: string, nextSlug: string): string {
  if (!publicUrl || !currentSlug || currentSlug === nextSlug || nextSlug === '') return publicUrl;
  if (publicUrl.endsWith(`/s/${currentSlug}`)) {
    return `${publicUrl.slice(0, publicUrl.length - currentSlug.length)}${nextSlug}`;
  }
  try {
    const url = new URL(publicUrl);
    const parts = url.hostname.split('.');
    if (parts[0] === currentSlug) {
      url.hostname = [nextSlug, ...parts.slice(1)].join('.');
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    /* not an absolute address: leave it */
  }
  return publicUrl;
}

/** The built-in address of a new shop when the server has not told us one: this origin plus `/s/<slug>`. */
export function pathModeUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${slug}`;
}
