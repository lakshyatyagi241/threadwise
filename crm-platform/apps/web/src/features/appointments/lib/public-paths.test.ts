import { describe, expect, it } from 'vitest';
import { matchPublicPath, slotsQuery } from './public-paths';

const TOKEN = 'abcdEFGH12345678_-xyz';

describe('matchPublicPath: allowed shapes', () => {
  it.each([
    ['GET', ['booking', 'acme'], 'booking/acme', false],
    ['GET', ['booking', 'acme', 'discovery-call'], 'booking/acme/discovery-call', false],
    [
      'GET',
      ['booking', 'acme', 'discovery-call', 'slots'],
      'booking/acme/discovery-call/slots',
      true,
    ],
    [
      'POST',
      ['booking', 'acme', 'discovery-call', 'book'],
      'booking/acme/discovery-call/book',
      false,
    ],
    ['GET', ['booking-manage', TOKEN], `booking-manage/${TOKEN}`, false],
    ['GET', ['booking-manage', TOKEN, 'slots'], `booking-manage/${TOKEN}/slots`, true],
    ['POST', ['booking-manage', TOKEN, 'reschedule'], `booking-manage/${TOKEN}/reschedule`, false],
    ['POST', ['booking-manage', TOKEN, 'cancel'], `booking-manage/${TOKEN}/cancel`, false],
  ] as const)('%s %j', (method, segments, path, hasQuery) => {
    expect(matchPublicPath(method, segments)).toEqual({ ok: true, path, method, hasQuery });
  });

  it('reads HEAD like GET', () => {
    expect(matchPublicPath('HEAD', ['booking', 'acme'])).toMatchObject({ ok: true, method: 'GET' });
  });

  it('accepts 64-character slugs and 128-character tokens, no more', () => {
    expect(matchPublicPath('GET', ['booking', 'a'.repeat(64)]).ok).toBe(true);
    expect(matchPublicPath('GET', ['booking', 'Admin', 'Site_Visit-2']).ok).toBe(true);
    expect(matchPublicPath('GET', ['booking', 'a'.repeat(65)])).toEqual({ ok: false, status: 404 });
    expect(matchPublicPath('GET', ['booking-manage', 'A'.repeat(128)]).ok).toBe(true);
    expect(matchPublicPath('GET', ['booking-manage', 'A'.repeat(129)])).toEqual({
      ok: false,
      status: 404,
    });
    expect(matchPublicPath('GET', ['booking-manage', 'A'.repeat(15)])).toEqual({
      ok: false,
      status: 404,
    });
  });
});

describe('matchPublicPath: refused', () => {
  it('rejects the wrong method with 405', () => {
    expect(matchPublicPath('POST', ['booking', 'acme'])).toEqual({ ok: false, status: 405 });
    expect(matchPublicPath('GET', ['booking', 'acme', 'x', 'book'])).toEqual({
      ok: false,
      status: 405,
    });
    expect(matchPublicPath('GET', ['booking-manage', TOKEN, 'cancel'])).toEqual({
      ok: false,
      status: 405,
    });
    expect(matchPublicPath('DELETE', ['booking-manage', TOKEN])).toEqual({
      ok: false,
      status: 405,
    });
    expect(matchPublicPath('PUT', ['booking-manage', TOKEN, 'reschedule'])).toEqual({
      ok: false,
      status: 405,
    });
  });

  it.each([
    [[]],
    [['booking']],
    [['booking', 'acme', 'x', 'slots', 'extra']],
    [['booking', 'acme', 'x', 'unknown']],
    [['booking-manage']],
    [['booking-manage', TOKEN, 'reschedule', 'more']],
    [['booking-manage', TOKEN, 'delete']],
    [['staff', 'acme']],
    [['..', 'acme']],
  ])('rejects the shape %j with 404', (segments) => {
    expect(matchPublicPath('GET', segments)).toEqual({ ok: false, status: 404 });
    expect(matchPublicPath('POST', segments)).toEqual({ ok: false, status: 404 });
  });

  it.each([
    ['..'],
    ['.'],
    ['a/b'],
    ['a%2Fb'],
    ['a b'],
    ['-acme'],
    ['acme\n'],
    ['a.b'],
    [''],
    ['ünï'],
  ])('rejects the slug %j', (slug) => {
    expect(matchPublicPath('GET', ['booking', slug]).ok).toBe(false);
    expect(matchPublicPath('GET', ['booking', 'acme', slug]).ok).toBe(false);
  });

  it.each([
    ['../etc'],
    ['abc def 1234567890'],
    ['abc%2F1234567890123'],
    ['abc.1234567890123456'],
    ['tok\n1234567890123456'],
  ])('rejects the token %j', (token) => {
    expect(matchPublicPath('GET', ['booking-manage', token]).ok).toBe(false);
  });
});

describe('slotsQuery', () => {
  it('forwards from and to when they are instants', () => {
    const q = new URLSearchParams({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
    });
    expect(slotsQuery(q)).toBe(
      '?from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z',
    );
  });

  it('forwards a date and a numeric offset', () => {
    const q = new URLSearchParams({ from: '2026-10-01', to: '2026-11-01T00:00:00+05:30' });
    expect(slotsQuery(q)).toContain('from=2026-10-01');
    expect(slotsQuery(q)).toContain('to=2026-11-01T00%3A00%3A00%2B05%3A30');
  });

  it('drops anything else: other parameters and values that are not instants', () => {
    const q = new URLSearchParams({
      from: 'x&admin=1',
      to: '2026-10-01&debug=1',
      day: '2026-10-01',
      extra: 'a',
    });
    expect(slotsQuery(q)).toBe('');
    expect(slotsQuery(new URLSearchParams({ from: '2026-10-01', admin: '1' }))).toBe(
      '?from=2026-10-01',
    );
  });
});
