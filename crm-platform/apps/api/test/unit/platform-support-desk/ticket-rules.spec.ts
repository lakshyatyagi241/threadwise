import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPP_TICKET_NUMBER_PATTERN } from '@crm/contracts';
import {
  customerReplyEffect,
  escapeLike,
  excerpt,
  fallbackTicketNumber,
  isCustomerOpen,
  resolvedAtAfterStatus,
  staffReplyEffect,
  ticketNumber,
} from '../../../src/modules/platform-support-desk/ticket-rules';

const NOW = new Date('2026-10-03T10:00:00Z');
const EARLIER = new Date('2026-10-01T10:00:00Z');

describe('ticket numbers (WD-SUPP-002)', () => {
  it('is TKT- plus six upper-case letters or digits', () => {
    for (let i = 0; i < 200; i++) expect(ticketNumber()).toMatch(/^TKT-[A-Z0-9]{6}$/);
  });
  it('the fallback has the documented shape and passes the contract pattern', () => {
    const n = fallbackTicketNumber(1_760_000_123_000);
    expect(n).toMatch(/^TKT-[A-Z]{4}-\d{4}$/);
    expect(SUPP_TICKET_NUMBER_PATTERN.test(n)).toBe(true);
  });
});

describe('resolved_at (WD-SUPP-012)', () => {
  it('open -> resolved stamps now', () => {
    expect(resolvedAtAfterStatus('resolved', null, NOW)).toEqual(NOW);
  });
  it('resolving an already resolved ticket keeps the original time', () => {
    expect(resolvedAtAfterStatus('resolved', EARLIER, NOW)).toEqual(EARLIER);
  });
  it('resolved -> closed keeps the resolution time', () => {
    expect(resolvedAtAfterStatus('closed', EARLIER, NOW)).toEqual(EARLIER);
  });
  it('closed straight from open leaves it empty', () => {
    expect(resolvedAtAfterStatus('closed', null, NOW)).toBeNull();
  });
  it.each(['open', 'in_progress', 'pending'] as const)('reopening to %s clears it', (s) => {
    expect(resolvedAtAfterStatus(s, EARLIER, NOW)).toBeNull();
  });
});

describe('operator reply effect (WD-SUPP-009)', () => {
  it('a reply on an open ticket starts the first response and moves it to in_progress', () => {
    expect(staffReplyEffect({ status: 'open', firstResponseAt: null }, false)).toEqual({
      stampFirstResponse: true,
      touchLastReply: true,
      status: 'in_progress',
    });
  });
  it('a later reply does not restamp the first response and leaves other statuses alone', () => {
    expect(staffReplyEffect({ status: 'pending', firstResponseAt: EARLIER }, false)).toEqual({
      stampFirstResponse: false,
      touchLastReply: true,
      status: null,
    });
  });
  it('an internal note changes nothing on the ticket', () => {
    expect(staffReplyEffect({ status: 'open', firstResponseAt: null }, true)).toEqual({
      stampFirstResponse: false,
      touchLastReply: false,
      status: null,
    });
  });
});

describe('customer reply effect (WD-SUPP-005)', () => {
  it('reopens a resolved ticket as in_progress', () => {
    expect(customerReplyEffect('resolved')).toEqual({
      allowed: true,
      reopen: true,
      status: 'in_progress',
    });
  });
  it('keeps pending pending', () => {
    expect(customerReplyEffect('pending')).toEqual({ allowed: true, reopen: false, status: null });
  });
  it('refuses a closed ticket', () => {
    expect(customerReplyEffect('closed')).toEqual({ allowed: false });
  });
  it('counts closed as not open on the customer side', () => {
    expect(isCustomerOpen('closed')).toBe(false);
    expect(isCustomerOpen('resolved')).toBe(false);
    expect(isCustomerOpen('pending')).toBe(true);
  });
});

describe('helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
  it('cuts long excerpts at 140 characters', () => {
    expect(excerpt('a'.repeat(140))).toHaveLength(140);
    expect(excerpt('a'.repeat(200))).toBe(`${'a'.repeat(140)}...`);
  });
});

describe('privileged access', () => {
  it('only support-store.ts opens a privileged transaction', () => {
    const dir = resolve(__dirname, '../../../src/modules/platform-support-desk');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'support-store.ts')
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('.privileged('));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(dir, 'support-store.ts'), 'utf8')).toContain('.privileged(');
  });
});
