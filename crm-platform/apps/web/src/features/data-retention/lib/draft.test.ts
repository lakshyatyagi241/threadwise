import { describe, expect, it } from 'vitest';
import { RETENTION_ITEMS, retentionSpecOf, type RetentionItemView } from '@crm/contracts';
import { draftFromItem, hasImpact, isChanged, summaryOf, valuesOf } from './draft';

function view(
  id: RetentionItemView['id'],
  over: Partial<RetentionItemView> = {},
): RetentionItemView {
  const spec = retentionSpecOf(id);
  return {
    id,
    kind: spec.kind,
    group: spec.group,
    canArchive: spec.canArchive,
    source: 'default',
    liveDays: spec.defaults.liveDays,
    archiveDays: spec.defaults.archiveDays,
    deleteAfterDays: null,
    defaults: spec.defaults,
    limits: { live: spec.live, archive: spec.archive },
    rowVersion: null,
    updatedAt: null,
    applied: true,
    live: { bytes: 0, rows: null, partitions: null, oldestMonth: null },
    archive: null,
    lastRun: null,
    ...over,
  };
}

describe('draftFromItem', () => {
  it('shows an item exactly as it is, the archive "for ever" switch included', () => {
    expect(draftFromItem(view('an_events'))).toEqual({
      liveDays: '60',
      keepForever: true,
      archiveDays: String(retentionSpecOf('an_events').archive.min),
    });
    expect(
      draftFromItem(view('audit_log', { source: 'custom', liveDays: 90, archiveDays: 275 })),
    ).toEqual({ liveDays: '90', keepForever: false, archiveDays: '275' });
  });

  it('starts an item that follows a "keep for ever" policy at the smallest number it allows', () => {
    expect(draftFromItem(view('audit_log', { liveDays: 0 })).liveDays).toBe('7');
  });
});

describe('valuesOf', () => {
  const item = view('audit_log');

  it('turns the text into numbers', () => {
    expect(valuesOf(item, { liveDays: ' 90 ', keepForever: false, archiveDays: '275' })).toEqual({
      values: { liveDays: 90, archiveDays: 275 },
    });
    expect(valuesOf(item, { liveDays: '90', keepForever: true, archiveDays: '5' })).toEqual({
      values: { liveDays: 90, archiveDays: null },
    });
  });

  it('refuses anything that is not a whole number of days', () => {
    for (const bad of ['', 'abc', '1.5', '-3', '1e3']) {
      expect(valuesOf(item, { liveDays: bad, keepForever: true, archiveDays: '5' })).toEqual({
        problem: 'not_a_number',
      });
    }
    expect(valuesOf(item, { liveDays: '90', keepForever: false, archiveDays: '' })).toEqual({
      problem: 'not_a_number',
    });
  });

  it('applies the same limits as the API', () => {
    expect(valuesOf(item, { liveDays: '3', keepForever: true, archiveDays: '5' })).toEqual({
      problem: 'live_out_of_range',
    });
    expect(valuesOf(item, { liveDays: '90', keepForever: false, archiveDays: '0' })).toEqual({
      problem: 'archive_out_of_range',
    });
  });

  it('ignores the archive fields of an item that cannot be archived', () => {
    expect(
      valuesOf(view('security_events'), { liveDays: '90', keepForever: false, archiveDays: 'x' }),
    ).toEqual({ values: { liveDays: 90, archiveDays: null } });
  });

  it('every built-in default, shown as a draft, is a valid save', () => {
    for (const spec of RETENTION_ITEMS) {
      const item = view(spec.id);
      expect(valuesOf(item, draftFromItem(item)), spec.id).toHaveProperty('values');
    }
  });
});

describe('isChanged', () => {
  it('lets a default item be saved as it is, which makes it explicit', () => {
    const item = view('an_events');
    expect(isChanged(item, draftFromItem(item))).toBe(true);
  });

  it('is false for a saved item until a number moves', () => {
    const item = view('audit_log', {
      source: 'custom',
      liveDays: 90,
      archiveDays: 275,
      rowVersion: 2,
    });
    const draft = draftFromItem(item);
    expect(isChanged(item, draft)).toBe(false);
    expect(isChanged(item, { ...draft, archiveDays: '300' })).toBe(true);
    expect(isChanged(item, { ...draft, keepForever: true })).toBe(true);
    expect(isChanged(item, { ...draft, liveDays: 'oops' })).toBe(true);
  });
});

describe('summaryOf', () => {
  it('says when the data is deleted for good', () => {
    expect(summaryOf(view('audit_log'), { liveDays: 90, archiveDays: 275 })).toEqual({
      kind: 'archiveThenDelete',
      live: 90,
      archive: 275,
      total: 365,
    });
    expect(summaryOf(view('audit_log'), { liveDays: 90, archiveDays: null }).kind).toBe(
      'archiveForever',
    );
    expect(summaryOf(view('security_events'), { liveDays: 90, archiveDays: null })).toMatchObject({
      kind: 'noArchive',
      total: 90,
    });
  });
});

describe('hasImpact', () => {
  it('asks for confirmation only when something would be archived or deleted', () => {
    expect(hasImpact({ toArchive: [], toDeleteFromArchive: [], rowsToDelete: null })).toBe(false);
    expect(hasImpact({ toArchive: [], toDeleteFromArchive: [], rowsToDelete: 0 })).toBe(false);
    expect(hasImpact({ toArchive: [1], toDeleteFromArchive: [], rowsToDelete: null })).toBe(true);
    expect(hasImpact({ toArchive: [], toDeleteFromArchive: ['2024-01'], rowsToDelete: null })).toBe(
      true,
    );
    expect(hasImpact({ toArchive: [], toDeleteFromArchive: [], rowsToDelete: 3 })).toBe(true);
  });
});
