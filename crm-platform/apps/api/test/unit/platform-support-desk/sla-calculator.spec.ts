import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  businessHoursFor,
  computeSla,
} from '../../../src/modules/platform-support-desk/sla-calculator';

const min = (n: number) => n * 60_000;
const policy = { firstResponseMinutes: 60, resolutionMinutes: 1440, respectBusinessHours: false };

describe('SLA calculator (WD-SUPP-029)', () => {
  const created = new Date('2026-10-05T10:00:00Z');

  it('a 24/7 first-response timer 20 minutes in has about 40 minutes left and is ok', () => {
    const now = new Date(created.getTime() + min(20));
    const r = computeSla(
      { createdAt: created, firstResponseAt: null, resolvedAt: null },
      policy,
      null,
      now,
    );
    expect(r.firstResponse.minutesRemaining).toBe(40);
    expect(r.firstResponse.severity).toBe('ok');
    expect(r.firstResponse.breached).toBe(false);
  });

  it('warns inside the last quarter of the window (threshold max(5, 15))', () => {
    const now = new Date(created.getTime() + min(50));
    const r = computeSla(
      { createdAt: created, firstResponseAt: null, resolvedAt: null },
      policy,
      null,
      now,
    );
    expect(r.firstResponse.minutesRemaining).toBe(10);
    expect(r.firstResponse.severity).toBe('warn');
  });

  it('is a breach with whole, non-negative minutes once overdue', () => {
    const now = new Date(created.getTime() + min(90) + 30_000);
    const r = computeSla(
      { createdAt: created, firstResponseAt: null, resolvedAt: null },
      policy,
      null,
      now,
    );
    expect(r.firstResponse).toMatchObject({ breached: true, minutesOver: 30, severity: 'breach' });
    expect(r.firstResponse.minutesRemaining).toBeNull();
  });

  it('a late first reply stays a breach, an on-time one is met', () => {
    const late = computeSla(
      {
        createdAt: created,
        firstResponseAt: new Date(created.getTime() + min(75)),
        resolvedAt: null,
      },
      policy,
      null,
      new Date(created.getTime() + min(200)),
    );
    expect(late.firstResponse).toMatchObject({
      breached: true,
      minutesOver: 15,
      severity: 'breach',
    });
    const ok = computeSla(
      {
        createdAt: created,
        firstResponseAt: new Date(created.getTime() + min(10)),
        resolvedAt: null,
      },
      policy,
      null,
      new Date(created.getTime() + min(200)),
    );
    expect(ok.firstResponse).toMatchObject({ breached: false, severity: 'met' });
  });

  it('Friday 16:30 plus 120 business minutes lands on Monday 10:30 (workspace zone)', () => {
    const bh = businessHoursFor(null, 'UTC');
    const out = addBusinessMinutes(new Date('2026-10-09T16:30:00Z'), 120, bh);
    expect(out.toISOString()).toBe('2026-10-12T10:30:00.000Z');
  });

  it('uses the workspace time zone for the open window', () => {
    // 09:00-17:00 in Asia/Kolkata (UTC+5:30) is 03:30-11:30 UTC; Friday 11:00 UTC + 60 min -> Monday 04:00 UTC (30 min Friday + 30 min Monday).
    const bh = businessHoursFor(JSON.stringify({ tz: 'Asia/Kolkata' }), null);
    const out = addBusinessMinutes(new Date('2026-10-09T11:00:00Z'), 60, bh);
    expect(out.toISOString()).toBe('2026-10-12T04:00:00.000Z');
  });

  it('a closed day (null) is skipped and bad input falls back to the default week', () => {
    const bh = businessHoursFor({ days: { mon: null } }, null);
    const out = addBusinessMinutes(new Date('2026-10-09T16:30:00Z'), 60, bh);
    expect(out.toISOString()).toBe('2026-10-13T09:30:00.000Z');
    expect(businessHoursFor('not json', 'Not/AZone').tz).toBe('UTC');
  });
});
