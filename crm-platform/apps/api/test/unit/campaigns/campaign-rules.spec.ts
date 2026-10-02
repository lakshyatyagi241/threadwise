import { describe, expect, it } from 'vitest';
import {
  advanceRecurring,
  assignVariants,
  cleanNumbers,
  csvSafe,
  dueAtUtc,
  expiresBeforeSend,
  isNewer,
  localDateTimeToUtc,
  mediaColumnFor,
  msUntilWindowOpens,
  normalizeCustomMessage,
  parseCsv,
  parseManualNumbers,
  pct,
  reconciledStatus,
  retryOutcome,
  withinSendWindow,
} from '../../../src/modules/campaigns/campaign-rules';

describe('normalizeCustomMessage', () => {
  it('turns named tokens into positional ones in order of first appearance, with the map', () => {
    expect(
      normalizeCustomMessage('Hi {{first_name}}, order {{order_id}} for {{first_name}}', null),
    ).toEqual({
      body: 'Hi {{1}}, order {{2}} for {{1}}',
      map: { '1': 'first_name', '2': 'order_id' },
    });
  });

  it('leaves a body with no named token, and the map it came with, alone', () => {
    expect(normalizeCustomMessage('Hi {{1}}', { '1': 'name' })).toEqual({
      body: 'Hi {{1}}',
      map: { '1': 'name' },
    });
    expect(normalizeCustomMessage('', null)).toEqual({ body: '', map: null });
  });

  it('a mixed body numbers the bare number as its own literal slot', () => {
    expect(normalizeCustomMessage('{{name}} {{7}}', null)).toEqual({
      body: '{{1}} {{2}}',
      map: { '1': 'name', '2': '7' },
    });
  });
});

describe('audience inputs', () => {
  it('splits typed numbers on whitespace, commas and semicolons', () => {
    expect(parseManualNumbers('9198 1111111,\n9198222222;  +91 98 3333 3333')).toEqual([
      '9198',
      '1111111',
      '9198222222',
      '+91',
      '98',
      '3333',
      '3333',
    ]);
  });

  it('keeps digits, drops numbers under 8 digits and duplicates', () => {
    expect(cleanNumbers(['+91 98123-45678', '919812345678', '1234567', 'abc'])).toEqual([
      '919812345678',
    ]);
  });

  it('reads a CSV with a header: phone by header, other columns as attributes under both spellings', () => {
    const csv =
      'Name,country_code,Promo Code,phone\nAarav,91,SAVE10,9812345678\nPriya,91,,9898765432\n';
    const { numbers, attrsByPhone } = parseCsv(csv);
    expect(numbers).toEqual(['9812345678', '9898765432']);
    expect(attrsByPhone.get('9812345678')).toEqual({
      name: 'Aarav',
      country_code: '91',
      'promo code': 'SAVE10',
      promo_code: 'SAVE10',
    });
    // Empty cells are not attributes.
    expect(attrsByPhone.get('9898765432')).toEqual({ name: 'Priya', country_code: '91' });
  });

  it('a file without a header has its phone in the first column', () => {
    expect(parseCsv('9812345678\n9898765432').numbers).toEqual(['9812345678', '9898765432']);
  });

  it('handles quoted cells with commas', () => {
    const { numbers, attrsByPhone } = parseCsv('name,phone\n"Rao, Asha",9812345678');
    expect(numbers).toEqual(['9812345678']);
    expect(attrsByPhone.get('9812345678')).toEqual({ name: 'Rao, Asha' });
  });
});

describe('mediaColumnFor', () => {
  it('maps the three allowed kinds and refuses the rest', () => {
    expect(mediaColumnFor('https://x.test/a.PNG?x=1')).toBe('custom_image');
    expect(mediaColumnFor('https://x.test/a.jpeg')).toBe('custom_image');
    expect(mediaColumnFor('https://x.test/a.mp4')).toBe('custom_video');
    expect(mediaColumnFor('https://x.test/a.docx')).toBe('custom_document');
    expect(mediaColumnFor('https://x.test/a.mp3')).toBeNull();
    expect(mediaColumnFor('https://x.test/a')).toBeNull();
  });
});

