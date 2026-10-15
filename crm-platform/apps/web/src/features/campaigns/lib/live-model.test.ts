import { describe, expect, it } from 'vitest';
import type { CampaignDetail, CampaignLive } from '@crm/contracts';
import {
  DETAIL_POLL_AT_REST_MS,
  DETAIL_POLL_IN_FLIGHT_MS,
  LIVE_POLL_MS,
  detailInterval,
  freshest,
  isInFlight,
  liveInterval,
  waiting,
} from './live-model';

const counts = (over: Partial<CampaignDetail['campaign']['counts']> = {}) => ({
  recipients: 10,
  sent: 4,
  delivered: 3,
  read: 2,
  failed: 1,
  replies: 0,
  clicks: 0,
  ...over,
});
const rates = { delivered: 30, read: 66.7, replies: 0, clicks: 0, failed: 10 };
const detail = {
  campaign: { status: 'running', counts: counts() },
  rates,
} as unknown as CampaignDetail;
const live = (over: Partial<CampaignLive> = {}) =>
  ({
    status: 'running',
    inFlight: true,
    counts: counts({ sent: 6 }),
    queued: 3,
    processing: 1,
    rates,
    failures: [],
    failureSummary: [],
    fetchedAt: '2026-10-14T12:00:00.000Z',
    ...over,
  }) as CampaignLive;

describe('what is still moving', () => {
  it('a scheduled or running campaign is in flight; every other status is at rest', () => {
    expect(['scheduled', 'running'].map(isInFlight)).toEqual([true, true]);
    expect(['draft', 'paused', 'completed', 'failed', 'cancelled'].some(isInFlight)).toBe(false);
    expect(isInFlight(undefined)).toBe(false);
  });
});

describe('the poll cadence', () => {
  it('the live read repeats every 12 seconds until the server says the campaign is at rest, then stops', () => {
    expect(liveInterval(undefined)).toBe(LIVE_POLL_MS);
    expect(liveInterval({ inFlight: true })).toBe(LIVE_POLL_MS);
    expect(liveInterval({ inFlight: false })).toBe(false);
    expect(LIVE_POLL_MS).toBe(12_000);
  });

  it('the heavy detail read is slower, and slower again at rest', () => {
    expect(detailInterval('running')).toBe(DETAIL_POLL_IN_FLIGHT_MS);
    expect(detailInterval('completed')).toBe(DETAIL_POLL_AT_REST_MS);
    expect(DETAIL_POLL_IN_FLIGHT_MS).toBeLessThan(DETAIL_POLL_AT_REST_MS);
  });
});

describe('which numbers are shown', () => {
  it('a live read newer than the detail wins and brings queued and processing', () => {
    const f = freshest(detail, 1_000, live(), 2_000);
    expect(f).toMatchObject({ status: 'running', queued: 3, processing: 1 });
    expect(f.counts.sent).toBe(6);
    expect(f.fetchedAt).toBe('2026-10-14T12:00:00.000Z');
  });

  it('a detail read newer than the live read wins, so late replies are never hidden behind the last live numbers', () => {
    const f = freshest(detail, 5_000, live({ inFlight: false, status: 'completed' }), 2_000);
    expect(f.counts.sent).toBe(4);
    expect(f.queued).toBeNull();
    expect(f.fetchedAt).toBeNull();
  });

  it('with no live read yet, the detail is shown', () => {
    expect(freshest(detail, 1_000, undefined, 0).status).toBe('running');
  });
});

describe('what is waiting', () => {
  it('names the queued and the sending-now counts that are not zero, and nothing before a live read', () => {
    expect(waiting({ queued: 3, processing: 1 })).toEqual([
      ['queued', 3],
      ['processing', 1],
    ]);
    expect(waiting({ queued: 0, processing: 2 })).toEqual([['processing', 2]]);
    expect(waiting({ queued: 0, processing: 0 })).toEqual([]);
    expect(waiting({ queued: null, processing: null })).toEqual([]);
  });
});
