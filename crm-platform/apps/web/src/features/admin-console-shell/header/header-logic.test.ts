import { describe, expect, it } from 'vitest';
import type { HealthResponse } from '@crm/contracts';
import { initials, pillFor, timeAgo } from './header-logic';

const snap = (over: Partial<HealthResponse>): HealthResponse => ({
  overall: 'up',
  checks: [
    { key: 'database', state: 'up', value: 'Postgres', detail: '', ping: 1 },
    { key: 'queue', state: 'up', value: 'Redis', detail: '', ping: 1 },
  ],
  queues: [
    { name: 'outbox', pending: 4, failed: 0 },
    { name: 'campaign', pending: 0, failed: 0 },
  ],
  engines: [],
  activity: { messages: 0, aiCalls: 0, conversations: 0, webhooks: 0 },
  throughput: [],
  vitals: {
    nodeVersion: '22',
    appVersion: '1',
    environment: 'test',
    uptimeSeconds: 1,
    memoryRssMb: 1,
    memoryHeapMb: 1,
    diskFreeGb: null,
    diskUsedPct: null,
  },
  ts: '2026-10-01T00:00:00Z',
  ...over,
});

describe('header health pill (TW-ASHELL-006)', () => {
  it('is normal while no queue holds a failed job, whatever is pending', () => {
    expect(pillFor(snap({}))).toEqual({ state: 'ok', stuck: 0 });
  });
  it('counts failed jobs across queues as stuck jobs and goes amber', () => {
    const s = snap({
      queues: [
        { name: 'outbox', pending: 0, failed: 1 },
        { name: 'campaign', pending: 0, failed: 2 },
      ],
    });
    expect(pillFor(s)).toEqual({ state: 'warn', stuck: 3 });
  });
  it('goes red when the database probe is down, ahead of any stuck count', () => {
    const s = snap({
      checks: [{ key: 'database', state: 'down', value: '', detail: '', ping: null }],
      queues: [{ name: 'outbox', pending: 0, failed: 9 }],
    });
    expect(pillFor(s)).toEqual({ state: 'down', stuck: 0 });
  });
  it('reads as normal before the first snapshot arrives', () => {
    expect(pillFor(undefined)).toEqual({ state: 'ok', stuck: 0 });
  });
});

describe('time ago', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  it('words minutes, hours and days in the page language', () => {
    expect(timeAgo('2026-10-01T11:57:00Z', now, 'en')).toBe('3 minutes ago');
    expect(timeAgo('2026-10-01T09:00:00Z', now, 'en')).toBe('3 hours ago');
    expect(timeAgo('2026-09-29T12:00:00Z', now, 'en')).toBe('2 days ago');
  });
  it('never reads as the future and survives a bad date', () => {
    expect(timeAgo('2026-10-02T00:00:00Z', now, 'en')).toBe('now');
    expect(timeAgo('nope', now, 'en')).toBe('now');
  });
});

describe('avatar initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('ana maria lopez')).toBe('AM');
    expect(initials('Vedant')).toBe('V');
  });
  it('falls back to the email name, then to WA', () => {
    expect(initials('', 'sam.k@example.test')).toBe('S');
    expect(initials(null)).toBe('WA');
  });
});
