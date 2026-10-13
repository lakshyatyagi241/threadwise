import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  changedFields,
  isSecretKey,
  maskEmail,
  maskName,
  maskPhone,
  piiKindOfKey,
  renderDelta,
  renderValue,
} from '../../../src/modules/audit-log/audit-pii';

const viewer = { module: 'contacts', reveal: false };
const owner = { module: 'contacts', reveal: true };

describe('maskers', () => {
  it('keeps the country code and the last three digits of a phone', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ******210');
    expect(maskPhone('98765 43210')).toBe('******210');
    expect(maskPhone('123')).toBe('******');
  });
  it('keeps the first letter and the domain of an e-mail', () => {
    expect(maskEmail('sara.ali@example.com')).toBe('s***@example.com');
    expect(maskEmail('nonsense')).toBe('***');
  });
  it('keeps the first letter of each word of a name', () => {
    expect(maskName('Sara Al Fahad')).toBe('S*** A*** F***');
  });
});

describe('which keys are personal data', () => {
  it.each([
    ['phone', 'phone'],
    ['normalized_phone', 'phone'],
    ['whatsappNumber', 'phone'],
    ['email', 'email'],
    ['billingEmail', 'email'],
    ['address', 'address'],
    ['notes', 'text'],
    ['message_body', 'text'],
    ['text', 'text'],
    ['full_name', 'name'],
    ['contact_name', 'name'],
  ])('%s is %s', (key, kind) => expect(piiKindOfKey(key, 'orders')).toBe(kind));

  it('a bare name is personal only for a person record', () => {
    expect(piiKindOfKey('name', 'contacts')).toBe('name');
    expect(piiKindOfKey('name', 'tags')).toBeNull();
    expect(piiKindOfKey('name', 'roles')).toBeNull();
  });
  it('a flag or a timestamp about a phone is not a phone', () => {
    expect(piiKindOfKey('phone_verified_at', 'contacts')).toBeNull();
    expect(piiKindOfKey('message_status', 'conversations')).toBeNull();
  });
});

describe('secrets', () => {
  it.each([
    'password',
    'smtp_password',
    'apiKey',
    'api_key',
    'client_secret',
    'access_token',
    'refreshToken',
    'webhook_url',
    'signingSecret',
    'Authorization',
    'x-api-key',
    'private_key',
    'bearer',
  ])('%s is a secret key', (k) => expect(isSecretKey(k)).toBe(true));

  it('names of keys are not secrets', () => {
    expect(isSecretKey('changed_keys')).toBe(false);
    expect(isSecretKey('credential_keys_set')).toBe(false);
    expect(isSecretKey('status')).toBe(false);
  });

  it('is redacted for everyone, the owner included', () => {
    for (const opts of [viewer, owner]) {
      expect(renderValue('smtp_password', 'hunter2', opts)).toEqual({
        value: REDACTED,
        masked: true,
      });
    }
  });
  it('an empty secret stays empty (the trail still shows something changed)', () => {
    expect(renderValue('api_key', '', viewer)).toEqual({ value: '', masked: false });
    expect(renderValue('api_key', null, viewer)).toEqual({ value: null, masked: false });
  });
  it('a token under an innocent key is redacted by its shape', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk';
    expect(renderValue('note_ref', jwt, owner).value).toBe(REDACTED);
    expect(renderValue('header', 'Bearer abcdef1234567890', owner).value).toBe(`Bearer ${REDACTED}`);
    expect(renderValue('blob', 'Abc123Def456Ghi789Jkl012Mno345Pqr678', owner).value).toBe(REDACTED);
  });
  it('a uuid is not mistaken for a token', () => {
    const id = '3f0b9f0e-6c1c-4a39-9b7e-0d4d2b0c1a11';
    expect(renderValue('owner_ref', id, viewer).value).toBe(id);
  });
});

describe('personal data', () => {
  it('is masked for a normal viewer and shown to a revealer', () => {
    const delta = {
      phone: { old: '+919876543210', new: '+971501234567' },
      email: { old: 'a@b.com', new: 'sara@example.com' },
      name: { old: 'Sara Ali', new: 'Sara Al-Ali' },
      notes: { old: null, new: 'Call after 5 pm, owes 200' },
      stage: { old: 'new', new: 'won' },
    };
    const masked = renderDelta(delta, viewer);
    expect(masked.phone).toEqual({ old: '+91 ******210', new: '+97 ******567', masked: true });
    expect(masked.email!.new).toBe('s***@example.com');
    expect(masked.name!.new).toBe('S*** A***');
    expect(masked.notes).toEqual({ old: null, new: '[hidden text]', masked: true });
    expect(masked.stage).toEqual({ old: 'new', new: 'won', masked: false });

    const shown = renderDelta(delta, owner);
    expect(shown.phone!.new).toBe('+971501234567');
    expect(shown.notes!.new).toBe('Call after 5 pm, owes 200');
    expect(shown.phone!.masked).toBe(false);
  });

  it('masks an e-mail or an E.164 number inside a harmless field for a normal viewer', () => {
    const r = renderValue('reason', 'moved from a@b.com, +919876543210 verified', viewer);
    expect(r.value).toBe('moved from a***@b.com, +91 ******210 verified');
    expect(r.masked).toBe(true);
  });

  it('walks nested objects and arrays', () => {
    const r = renderValue(
      'contacts',
      [{ phone: '+919876543210', password: 'x', label: 'home' }, { emails: ['a@b.com'] }],
      viewer,
    );
    expect(r.value).toEqual([
      { phone: '+91 ******210', password: REDACTED, label: 'home' },
      { emails: ['a***@b.com'] },
    ]);
  });

  it('a bare name of a tag is shown', () => {
    expect(renderDelta({ name: { old: 'VIP', new: 'Gold' } }, { module: 'tags', reveal: false })).toEqual({
      name: { old: 'VIP', new: 'Gold', masked: false },
    });
  });

  it('a long string is cut and a deep structure stops', () => {
    const long = 'x'.repeat(5000);
    expect((renderValue('title', long, viewer).value as string).length).toBeLessThan(1100);
    let deep: unknown = 'end';
    for (let i = 0; i < 12; i++) deep = { level: deep };
    expect(JSON.stringify(renderValue('payload', deep, viewer).value)).toContain('[too deep]');
  });
});

describe('the act-as stamp', () => {
  const stamped = {
    stage: { old: 'new', new: 'won' },
    _impersonatedBy: { old: null, new: { operatorId: 'op', sessionId: 's' } },
  };
  it('is not a field change', () => {
    expect(changedFields(stamped)).toEqual(['stage']);
    expect(Object.keys(renderDelta(stamped, viewer))).toEqual(['stage']);
  });
  it('a row without a delta has no changes', () => {
    expect(changedFields(null)).toEqual([]);
    expect(renderDelta(null, viewer)).toEqual({});
  });
  it('a value that is not an {old,new} pair is shown as the new value', () => {
    expect(renderDelta({ count: 3 }, viewer)).toEqual({ count: { new: 3, masked: false } });
  });
});