describe('schedule', () => {
  it('reads the date and time in the campaign zone', () => {
    expect(dueAtUtc('2026-10-05', '09:00:00', 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-10-05T03:30:00.000Z',
    );
    expect(dueAtUtc(null, '09:00', 'UTC')).toBeNull();
  });

  it('refuses an end date at or before the send moment, only for scheduled and recurring', () => {
    const base = {
      sendDate: '2026-10-05',
      sendTime: '09:00',
      timezone: 'Asia/Kolkata',
    };
    expect(
      expiresBeforeSend({ ...base, scheduleType: 'scheduled', expiresAtLocal: '2026-10-05T09:00' }),
    ).toBe(true);
    expect(
      expiresBeforeSend({ ...base, scheduleType: 'recurring', expiresAtLocal: '2026-10-04T10:00' }),
    ).toBe(true);
    expect(
      expiresBeforeSend({ ...base, scheduleType: 'scheduled', expiresAtLocal: '2026-10-06T09:00' }),
    ).toBe(false);
    expect(
      expiresBeforeSend({ ...base, scheduleType: 'now', expiresAtLocal: '2026-10-04T10:00' }),
    ).toBe(false);
    expect(localDateTimeToUtc('2026-10-05T09:00', 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-10-05T03:30:00.000Z',
    );
  });

  it('advances a recurring campaign by one cadence and keeps the wall-clock time', () => {
    const c = {
      scheduleType: 'recurring',
      repeatUntil: null,
      sendDate: '2026-01-31',
      sendTime: '09:00:00',
    };
    expect(advanceRecurring({ ...c, repeatInterval: 'daily' })).toEqual({
      sendDate: '2026-02-01',
      sendTime: '09:00',
    });
    expect(advanceRecurring({ ...c, repeatInterval: 'weekly' })).toEqual({
      sendDate: '2026-02-07',
      sendTime: '09:00',
    });
    // Monthly never overflows: Jan 31 is Feb 28, not Mar 3.
    expect(advanceRecurring({ ...c, repeatInterval: 'monthly' })).toEqual({
      sendDate: '2026-02-28',
      sendTime: '09:00',
    });
  });

  it('stops a recurring campaign past repeatUntil, or without a cadence', () => {
    const c = { scheduleType: 'recurring', sendDate: '2026-01-31', sendTime: '09:00' };
    expect(
      advanceRecurring({ ...c, repeatInterval: 'weekly', repeatUntil: '2026-02-06' }),
    ).toBeNull();
    expect(
      advanceRecurring({ ...c, repeatInterval: 'weekly', repeatUntil: '2026-02-07' }),
    ).not.toBeNull();
    expect(advanceRecurring({ ...c, repeatInterval: null, repeatUntil: null })).toBeNull();
    expect(
      advanceRecurring({
        scheduleType: 'scheduled',
        repeatInterval: 'daily',
        repeatUntil: null,
        sendDate: '2026-01-01',
        sendTime: '09:00',
      }),
    ).toBeNull();
  });
});

describe('send window', () => {
  // 2026-10-05 12:00 UTC is 17:30 in Kolkata.
  const noon = new Date('2026-10-05T12:00:00Z');

  it('is judged on the clock of the campaign zone', () => {
    expect(withinSendWindow(noon, 'Asia/Kolkata', '09:00', '18:00')).toBe(true);
    expect(withinSendWindow(noon, 'UTC', '13:00', '18:00')).toBe(false);
  });

  it('may run past midnight, and equal ends mean all day', () => {
    expect(withinSendWindow(new Date('2026-10-05T23:30:00Z'), 'UTC', '22:00', '06:00')).toBe(true);
    expect(withinSendWindow(new Date('2026-10-05T03:00:00Z'), 'UTC', '22:00', '06:00')).toBe(true);
    expect(withinSendWindow(noon, 'UTC', '22:00', '06:00')).toBe(false);
    expect(withinSendWindow(noon, 'UTC', '09:00', '09:00')).toBe(true);
  });

  it('says how long until the window opens', () => {
    expect(msUntilWindowOpens(noon, 'UTC', '13:00')).toBe(60 * 60_000);
    expect(msUntilWindowOpens(noon, 'UTC', '09:00')).toBe(21 * 60 * 60_000);
  });
});

describe('retryOutcome', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const base = { maxAttempts: 3, backoffSec: 60, now };

  it('retries with exponential backoff while attempts remain', () => {
    const first = retryOutcome({ ...base, attemptsBefore: 0, error: 'network' });
    expect(first).toMatchObject({ attempts: 1, final: false });
    expect(first.nextAttemptAt?.getTime()).toBe(now.getTime() + 60_000);
    const second = retryOutcome({ ...base, attemptsBefore: 1, error: 'network' });
    expect(second.nextAttemptAt?.getTime()).toBe(now.getTime() + 120_000);
  });

  it('gives up at the cap, with no next attempt', () => {
    expect(retryOutcome({ ...base, attemptsBefore: 2, error: 'network' })).toEqual({
      attempts: 3,
      nextAttemptAt: null,
      final: true,
    });
  });

  it('caps the backoff at an hour', () => {
    const r = retryOutcome({
      ...base,
      attemptsBefore: 8,
      maxAttempts: 20,
      backoffSec: 600,
      error: 'x',
    });
    expect(r.nextAttemptAt?.getTime()).toBe(now.getTime() + 3_600_000);
  });

  it('spaces the Meta ecosystem throttle hours apart, tries it twice, and stamps it at the global cap', () => {
    const err =
      '(#131049) This message was not delivered to maintain healthy ecosystem engagement.';
    const first = retryOutcome({ ...base, attemptsBefore: 0, error: err });
    expect(first.final).toBe(false);
    expect(first.nextAttemptAt?.getTime()).toBe(now.getTime() + 21_600_000);
    expect(retryOutcome({ ...base, attemptsBefore: 1, error: err })).toEqual({
      attempts: 3,
      nextAttemptAt: null,
      final: true,
    });
  });
});

describe('assignVariants', () => {
  it('honours the split exactly, whatever the shuffle', () => {
    const ids = Array.from({ length: 10 }, (_, i) => i);
    for (const seed of [0.1, 0.5, 0.9]) {
      const v = assignVariants(ids, 30, () => seed);
      expect([...v.values()].filter((x) => x === 'A')).toHaveLength(3);
      expect(v.size).toBe(10);
    }
    expect([...assignVariants(ids, 0, Math.random).values()].every((x) => x === 'B')).toBe(true);
    expect([...assignVariants(ids, 100, Math.random).values()].every((x) => x === 'A')).toBe(true);
  });
});

describe('status machine', () => {
  it('only moves forward; failed is the top and the same status repeats', () => {
    expect(isNewer('sent', 'delivered')).toBe(true);
    expect(isNewer('read', 'delivered')).toBe(false);
    expect(isNewer('delivered', 'delivered')).toBe(true);
    expect(isNewer('delivered', 'failed')).toBe(true);
    expect(isNewer('failed', 'sent')).toBe(false);
  });

  it('finishes a campaign whose recipients are all resolved, and fails one that sent nothing', () => {
    expect(reconciledStatus('running', { sent: 3, terminal: 5, total: 5 })).toBe('completed');
    expect(reconciledStatus('scheduled', { sent: 0, terminal: 5, total: 5 })).toBe('failed');
    expect(reconciledStatus('running', { sent: 3, terminal: 4, total: 5 })).toBeNull();
    expect(reconciledStatus('draft', { sent: 3, terminal: 5, total: 5 })).toBeNull();
    expect(reconciledStatus('running', { sent: 0, terminal: 0, total: 0 })).toBeNull();
  });
});

describe('small helpers', () => {
  it('pct and csvSafe', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBe(0);
    expect(csvSafe('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvSafe('+91')).toBe("'+91");
    expect(csvSafe('Asha')).toBe('Asha');
  });
});
