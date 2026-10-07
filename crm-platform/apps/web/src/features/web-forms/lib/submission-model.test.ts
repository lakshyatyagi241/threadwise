import { describe, expect, it } from 'vitest';
import { FORM_SUBMISSION_REASONS, FORM_SUBMISSION_STATUSES } from '@crm/contracts';
import {
  EMPTY_VIEW,
  answerView,
  canDelete,
  canRetry,
  csvFileName,
  endOfDayIso,
  exportInput,
  hasReason,
  isFiltered,
  listFilters,
  reasonKey,
  startOfDayIso,
  statusTone,
  tabFromParam,
  viewFromParams,
  viewToParams,
} from './submission-model';

describe('statusTone', () => {
  it('has a tone for every status', () => {
    for (const s of FORM_SUBMISSION_STATUSES) {
      expect(['neutral', 'success', 'warning', 'danger']).toContain(statusTone(s));
    }
  });
  it('marks waiting as warning and failed as danger', () => {
    expect(statusTone('needs_review')).toBe('warning');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('created')).toBe('success');
  });
});

describe('reasonKey', () => {
  it('passes known codes, flags unknown ones and ignores empty', () => {
    for (const r of FORM_SUBMISSION_REASONS) expect(reasonKey(r)).toBe(r);
    expect(reasonKey('brand_new_code')).toBe('unknown');
    expect(reasonKey(null)).toBeNull();
    expect(reasonKey('')).toBeNull();
  });
  it('knows which statuses carry a reason', () => {
    expect(hasReason('spam')).toBe(true);
    expect(hasReason('created')).toBe(false);
  });
});

describe('answerView', () => {
  it('formats arrays, booleans, numbers and nulls', () => {
    expect(answerView(['a', 'b'])).toEqual({ type: 'text', text: 'a, b' });
    expect(answerView([])).toEqual({ type: 'empty' });
    expect(answerView(true)).toEqual({ type: 'boolean', value: true });
    expect(answerView(false)).toEqual({ type: 'boolean', value: false });
    expect(answerView(0)).toEqual({ type: 'text', text: '0' });
    expect(answerView(null)).toEqual({ type: 'empty' });
    expect(answerView('  ')).toEqual({ type: 'empty' });
  });
  it('keeps markup as plain text and keeps line breaks', () => {
    expect(answerView('<img src=x onerror=1>\nline 2')).toEqual({
      type: 'text',
      text: '<img src=x onerror=1>\nline 2',
    });
  });
});

describe('day range', () => {
  it('covers the whole local day', () => {
    const from = new Date(startOfDayIso('2026-03-05')!);
    const to = new Date(endOfDayIso('2026-03-05')!);
    expect([from.getHours(), from.getMinutes(), from.getDate()]).toEqual([0, 0, 5]);
    expect([to.getHours(), to.getMinutes(), to.getSeconds(), to.getDate()]).toEqual([
      23, 59, 59, 5,
    ]);
    expect(to.getTime() - from.getTime()).toBeGreaterThan(23 * 3_600_000);
  });
  it('rejects things that are not a real day', () => {
    expect(startOfDayIso('2026-02-31')).toBeUndefined();
    expect(endOfDayIso('nope')).toBeUndefined();
    expect(startOfDayIso('')).toBeUndefined();
  });
});

describe('tabs and filters', () => {
  it('maps the tab param and falls back to all', () => {
    expect(tabFromParam('spam')).toBe('spam');
    expect(tabFromParam('needs_attention')).toBe('needs_attention');
    expect(tabFromParam('x')).toBe('all');
    expect(tabFromParam(null)).toBe('all');
  });
  it('round-trips the view through the query string, dropping defaults', () => {
    expect(viewToParams(EMPTY_VIEW).toString()).toBe('');
    const view = {
      tab: 'spam',
      status: 'failed',
      q: 'ann',
      from: '2026-01-02',
      to: '2026-01-03',
    } as const;
    const p = viewToParams({ ...view, q: ' ann ' });
    expect(p.get('q')).toBe('ann');
    expect(viewFromParams(p)).toEqual(view);
  });
  it('ignores a bad status or date in the URL', () => {
    expect(viewFromParams(new URLSearchParams('status=zzz&from=2026-13-01'))).toEqual(EMPTY_VIEW);
  });
  it('builds list filters without empty keys', () => {
    expect(listFilters(EMPTY_VIEW)).toEqual({});
    const f = listFilters({ ...EMPTY_VIEW, tab: 'needs_attention', q: 'a', from: '2026-01-01' });
    expect(f.tab).toBe('needs_attention');
    expect(f.q).toBe('a');
    expect(f.from).toMatch(/Z$/);
    expect('to' in f).toBe(false);
  });
  it('knows when a view is filtered', () => {
    expect(isFiltered(EMPTY_VIEW)).toBe(false);
    expect(isFiltered({ ...EMPTY_VIEW, q: 'x' })).toBe(true);
  });
});

describe('exportInput', () => {
  it('maps the spam tab to the spam status and carries the range', () => {
    expect(exportInput({ ...EMPTY_VIEW, tab: 'spam' })).toEqual({ status: 'spam' });
    expect(exportInput({ ...EMPTY_VIEW, status: 'paid', to: '2026-01-03' })?.status).toBe('paid');
  });
  it('refuses the needs-attention group, which is two statuses', () => {
    expect(exportInput({ ...EMPTY_VIEW, tab: 'needs_attention' })).toBeNull();
    expect(exportInput({ ...EMPTY_VIEW, tab: 'needs_attention', status: 'failed' })).toEqual({
      status: 'failed',
    });
  });
  it('never sends the search text', () => {
    expect(exportInput({ ...EMPTY_VIEW, q: 'ann' })).toEqual({});
  });
});

describe('retry and delete', () => {
  it('retries only needs_review and failed with answers kept', () => {
    for (const s of FORM_SUBMISSION_STATUSES) {
      expect(canRetry(s, false)).toBe(s === 'needs_review' || s === 'failed' || s === 'spam');
    }
    expect(canRetry('failed', true)).toBe(false);
  });
  it('deletes only answers that still exist', () => {
    expect(canDelete(false)).toBe(true);
    expect(canDelete(true)).toBe(false);
  });
});

describe('csvFileName', () => {
  const day = new Date('2026-05-06T10:00:00Z');
  it('uses the served name, stripped of paths', () => {
    expect(csvFileName('a.csv', 'X')).toBe('a.csv');
    expect(csvFileName('..\\evil/name', 'X')).toBe('..evilname.csv');
  });
  it('falls back to the form name and the date', () => {
    expect(csvFileName(null, 'Contact us!', day)).toBe('contact-us-submissions-2026-05-06.csv');
    expect(csvFileName('', '', day)).toBe('form-submissions-2026-05-06.csv');
  });
});
