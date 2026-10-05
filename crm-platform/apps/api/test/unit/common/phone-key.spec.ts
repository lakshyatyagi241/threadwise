import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { canonicalizeLocalPhone } from '@crm/contracts';
import { phoneKey, phoneKeySql } from '../../../src/common/sql/phone-key';

/** How a buyer's phone, typed any way, becomes the one key the Customers list groups on and the backfill reads in the default country. */
describe('canonicalizeLocalPhone (the one rule for a typed number)', () => {
  it.each([
    ['7999834066', '+91', '+917999834066'],
    ['07999834066', '+91', '+917999834066'],
    ['79998 34066', '+91', '+917999834066'],
    ['+91 79998 34066', '+91', '+917999834066'],
    ['917999834066', '+91', '+917999834066'],
    ['00917999834066', '+91', '+917999834066'],
    ['+91 79998 34066', '+44', '+917999834066'],
    ['07700 900123', '+44', '+447700900123'],
    ['9198765432', '+91', '+919198765432'],
    ['(415) 555-2671', '+1', '+14155552671'],
    ['91 7999834066', null, '+917999834066'],
  ])('%s with default %s is %s', (raw, cc, e164) => {
    expect(canonicalizeLocalPhone(raw, cc)?.e164).toBe(e164);
  });

  it.each([
    ['7999834066', null],
    ['7999834066', ''],
    ['', '+91'],
    [null, '+91'],
    ['n/a', '+91'],
    ['123', '+91'],
    ['+123', '+91'],
    ['1234567890123456', '+91'],
  ])('%s with default %s is not a phone: never guessed', (raw, cc) => {
    expect(canonicalizeLocalPhone(raw, cc)).toBeNull();
  });
});

describe('phoneKey (TypeScript)', () => {
  it('groups every way of typing one number onto the same digits', () => {
    const forms = [
      '7999834066',
      '07999834066',
      '+91 79998-34066',
      '917999834066',
      '0091 7999834066',
    ];
    for (const f of forms) expect(phoneKey(f, '+91'), f).toBe('917999834066');
  });

  it('keeps a number that carries its own country, whatever the default', () => {
    expect(phoneKey('+44 7700 900123', '+91')).toBe('447700900123');
    expect(phoneKey('447700900123', '+91')).toBe('447700900123');
  });

  it('with no default country a bare local number stays as its digits; no digits is empty', () => {
    expect(phoneKey('7999834066', null)).toBe('7999834066');
    expect(phoneKey('n/a', '+91')).toBe('');
    expect(phoneKey(null, '+91')).toBe('');
  });

  it('is the digits of canonicalizeLocalPhone wherever that accepts the number', () => {
    for (const raw of [
      '7999834066',
      '+91 79998 34066',
      '917999834066',
      '07700 900123',
      '4155552671',
    ]) {
      for (const cc of ['+91', '+44', '+1', null]) {
        const canon = canonicalizeLocalPhone(raw, cc);
        if (canon) expect(phoneKey(raw, cc), `${raw} / ${cc}`).toBe(canon.digits);
      }
    }
  });
});

describe('phoneKeySql', () => {
  it('compiles to one expression over the column with the country code as a parameter', () => {
    const q = new PgDialect().sqlToQuery(sql`SELECT ${phoneKeySql(sql`o.customer_phone`, '91')}`);
    expect(q.sql).toContain('o.customer_phone');
    expect(q.sql).toContain('CASE');
    expect(q.params).toContain('91');
  });
});
