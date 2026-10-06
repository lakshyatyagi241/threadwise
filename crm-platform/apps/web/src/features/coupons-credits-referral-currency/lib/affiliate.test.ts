import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { downloadReferralsCsv, fetchReferrals } from '../api';
import {
  FIRST_PAGE,
  affiliateErrorKind,
  barPercent,
  bucketLabel,
  buildListQuery,
  chartData,
  copyReferralLink,
  createDebouncer,
  currentCursor,
  defaultBucketFor,
  deltaTone,
  formatDelta,
  initialFilters,
  initials,
  money,
  pageIndexOf,
  popCursor,
  pushCursor,
  rewardLine,
  runExport,
  shortTxId,
  shownRange,
  withRange,
} from './affiliate';
import { fileNameFromDisposition } from './download';

describe('affiliate range and bucket (WD-CPN-035)', () => {
  it('starts on the last 90 days with its default bucket', () => {
    expect(initialFilters()).toEqual({ range: '90d', bucket: 'weekly', q: '' });
  });

  it('picks daily for 7 days, weekly up to 90 days and monthly for all time', () => {
    expect(defaultBucketFor('7d')).toBe('daily');
    expect(defaultBucketFor('30d')).toBe('weekly');
    expect(defaultBucketFor('90d')).toBe('weekly');
    expect(defaultBucketFor('all')).toBe('monthly');
  });

  it('moves to the default bucket of a new range and keeps the search', () => {
    const f = withRange({ range: '90d', bucket: 'daily', q: 'gmail' }, 'all');
    expect(f).toEqual({ range: 'all', bucket: 'monthly', q: 'gmail' });
  });

  it('always sends the selected bucket, so Daily on 90 days really asks for daily', () => {
    const q = buildListQuery({ range: '90d', bucket: 'daily', q: '' }, undefined);
    expect(q.bucket).toBe('daily');
    for (const range of ['7d', '30d', '90d', 'all'] as const)
      for (const bucket of ['daily', 'weekly', 'monthly'] as const)
        expect(buildListQuery({ range, bucket, q: '' }, undefined)).toMatchObject({
          range,
          bucket,
        });
  });

  it('sends a trimmed search and the cursor, and no empty search', () => {
    expect(buildListQuery({ range: '30d', bucket: 'weekly', q: '  gmail ' }, 'abc')).toMatchObject({
      q: 'gmail',
      cursor: 'abc',
      limit: 20,
    });
    expect(
      buildListQuery({ range: '30d', bucket: 'weekly', q: '   ' }, undefined).q,
    ).toBeUndefined();
  });
});

describe('affiliate query on the wire', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('', {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="affiliate-history-1.csv"' },
        });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('puts range, bucket, search and cursor in the list request', async () => {
    await fetchReferrals(buildListQuery({ range: '7d', bucket: 'daily', q: 'a b' }, 'cur')).catch(
      () => undefined,
    );
    const url = new URL(calls[0]!, 'http://x');
    expect(url.pathname).toBe('/api/v2/me/referrals');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      range: '7d',
      bucket: 'daily',
      q: 'a b',
      cursor: 'cur',
      limit: '20',
    });
  });

  it('asks for the CSV of the range only, never the search (WD-CPN-036)', async () => {
    const out = await downloadReferralsCsv('7d');
    expect(calls[0]).toBe('/api/v2/me/referrals/export?range=7d');
    expect(out.fileName).toBe('affiliate-history-1.csv');
  });
});

describe('affiliate money and figures', () => {
  it('shows hundredths of the platform currency with one formatter', () => {
    expect(money(250, 'USD', 'en')).toBe('$2.50');
    expect(money(0, 'USD', 'en')).toBe('$0.00');
    expect(money(123456, 'USD', 'en')).toBe('$1,234.56');
  });

  it('falls back to the code for a currency the browser does not know', () => {
    expect(money(250, 'ZZZZ', 'en')).toBe('ZZZZ 2.50');
  });

  it('writes the delta with a sign and colours it', () => {
    expect(formatDelta(12)).toBe('+12%');
    expect(formatDelta(-5)).toBe('-5%');
    expect(formatDelta(0)).toBe('0%');
    expect([deltaTone(12), deltaTone(-5), deltaTone(0)]).toEqual(['success', 'danger', 'neutral']);
  });

  it('says the programme pays nothing when the reward is 0, and counts messages only when billing per message', () => {
    const base = { messagePriceMinor: 50 };
    expect(rewardLine({ ...base, rewardMinor: 0, payPerMessage: true })).toEqual({ kind: 'none' });
    expect(rewardLine({ ...base, rewardMinor: 250, payPerMessage: false })).toEqual({
      kind: 'reward',
      rewardMinor: 250,
      messages: null,
    });
    expect(rewardLine({ ...base, rewardMinor: 250, payPerMessage: true })).toEqual({
      kind: 'reward',
      rewardMinor: 250,
      messages: 5,
    });
  });

  it('draws a top-code bar proportional to the leader and never under 2 percent', () => {
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 0)).toBe(2);
  });

  it('builds initials from the first and last word, else from the email, else a question mark', () => {
    expect(initials({ refereeName: 'Ada Byron Lovelace', refereeEmail: null })).toBe('AL');
    expect(initials({ refereeName: 'ada', refereeEmail: null })).toBe('A');
    expect(initials({ refereeName: null, refereeEmail: 'sam.jones@x.co' })).toBe('SC');
    expect(initials({ refereeName: ' ', refereeEmail: null })).toBe('?');
  });

  it('shortens a wallet entry id to its first block', () => {
    expect(shortTxId('1f3a9c2e-1111-4111-8111-111111111111')).toBe('1f3a9c2e');
  });
});

