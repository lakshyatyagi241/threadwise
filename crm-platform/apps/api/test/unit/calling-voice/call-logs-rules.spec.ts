import { describe, expect, it } from 'vitest';
import {
  addDays,
  callLogStatus,
  dayInZone,
  dayWindow,
  eachDay,
  isAnswered,
  isMissed,
  isValidTimeZone,
  likePattern,
  logWindow,
  phoneSearch,
  startOfDayInZone,
  timelineNote,
} from '../../../src/modules/calling-voice/call-logs.rules';
import { toLogRow } from '../../../src/modules/calling-voice/call-logs.service';

const NOW = new Date('2026-10-13T10:30:00Z');
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe('how a call reads in the log (Reference mapStatus)', () => {
  const s = (status: string, durationSec: number, endReason: string | null = null) =>
    callLogStatus({ status, durationSec, endReason });

  it('failed, completed, declined, no answer and in progress', () => {
    expect(s('failed', 0, 'NO_PERMISSION')).toBe('failed');
    expect(s('failed', 12)).toBe('failed');
    expect(s('ended', 42, 'COMPLETED')).toBe('completed');
    expect(s('ended', 0, 'REJECTED')).toBe('declined');
    expect(s('ended', 0, 'declined')).toBe('declined');
    expect(s('ended', 0, 'NO_ANSWER')).toBe('no-answer');
    expect(s('ended', 0, null)).toBe('no-answer');
    // Reference stored Meta's own failures as ended, so the log shows them as no answer.
    expect(s('ended', 0, 'FAILED')).toBe('no-answer');
    for (const live of ['ringing', 'connecting', 'active']) expect(s(live, 0)).toBe('in-progress');
  });

  it('a declined call that somehow has talk time is completed (the duration wins)', () => {
    expect(s('ended', 3, 'REJECTED')).toBe('completed');
  });
});

describe('answered and missed (the KPI definitions)', () => {
  it('answered: ended with talk time', () => {
    expect(isAnswered({ status: 'ended', durationSec: 1 })).toBe(true);
    expect(isAnswered({ status: 'ended', durationSec: 0 })).toBe(false);
    expect(isAnswered({ status: 'active', durationSec: 30 })).toBe(false);
  });

  it('missed: a customer call that finished with no talk time; a call we placed is never "missed"', () => {
    const base = { direction: 'USER_INITIATED', status: 'ended', durationSec: 0 };
    expect(isMissed(base)).toBe(true);
    expect(isMissed({ ...base, status: 'failed' })).toBe(true);
    expect(isMissed({ ...base, status: 'ringing' })).toBe(false);
    expect(isMissed({ ...base, durationSec: 5 })).toBe(false);
    expect(isMissed({ ...base, direction: 'BUSINESS_INITIATED' })).toBe(false);
  });
});

