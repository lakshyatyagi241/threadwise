import { describe, expect, it } from 'vitest';
import { isMaskedPhone, menuActions, messageRoute, phoneDigits, quickActions } from './row-actions';

describe('isMaskedPhone', () => {
  it('recognises the server mask (apps/api/.../phone-mask.ts): a literal x placeholder', () => {
    expect(isMaskedPhone('+xxxxxxxx0025')).toBe(true);
    expect(isMaskedPhone('xxxxxxxxxx88')).toBe(true);
    expect(isMaskedPhone('+xx xxxxx x8988')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMaskedPhone('+XXXXXXXX0025')).toBe(true);
  });

  it('is false for a real number, however it is formatted', () => {
    expect(isMaskedPhone('+919876543210')).toBe(false);
    expect(isMaskedPhone('+91 98765 43210')).toBe(false);
    expect(isMaskedPhone('')).toBe(false);
  });
});

describe('phoneDigits', () => {
  it('keeps the digits and a leading + of a real number', () => {
    expect(phoneDigits('+91 98765 43210')).toBe('+919876543210');
    expect(phoneDigits('919876543210')).toBe('919876543210');
  });

  it('is empty when there are no digits', () => {
    expect(phoneDigits('')).toBe('');
    expect(phoneDigits('   ')).toBe('');
  });

  it('is empty for a masked number — a tel:/wa.me link built from it would dial a meaningless target', () => {
    expect(phoneDigits('+xxxxxxxx0025')).toBe('');
    expect(phoneDigits('xxxxxxxxxx88')).toBe('');
  });
});

describe('quickActions', () => {
  it('builds tel:, wa.me and mailto: links for a reachable contact', () => {
    const links = quickActions({ phone: '+91 98765 43210', email: 'aarav@example.com' });
    expect(links.call).toBe('tel:+919876543210');
    expect(links.whatsapp).toBe('https://wa.me/919876543210');
    expect(links.email).toBe('mailto:aarav@example.com');
  });

  it('disables call and WhatsApp (null, not a dead link) for a masked phone number', () => {
    const links = quickActions({ phone: '+xxxxxxxx0025', email: 'aarav@example.com' });
    expect(links.call).toBeNull();
    expect(links.whatsapp).toBeNull();
    // unaffected: masking is phone-only
    expect(links.email).toBe('mailto:aarav@example.com');
  });

  it('disables call and WhatsApp for no phone at all, same as a masked one', () => {
    const links = quickActions({ phone: '', email: '' });
    expect(links.call).toBeNull();
    expect(links.whatsapp).toBeNull();
    expect(links.email).toBeNull();
  });
});

describe('menuActions', () => {
  it('always includes view; edit/group/tag and delete follow the permissions', () => {
    expect(menuActions({ edit: false, delete: false })).toEqual(['view']);
    expect(menuActions({ edit: true, delete: false })).toEqual(['view', 'edit', 'group', 'tag']);
    expect(menuActions({ edit: true, delete: true })).toEqual([
      'view',
      'edit',
      'group',
      'tag',
      'delete',
    ]);
  });
});

describe('messageRoute', () => {
  const both = { phone: '+91 98765 43210', email: 'a@example.com', optedOut: false };

  it('chats on WhatsApp when the contact has a number and a number is connected (or nothing is known yet)', () => {
    expect(messageRoute(both, { whatsapp: true, email: true })).toEqual({ kind: 'chat' });
    expect(messageRoute(both)).toEqual({ kind: 'chat' });
  });

  it('falls back to email through a connected mailbox when WhatsApp cannot carry it', () => {
    expect(messageRoute(both, { whatsapp: false, email: true })).toEqual({ kind: 'email' });
    expect(messageRoute({ ...both, phone: '' })).toEqual({ kind: 'email' });
    // A masked number is no number at all.
    expect(messageRoute({ ...both, phone: '+xxxxxxxx0025' })).toEqual({ kind: 'email' });
  });

  it('is blocked, with the reason, when nothing works: never a dead icon', () => {
    expect(messageRoute({ phone: '', email: '', optedOut: false })).toEqual({
      kind: 'blocked',
      reason: 'noContact',
    });
    expect(messageRoute(both, { whatsapp: false, email: false })).toEqual({
      kind: 'blocked',
      reason: 'noChannel',
    });
    expect(messageRoute({ ...both, phone: '' }, { email: false })).toEqual({
      kind: 'blocked',
      reason: 'noChannel',
    });
  });

  it('does not email a contact who opted out', () => {
    expect(messageRoute({ phone: '', email: 'a@example.com', optedOut: true })).toEqual({
      kind: 'blocked',
      reason: 'optedOut',
    });
    // The WhatsApp chat is still opened (a conversation is not a marketing send; the drawer holds the template rules).
    expect(messageRoute({ ...both, optedOut: true })).toEqual({ kind: 'chat' });
  });
});