describe('affiliate paging', () => {
  it('shows a-b of total for the page on screen', () => {
    expect(shownRange(0, 20, 20, 45)).toEqual({ from: 1, to: 20, total: 45 });
    expect(shownRange(2, 20, 5, 45)).toEqual({ from: 41, to: 45, total: 45 });
  });

  it('has no range for an empty table, so the footer is hidden', () => {
    expect(shownRange(0, 20, 0, 0)).toBeNull();
  });

  it('walks forward and back over the cursor stack without leaving the first page', () => {
    let s = FIRST_PAGE;
    expect(currentCursor(s)).toBeUndefined();
    s = pushCursor(s, 'c1');
    s = pushCursor(s, 'c2');
    expect([currentCursor(s), pageIndexOf(s)]).toEqual(['c2', 2]);
    s = popCursor(s);
    expect(currentCursor(s)).toBe('c1');
    s = popCursor(popCursor(s));
    expect([currentCursor(s), pageIndexOf(s)]).toEqual([undefined, 0]);
  });
});

describe('affiliate chart data', () => {
  const volume = [
    { start: '2026-03-02', signups: 2, creditsMinor: 500 },
    { start: '2026-03-09', signups: 0, creditsMinor: 0 },
  ];

  it('maps each bucket to a label and the two series', () => {
    expect(chartData(volume, 'weekly', 'en')).toEqual({
      labels: ['Mar 2', 'Mar 9'],
      signups: [2, 0],
      creditsMinor: [500, 0],
    });
  });

  it('labels months with the year', () => {
    expect(bucketLabel('2026-03-01', 'monthly', 'en')).toBe('Mar 2026');
  });
});

describe('affiliate search debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends only the last text, 250 ms after the last keystroke', () => {
    const fire = vi.fn();
    const d = createDebouncer<string>(250, fire);
    d.push('g');
    vi.advanceTimersByTime(200);
    d.push('gm');
    vi.advanceTimersByTime(200);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('gm');
  });

  it('sends nothing once cancelled (Reset)', () => {
    const fire = vi.fn();
    const d = createDebouncer<string>(250, fire);
    d.push('gm');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe('affiliate copy link and export', () => {
  it('copies the link and says so', async () => {
    const copy = vi.fn(async () => true);
    const notify = vi.fn();
    expect(await copyReferralLink('https://x.test/signup?ref=ABC', { copy, notify })).toBe(true);
    expect(copy).toHaveBeenCalledWith('https://x.test/signup?ref=ABC');
    expect(notify).toHaveBeenCalledWith('copied');
  });

  it('says the copy failed when the clipboard refuses or throws', async () => {
    const notify = vi.fn();
    await copyReferralLink('l', { copy: async () => false, notify });
    await copyReferralLink('l', {
      copy: async () => {
        throw new Error('denied');
      },
      notify,
    });
    expect(notify.mock.calls).toEqual([['copyFailed'], ['copyFailed']]);
  });

  it('exports the current range, saves the file and says its name', async () => {
    const blob = new Blob(['x']);
    const download = vi.fn(async () => ({ blob, fileName: 'a.csv' }));
    const save = vi.fn();
    const notify = vi.fn();
    await runExport('30d', { download, save, notify });
    expect(download).toHaveBeenCalledWith('30d');
    expect(save).toHaveBeenCalledWith(blob, 'a.csv');
    expect(notify).toHaveBeenCalledWith('exported', 'a.csv');
  });

  it('reports a failed export by kind and saves nothing', async () => {
    const save = vi.fn();
    const notify = vi.fn();
    await runExport('all', {
      download: async () => {
        throw new ApiError(429, ERROR_CODES.RATE_LIMITED, 'slow down');
      },
      save,
      notify,
    });
    expect(save).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('failed', 'rateLimited');
  });

  it('reads the file name from the download header', () => {
    expect(fileNameFromDisposition('attachment; filename="x.csv"', 'f.csv')).toBe('x.csv');
    expect(fileNameFromDisposition(null, 'f.csv')).toBe('f.csv');
  });
});

describe('affiliate errors branch on the problem code, not the wording', () => {
  const err = (status: number, code: string, message = 'whatever') =>
    new ApiError(status, code, message);

  it('maps the stable codes', () => {
    expect(affiliateErrorKind(err(401, ERROR_CODES.UNAUTHENTICATED))).toBe('unauthenticated');
    expect(affiliateErrorKind(err(403, ERROR_CODES.FORBIDDEN))).toBe('forbidden');
    expect(affiliateErrorKind(err(429, ERROR_CODES.RATE_LIMITED))).toBe('rateLimited');
    expect(affiliateErrorKind(err(422, ERROR_CODES.VALIDATION_FAILED))).toBe('validation');
  });

  it('ignores the message text', () => {
    expect(affiliateErrorKind(err(500, 'INTERNAL', 'Forbidden: rate limited'))).toBe('generic');
  });

  it('falls back to the status, and treats a non-API failure as a network problem', () => {
    expect(affiliateErrorKind(err(403, 'UNKNOWN'))).toBe('forbidden');
    expect(affiliateErrorKind(new TypeError('Failed to fetch'))).toBe('network');
  });
});