describe('time zones and days', () => {
  it('knows valid and invalid zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('finds the day an instant falls on in a zone', () => {
    const t = new Date('2026-10-13T20:00:00Z');
    expect(dayInZone(t, 'UTC')).toBe('2026-10-13');
    expect(dayInZone(t, 'Asia/Kolkata')).toBe('2026-10-14');
    expect(dayInZone(t, 'America/Los_Angeles')).toBe('2026-10-13');
  });

  it('starts a day where the zone does, DST included', () => {
    expect(startOfDayInZone('2026-10-14', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-13T18:30:00.000Z',
    );
    // The clocks go back in Los Angeles on 2026-11-01: that day is 25 hours long.
    const a = startOfDayInZone('2026-11-01', 'America/Los_Angeles');
    const b = startOfDayInZone('2026-11-02', 'America/Los_Angeles');
    expect(a.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect((b.getTime() - a.getTime()) / 3_600_000).toBe(25);
  });

  it('adds days across month ends and counts them', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});

describe('the window of the log', () => {
  it('defaults to the last 30 days and has no upper bound (Reference)', () => {
    const w = logWindow({}, NOW);
    expect(w.end).toBeNull();
    expect(NOW.getTime() - w.start.getTime()).toBe(30 * 86_400_000);
  });

  it('knows the three presets', () => {
    expect(NOW.getTime() - logWindow({ range: '24h' }, NOW).start.getTime()).toBe(86_400_000);
    expect(NOW.getTime() - logWindow({ range: '7d' }, NOW).start.getTime()).toBe(7 * 86_400_000);
  });

  it('a custom range is whole days in the caller zone, end exclusive', () => {
    const w = logWindow({ from: '2026-10-01', to: '2026-10-03', tz: 'Asia/Kolkata' }, NOW);
    expect(w.start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(w.end?.toISOString()).toBe('2026-10-03T18:30:00.000Z');
  });

  it('from alone runs to today; to alone starts 29 days earlier', () => {
    expect(logWindow({ from: '2026-10-10' }, NOW).end?.toISOString()).toBe(
      '2026-10-14T00:00:00.000Z',
    );
    expect(logWindow({ to: '2026-10-30' }, NOW).start.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('refuses a backwards range, a range over a year and an unknown zone', () => {
    expect(code(() => logWindow({ from: '2026-10-05', to: '2026-10-01' }, NOW))).toBe(
      'CALL_RANGE_INVALID',
    );
    expect(code(() => logWindow({ from: '2025-01-01', to: '2026-10-01' }, NOW))).toBe(
      'CALL_RANGE_INVALID',
    );
    expect(code(() => logWindow({ tz: 'Nowhere/Land' }, NOW))).toBe('CALL_RANGE_INVALID');
  });
});

describe('the days of the analytics', () => {
  it('a preset counts today and the days before it', () => {
    const w = dayWindow({ range: '7d' }, NOW);
    expect(w.toDay).toBe('2026-10-13');
    expect(w.fromDay).toBe('2026-10-07');
    expect(eachDay(w.fromDay, w.toDay)).toHaveLength(7);
    expect(w.end.toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });

  it('24h is today alone, and the default is 30 days', () => {
    const one = dayWindow({ range: '24h' }, NOW);
    expect(one.fromDay).toBe(one.toDay);
    expect(eachDay(dayWindow({}, NOW).fromDay, dayWindow({}, NOW).toDay)).toHaveLength(30);
  });

  it('today is the caller zone’s today', () => {
    const late = new Date('2026-10-13T22:00:00Z');
    expect(dayWindow({ range: '7d', tz: 'Asia/Kolkata' }, late).toDay).toBe('2026-10-14');
  });
});

describe('search text', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('searches the numbers only for three digits or more', () => {
    expect(phoneSearch('+91 98111')).toBe('9198111');
    expect(phoneSearch('ab')).toBeNull();
    expect(phoneSearch('Priya 12')).toBeNull();
  });
});

describe('what the timeline says', () => {
  it('passes on Meta’s end status and nothing else of a terminate payload', () => {
    const payload = { status: 'COMPLETED', session: { sdp: 'v=0 secret' }, from: '919811100001' };
    expect(timelineNote('terminate', payload)).toBe('COMPLETED');
    expect(timelineNote('connect', payload)).toBeNull();
    expect(JSON.stringify(timelineNote('connect', payload))).not.toContain('sdp');
  });

  it('keeps short failure messages, drops who did it, and describes a stored recording', () => {
    expect(timelineNote('dial_failed', { message: 'Permission denied', by: 7 })).toBe(
      'Permission denied',
    );
    expect(timelineNote('dial_sent', { to: '9198', by: 7 })).toBeNull();
    expect(timelineNote('reject_sent', { reason: 'REJECTED' })).toBe('REJECTED');
    expect(timelineNote('recording_stored', { size: 2048, mime: 'audio/webm' })).toBe(
      'audio/webm, 2048 B',
    );
    expect(timelineNote('accept_failed', { message: 'x'.repeat(500) })).toHaveLength(200);
    expect(timelineNote('anything', null)).toBeNull();
  });
});

describe('the row of the log', () => {
  const row = {
    uuid: '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11',
    direction: 'USER_INITIATED',
    log_status: 'completed',
    duration_sec: '65',
    from_phone: '919811100001',
    to_phone: '919800000000',
    started_at: '2026-10-13T09:00:00Z',
    has_recording: true,
  };

  it('puts the customer and our number on the right sides for each direction', () => {
    const inbound = toLogRow(row);
    expect(inbound).toMatchObject({
      direction: 'inbound',
      customerPhone: '919811100001',
      ourPhone: '919800000000',
      durationSec: 65,
      hasRecording: true,
    });
    const outbound = toLogRow({ ...row, direction: 'BUSINESS_INITIATED' });
    expect(outbound).toMatchObject({
      direction: 'outbound',
      customerPhone: '919800000000',
      ourPhone: '919811100001',
    });
  });
});
