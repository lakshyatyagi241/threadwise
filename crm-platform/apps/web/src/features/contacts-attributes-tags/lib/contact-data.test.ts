import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  callFigures,
  callSearchTerm,
  callsOfContact,
  contactSearchTerm,
  conversationFigures,
  conversationsOfContact,
  dayBefore,
  fallbackFieldLabel,
  formatMoney,
  historyEntryKey,
  historyValueText,
  isNotAvailableToYou,
  phoneDigits,
} from './contact-data';

describe('phone digits and search terms', () => {
  it('keeps only the digits of a phone number', () => {
    expect(phoneDigits('+91 98765-43210')).toBe('919876543210');
    expect(phoneDigits(null)).toBe('');
    expect(phoneDigits('n/a')).toBe('');
  });

  it('searches by phone digits, else e-mail, else name, else nothing', () => {
    const base = { phone: null, email: null, name: null };
    expect(contactSearchTerm({ ...base, phone: '+91 98765 43210', email: 'a@x.test' })).toBe(
      '919876543210',
    );
    expect(contactSearchTerm({ ...base, email: ' a@x.test ', name: 'Asha' })).toBe('a@x.test');
    expect(contactSearchTerm({ ...base, name: ' Asha Rao ' })).toBe('Asha Rao');
    expect(contactSearchTerm(base)).toBeNull();
    // A stub of a number (too few digits) is not searched by: it would match half the workspace.
    expect(contactSearchTerm({ ...base, phone: '123', email: 'a@x.test' })).toBe('a@x.test');
  });

  it('the call log is searched by phone digits or name, never by e-mail', () => {
    expect(callSearchTerm({ phone: '+91 98765 43210', name: 'Asha' })).toBe('919876543210');
    expect(callSearchTerm({ phone: null, name: 'Asha' })).toBe('Asha');
    expect(callSearchTerm({ phone: null, name: ' ' })).toBeNull();
  });
});

describe('keeping only this contact’s rows', () => {
  it('drops conversations that belong to somebody else or to nobody', () => {
    const rows = [
      { id: 'a', contact: { id: 'me', name: 'Me' } },
      { id: 'b', contact: { id: 'other', name: 'Other' } },
      { id: 'c', contact: null },
    ];
    expect(conversationsOfContact(rows, 'me').map((r) => r.id)).toEqual(['a']);
  });

  it('drops calls of other contacts', () => {
    const rows = [
      { id: 'a', contactId: 'me' },
      { id: 'b', contactId: 'other' },
      { id: 'c', contactId: null },
    ];
    expect(callsOfContact(rows, 'me').map((r) => r.id)).toEqual(['a']);
  });
});

describe('conversation figures', () => {
  it('counts conversations, adds the unread and takes the latest instants', () => {
    const f = conversationFigures([
      { unreadCount: 2, lastInboundAt: '2026-03-01T10:00:00.000Z', lastOutboundAt: null },
      {
        unreadCount: 1,
        lastInboundAt: '2026-03-05T10:00:00.000Z',
        lastOutboundAt: '2026-03-02T10:00:00.000Z',
      },
      { unreadCount: 0, lastInboundAt: null, lastOutboundAt: '2026-03-04T10:00:00.000Z' },
    ]);
    expect(f).toEqual({
      count: 3,
      unread: 3,
      lastInboundAt: '2026-03-05T10:00:00.000Z',
      lastOutboundAt: '2026-03-04T10:00:00.000Z',
    });
  });

  it('is all zeros and no dates for no conversations', () => {
    expect(conversationFigures([])).toEqual({
      count: 0,
      unread: 0,
      lastInboundAt: null,
      lastOutboundAt: null,
    });
  });
});

describe('call figures', () => {
  it('answered = completed, missed = an inbound call nobody talked to, minutes from the summed seconds', () => {
    const f = callFigures([
      { status: 'completed', direction: 'inbound', durationSec: 125 },
      { status: 'completed', direction: 'outbound', durationSec: 60 },
      { status: 'no-answer', direction: 'inbound', durationSec: 0 },
      { status: 'declined', direction: 'inbound', durationSec: 0 },
      // We called and nobody picked up: not "missed" (nobody missed it).
      { status: 'no-answer', direction: 'outbound', durationSec: 0 },
      // Still ringing: neither answered nor missed yet.
      { status: 'in-progress', direction: 'inbound', durationSec: 0 },
    ]);
    expect(f).toEqual({ total: 6, answered: 2, missed: 2, minutes: 3 });
  });

  it('is zeros for no calls', () => {
    expect(callFigures([])).toEqual({ total: 0, answered: 0, missed: 0, minutes: 0 });
  });

  it('reaches back a year as a plain day', () => {
    expect(dayBefore(new Date('2026-10-16T08:00:00.000Z'), 365)).toBe('2025-10-16');
  });
});

describe('money', () => {
  it('formats an exact decimal string in its own currency', () => {
    expect(formatMoney('1500.5', 'USD', 'en')).toBe('$1,500.50');
    expect(formatMoney('1000', 'JPY', 'en')).toBe('¥1,000');
    expect(formatMoney('200', 'EUR', 'en')).toBe('€200.00');
  });

  it('falls back to the code for a currency the runtime does not know', () => {
    expect(formatMoney('12.5', 'ZZZ', 'en')).toContain('12.50');
    expect(formatMoney('12.5', 'ZZZ', 'en')).toContain('ZZZ');
  });
});

describe('answers that mean "not available to you"', () => {
  it('is a 403, a 402 or a 422 PLAN_FEATURE_LOCKED, and nothing else', () => {
    expect(isNotAvailableToYou(new ApiError(403, 'FORBIDDEN', 'x'))).toBe(true);
    expect(isNotAvailableToYou(new ApiError(402, 'PAYMENT_REQUIRED', 'x'))).toBe(true);
    expect(isNotAvailableToYou(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'x'))).toBe(true);
    expect(isNotAvailableToYou(new ApiError(422, 'VALIDATION_FAILED', 'x'))).toBe(false);
    expect(isNotAvailableToYou(new ApiError(500, 'INTERNAL', 'x'))).toBe(false);
    expect(isNotAvailableToYou(new Error('network'))).toBe(false);
  });
});

describe('field history values and labels', () => {
  it('writes scalars as text, empty as an empty string and objects as compact JSON', () => {
    expect(historyValueText('Asha')).toBe('Asha');
    expect(historyValueText(42)).toBe('42');
    expect(historyValueText(false)).toBe('false');
    expect(historyValueText(null)).toBe('');
    expect(historyValueText(undefined)).toBe('');
    expect(historyValueText('  ')).toBe('');
    expect(historyValueText([])).toBe('');
    expect(historyValueText({})).toBe('');
    expect(historyValueText({ a: 1, b: ['x'] })).toBe('{"a":1,"b":["x"]}');
  });

  it('title-cases a key that has no message', () => {
    expect(fallbackFieldLabel('customFields.lead_source')).toBe('Lead Source');
    expect(fallbackFieldLabel('someFieldKey')).toBe('Some Field Key');
    expect(fallbackFieldLabel('tax-id')).toBe('Tax Id');
  });

  it('gives two changes of one audit row different keys', () => {
    const e = { fieldKey: 'name', changedAt: '2026-03-01T10:00:00.000Z', actorType: 'user' };
    expect(historyEntryKey(e, 0)).not.toBe(historyEntryKey(e, 1));
  });
});
