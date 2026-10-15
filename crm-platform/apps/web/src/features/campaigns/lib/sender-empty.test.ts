import { describe, expect, it } from 'vitest';
import type { SenderHidden } from '@crm/contracts';
import {
  classicFallback,
  DEVICES_HREF,
  EMAIL_HREF,
  NUMBERS_HREF,
  senderEmpty,
  SMS_HREF,
  withClientHidden,
} from './sender-empty';

const h = (engine: string, reason: SenderHidden['reason'], count = 1): SenderHidden => ({
  engine,
  reason,
  count,
});

describe('senderEmpty: why the "Send from" list has nothing to pick', () => {
  it('no hidden numbers means nothing is connected at all', () => {
    expect(senderEmpty([])).toEqual({ cause: 'none', count: 0, href: NUMBERS_HREF });
    expect(senderEmpty(undefined).cause).toBe('none');
  });

  it('a number still connecting wins, and counts every one', () => {
    expect(
      senderEmpty([h('waba', 'pending', 2), h('twilio', 'pending'), h('waba', 'error')]),
    ).toEqual({
      cause: 'pending',
      count: 3,
      href: NUMBERS_HREF,
    });
  });

  it('a failed connection, then a disconnected number, then personal numbers that are off', () => {
    expect(senderEmpty([h('waba', 'error'), h('waba', 'not_connected')]).cause).toBe('error');
    expect(
      senderEmpty([h('waba', 'not_connected'), h('baileys', 'unofficial_disabled')]).cause,
    ).toBe('disconnected');
    expect(senderEmpty([h('baileys', 'unofficial_disabled', 2)])).toEqual({
      cause: 'personal_off',
      count: 2,
      href: NUMBERS_HREF,
    });
  });

  it('a disconnected personal number links to the personal numbers screen, an official one to the numbers screen', () => {
    expect(senderEmpty([h('baileys', 'not_connected')]).href).toBe(DEVICES_HREF);
    expect(senderEmpty([h('baileys', 'not_connected'), h('waba', 'not_connected')]).href).toBe(
      NUMBERS_HREF,
    );
  });

  it('the SMS card always points at the SMS screen', () => {
    expect(senderEmpty([], { sms: true }).href).toBe(SMS_HREF);
    expect(senderEmpty([h('sms', 'pending')], { sms: true }).href).toBe(SMS_HREF);
  });
});

describe('withClientHidden: the reason is not lost when this screen filters a personal number itself', () => {
  const all = [
    { key: 'waba:1', engine: 'waba' },
    { key: 'baileys:2', engine: 'baileys' },
    { key: 'baileys:3' },
  ];

  it('adds the personal numbers the screen dropped', () => {
    expect(withClientHidden(all, [all[0]!], [])).toEqual([h('baileys', 'unofficial_disabled', 2)]);
  });

  it('adds to the count the server already reported, never a second row', () => {
    expect(withClientHidden(all, [all[0]!], [h('baileys', 'unofficial_disabled')])).toEqual([
      h('baileys', 'unofficial_disabled', 3),
    ]);
  });

  it('changes nothing when nothing was dropped, or while the lists are not known', () => {
    expect(withClientHidden(all, all, [h('waba', 'pending')])).toEqual([h('waba', 'pending')]);
    expect(withClientHidden(undefined, undefined, undefined)).toEqual([]);
  });
});

describe('classicFallback: only numbers the guided flow cannot send from', () => {
  const classic = (key: string, isDefault = false) => ({ key, guided: false, isDefault });

  it('picks the default number, else the first', () => {
    expect(classicFallback([classic('a'), classic('b', true)])?.key).toBe('b');
    expect(classicFallback([classic('a'), classic('b')])?.key).toBe('a');
  });

  it('is none when a verified number exists (it is auto-picked) or there is no number', () => {
    expect(
      classicFallback([classic('a'), { key: 'g', guided: true, isDefault: false }]),
    ).toBeNull();
    expect(classicFallback([])).toBeNull();
  });
});

describe('senderEmpty on the Email card', () => {
  it('every cause is fixed on the Email page', () => {
    expect(senderEmpty([], { email: true })).toEqual({ cause: 'none', count: 0, href: EMAIL_HREF });
    expect(senderEmpty([h('email', 'not_connected', 2)], { email: true })).toEqual({
      cause: 'disconnected',
      count: 2,
      href: EMAIL_HREF,
    });
    expect(senderEmpty([h('email', 'error')], { email: true }).href).toBe('/email');
  });
});
