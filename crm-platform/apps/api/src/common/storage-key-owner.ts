/**
 * Who owns a storage key (TI-022). Keys minted per workspace look like `<area>/<orgId>/...`. A key is compared in the form the
 * storage layer will act on: `MediaStorageService` trims it, drops leading slashes and one leading `storage/` before it
 * touches the bucket, so `storage/chat/7/x` and ` /chat/7/x` name the same object as `chat/7/x`.
 */
export function canonicalStorageKey(key: string): string {
  return key
    .trim()
    .replace(/^\/+/, '')
    .replace(/^storage\//, '');
}

/** The workspace id named by a canonical `<area>/<orgId>/...` key, or null when the key does not carry one. */
export function storageKeyOrg(key: string): number | null {
  const m = /^[^/]+\/(\d+)\//.exec(canonicalStorageKey(key));
  return m ? Number(m[1]) : null;
}

/** True only for a key that names this workspace and has no `.` / `..` segment. Used before any destructive storage call. */
export function storageKeyIsOwnedBy(orgId: number, key: string): boolean {
  const canonical = canonicalStorageKey(key);
  if (canonical.split('/').some((s) => s === '.' || s === '..' || s === '')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(canonical)) return false;
  // The org is read from THIS canonical form: `storageKeyOrg` canonicalises again, and "/ /chat/7/x" is " /chat/7/x" after one pass
  // (the object the storage layer acts on) but "chat/7/x" after two.
  const m = /^[^/]+\/(\d+)\//.exec(canonical);
  return m !== null && Number(m[1]) === orgId;
}
