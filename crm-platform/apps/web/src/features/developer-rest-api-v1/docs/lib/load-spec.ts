import 'server-only';
import { apiBase } from '@/lib/auth/server';
import { publicApiOrigin } from '@/lib/public-api-origin';
import { buildReference, type ReferenceView } from './spec-model';

/** The page's data: the reference, or the reason there is none. The page renders every one of these, never a blank screen. */
export type DocsData =
  | { status: 'ok'; reference: ReferenceView }
  | { status: 'empty'; reference: ReferenceView }
  | { status: 'unavailable' };

export { publicApiOrigin };

const REVALIDATE_SECONDS = 60;
const TIMEOUT_MS = 5000;

/**
 * Fetches `GET /docs/api.json` from the API (TW-API-150; public, no key) on the server and turns it into the reference. Next caches the
 * answer for a minute, which matches the API's own cache, so the page is cheap and a brand or route change shows within a minute. An
 * unreachable API, a non-200 or a body that is not an OpenAPI object gives `unavailable`; a valid document with no operations gives `empty`.
 */
export async function loadDocs(origin = publicApiOrigin()): Promise<DocsData> {
  try {
    const res = await fetch(`${apiBase()}/docs/api.json`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'unavailable' };
    const spec: unknown = await res.json();
    if (
      typeof spec !== 'object' ||
      spec === null ||
      typeof (spec as { paths?: unknown }).paths !== 'object'
    ) {
      return { status: 'unavailable' };
    }
    const reference = buildReference(spec, origin);
    return { status: reference.endpointCount > 0 ? 'ok' : 'empty', reference };
  } catch {
    return { status: 'unavailable' };
  }
}
