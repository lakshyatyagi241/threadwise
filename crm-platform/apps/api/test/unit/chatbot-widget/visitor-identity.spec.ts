import { describe, expect, it } from 'vitest';
import { visitorHasIdentity } from '../../../src/modules/chatbot-widget/_shims/sql-inbox-gateway';

describe('a website chat visitor becomes a contact only once they give an email or a phone', () => {
  it('has no identity when they only chatted (a person trying the bot out)', () => {
    expect(visitorHasIdentity({ phone: null, email: null })).toBe(false);
    expect(visitorHasIdentity({ phone: '', email: '   ' })).toBe(false);
    expect(visitorHasIdentity({ phone: 'abc', email: null })).toBe(false);
  });

  it('has one with a usable phone number or an email', () => {
    expect(visitorHasIdentity({ phone: '+91 85305 55633', email: null })).toBe(true);
    expect(visitorHasIdentity({ phone: null, email: 'a@b.co' })).toBe(true);
  });
});
