/**
 * Where archive objects live: `archive/<stream>/<yyyy-mm>/<org>.ndjson.gz` per workspace, plus `_manifest.json` for the month.
 * The writer (PartitionArchiver), the reader (ArchiveReader) and the workspace erase all build keys here so they cannot disagree.
 */
export const ARCHIVE_ROOT = 'archive/';

export const prefixOf = (stream: string, month: string): string =>
  `${ARCHIVE_ROOT}${stream}/${month}/`;

export const manifestKeyOf = (stream: string, month: string): string =>
  `${prefixOf(stream, month)}_manifest.json`;

/** How many nights in a row a month failed (written by the archiver, removed when the month is dropped). Not an archive object. */
export const failureKeyOf = (stream: string, month: string): string =>
  `${prefixOf(stream, month)}_failures.json`;

export const objectKeyOf = (stream: string, month: string, org: string | number): string =>
  `${prefixOf(stream, month)}${org}.ndjson.gz`;

/**
 * What the workspace erase puts in `storage_purge_queue` to have a workspace's archive objects deleted. It is not an object key: the
 * purge worker recognises it and calls ArchiveEraser. It has the `<area>/<orgId>/...` shape the queue's ownership check requires.
 */
export const archiveEraseMarker = (orgId: number): string => `archive-erase/${orgId}/all`;

/** The workspace named by an erase marker, or null when `key` is not one. */
export function archiveEraseMarkerOrg(key: string): number | null {
  const m = /^archive-erase\/([1-9]\d{0,17})\/all$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** `archive/an_events/2026-08/7.ndjson.gz` -> `{ stream, month, org }`, or null for a manifest or anything else. */
export function parseObjectKey(key: string): { stream: string; month: string; org: string } | null {
  const m = /^archive\/([a-z][a-z0-9_]*)\/(\d{4}-(?:0[1-9]|1[0-2]))\/(\d{1,18})\.ndjson\.gz$/.exec(
    key,
  );
  return m ? { stream: m[1]!, month: m[2]!, org: m[3]! } : null;
}
