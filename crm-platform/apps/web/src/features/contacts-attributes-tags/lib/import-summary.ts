/**
 * What the toast after a finished import says. "Imported 0 contacts." is wrong when the file only refreshed contacts that
 * already existed, so the sentence for updated and for skipped (invalid) rows follows it when they are not zero
 * (WaDesk: "Imported 0 contacts (5 existing contacts updated, 4 invalid rows skipped).").
 */
export type ImportSummaryKey = 'imported' | 'importedUpdated' | 'importedInvalid';

export function importSummaryParts(job: {
  created: number;
  updated: number;
  invalid: number;
}): Array<{ key: ImportSummaryKey; count: number }> {
  const parts: Array<{ key: ImportSummaryKey; count: number }> = [
    { key: 'imported', count: job.created },
  ];
  if (job.updated > 0) parts.push({ key: 'importedUpdated', count: job.updated });
  if (job.invalid > 0) parts.push({ key: 'importedInvalid', count: job.invalid });
  return parts;
}
