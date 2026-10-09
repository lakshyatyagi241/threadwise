import type { ImportedRequest } from './form-model';

/** The cURL import on the list hands its result to the New screen through the tab's session storage (a route change has no state). */
const KEY = 'api-library:import';

/** The import read from storage once (null: none). Undefined until read; reset by a new stash. */
let taken: ImportedRequest | null | undefined;

export function stashImport(req: ImportedRequest): boolean {
  taken = undefined;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(req));
    return true;
  } catch {
    return false;
  }
}

/**
 * The stashed import, read once and removed from storage; later calls return the same value. Stable between calls, so it can be a
 * `useSyncExternalStore` snapshot (the server snapshot is null, which keeps hydration identical).
 */
export function peekImport(): ImportedRequest | null {
  if (taken !== undefined) return taken;
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const v = raw === null ? null : (JSON.parse(raw) as ImportedRequest);
    taken = v !== null && typeof v?.url === 'string' && typeof v?.method === 'string' ? v : null;
  } catch {
    taken = null;
  }
  return taken;
}
