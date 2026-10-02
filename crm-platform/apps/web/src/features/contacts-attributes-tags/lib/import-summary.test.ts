import { describe, expect, it } from 'vitest';
import { importSummaryParts } from './import-summary';

describe('importSummaryParts', () => {
  it('says only what was imported when nothing else happened', () => {
    expect(importSummaryParts({ created: 3, updated: 0, invalid: 0 })).toEqual([
      { key: 'imported', count: 3 },
    ]);
  });

  it('a re-upload that only refreshed contacts does not stop at "Imported 0 contacts."', () => {
    expect(importSummaryParts({ created: 0, updated: 5, invalid: 4 })).toEqual([
      { key: 'imported', count: 0 },
      { key: 'importedUpdated', count: 5 },
      { key: 'importedInvalid', count: 4 },
    ]);
  });
});
