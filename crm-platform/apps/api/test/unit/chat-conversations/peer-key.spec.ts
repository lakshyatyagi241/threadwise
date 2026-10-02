import { describe, expect, it } from 'vitest';
import {
  defaultTitle,
  identityOfPeer,
  isPhoneChannel,
  normalizePeerKey,
} from '../../../src/modules/chat-conversations/peer-key';

describe('normalizePeerKey: one thread per sender however the provider writes the number', () => {
  it.each([
    ['919876543210'],
    ['+919876543210'],
    ['+91 98765 43210'],
    ['+91-98765-43210'],
    ['(+91) 98765 43210'],
    ['00919876543210'],
    ['919876543210@s.whatsapp.net'],
    ['919876543210:12@s.whatsapp.net'],
    ['  919876543210  '],
  ])('phone channel: %s -> 919876543210', (raw) => {
    expect(normalizePeerKey('simulator', raw)).toBe('919876543210');
    expect(normalizePeerKey('whatsapp_cloud', raw)).toBe('919876543210');
  });

  it('a number the contact canonicaliser rejects still keeps its digits: an inbound message is never dropped for how a number is written', () => {
    expect(normalizePeerKey('simulator', '09876543210')).toBe('09876543210');
    expect(normalizePeerKey('simulator', '12345')).toBe('12345');
  });

  it('nothing to key on is null (empty, no digits, a handle too short or too long)', () => {
    expect(normalizePeerKey('simulator', '')).toBeNull();
    expect(normalizePeerKey('simulator', '   ')).toBeNull();
    expect(normalizePeerKey('simulator', null)).toBeNull();
    expect(normalizePeerKey('simulator', undefined)).toBeNull();
    expect(normalizePeerKey('simulator', 'abc')).toBeNull();
    expect(normalizePeerKey('simulator', '123')).toBeNull();
    expect(normalizePeerKey('simulator', '1'.repeat(21))).toBeNull();
  });

  it('other channels keep the channel thread id, trimmed and lower-cased', () => {
    expect(normalizePeerKey('webchat', '  Visitor-ABC123 ')).toBe('visitor-abc123');
    expect(normalizePeerKey('webchat', 'x'.repeat(129))).toBeNull();
    expect(normalizePeerKey('webchat', 'x'.repeat(128))).toBe('x'.repeat(128));
  });

  it('is idempotent: a normalised key normalises to itself', () => {
    for (const raw of ['+91 98765 43210', '919876543210@s.whatsapp.net', 'Visitor-ABC']) {
      const kind = raw.startsWith('Visitor') ? 'webchat' : 'simulator';
      const once = normalizePeerKey(kind, raw)!;
      expect(normalizePeerKey(kind, once)).toBe(once);
    }
  });
});

describe('identityOfPeer: which contact a peer stands for', () => {
  it('a phone channel peer is the E.164 phone identity (the key the contacts module stores)', () => {
    expect(identityOfPeer('simulator', '919876543210')).toEqual({
      kind: 'phone',
      value: '+919876543210',
    });
  });

  it('a peer that is not a dialable number has no identity, and neither has a webchat visitor', () => {
    expect(identityOfPeer('simulator', '12345')).toBeNull();
    expect(identityOfPeer('webchat', 'visitor-abc')).toBeNull();
  });

  it('knows which kinds are phone channels', () => {
    expect(isPhoneChannel('simulator')).toBe(true);
    expect(isPhoneChannel('whatsapp_cloud')).toBe(true);
    expect(isPhoneChannel('webchat')).toBe(false);
  });
});

describe('defaultTitle', () => {
  it('the sender name when there is one, else the number as people write it', () => {
    expect(defaultTitle('simulator', '919876543210', ' Asha ')).toBe('Asha');
    expect(defaultTitle('simulator', '919876543210', null)).toBe('+919876543210');
    expect(defaultTitle('simulator', '919876543210', '   ')).toBe('+919876543210');
    expect(defaultTitle('webchat', 'visitor-abc', null)).toBe('visitor-abc');
  });
});
