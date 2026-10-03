export const CATALOGUE_PATH = '/admin/marketplace';

/**
 * The console routes `/admin/marketplace/new`, `/categories`, `/requests` and `/usage` sit beside the listing route `/:ref`, and a static
 * route wins over a dynamic one. A listing whose slug is one of those words is reachable by its uuid only, so its links use the uuid.
 */
export const RESERVED_REFS: ReadonlySet<string> = new Set([
  'new',
  'categories',
  'requests',
  'usage',
]);

/** The address of a listing's page: its slug, or its uuid when the slug is a reserved word. */
export function listingHref(app: { slug: string; id: string }): string {
  return `${CATALOGUE_PATH}/${RESERVED_REFS.has(app.slug) ? app.id : app.slug}`;
}
