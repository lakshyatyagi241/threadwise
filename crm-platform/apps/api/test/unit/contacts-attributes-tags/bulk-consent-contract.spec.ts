import { describe, expect, it } from 'vitest';
import { CONSENT_CHANNELS, bulkConsentContactsSchema } from '@crm/contracts';

const ID = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const base = { ids: [ID], channels: ['sms'], action: 'granted', note: 'Signed the form' };

/** The bulk consent body: the channels, one change, the selection, and the note a grant needs. */
describe('bulkConsentContactsSchema', () => {
  it('takes one channel of the consent vocabulary, or several, and a grant with its note', () => {
    expect(bulkConsentContactsSchema.safeParse(base).success).toBe(true);
    for (const channel of CONSENT_CHANNELS) {
      expect(
        bulkConsentContactsSchema.safeParse({ ...base, channels: [channel] }).success,
        channel,
      ).toBe(true);
    }
    expect(
      bulkConsentContactsSchema.safeParse({ ...base, channels: ['whatsapp', 'sms', 'email'] })
        .success,
    ).toBe(true);
  });

  it('refuses an empty channel list, a channel the consent ledger does not know, and a channel named twice', () => {
    expect(bulkConsentContactsSchema.safeParse({ ...base, channels: [] }).success).toBe(false);
    expect(bulkConsentContactsSchema.safeParse({ ...base, channels: ['pigeon'] }).success).toBe(
      false,
    );
    expect(bulkConsentContactsSchema.safeParse({ ...base, channels: ['sms', 'sms'] }).success).toBe(
      false,
    );
  });

  it('needs a note for a grant, and a whitespace-only note is no note', () => {
    const { note: _note, ...noNote } = base;
    const missing = bulkConsentContactsSchema.safeParse({ ...noNote, action: 'granted' });
    expect(missing.success).toBe(false);
    expect(missing.success ? [] : missing.error.issues.map((i) => i.path.join('.'))).toEqual([
      'note',
    ]);
    expect(bulkConsentContactsSchema.safeParse({ ...base, note: '   ' }).success).toBe(false);
  });

  it('takes a withdrawal without a note', () => {
    const { note: _note, ...noNote } = base;
    expect(bulkConsentContactsSchema.safeParse({ ...noNote, action: 'withdrawn' }).success).toBe(
      true,
    );
  });

  it('keeps the selection rule: exactly one of ids or a filter', () => {
    const { ids: _ids, ...noIds } = base;
    expect(bulkConsentContactsSchema.safeParse(noIds).success).toBe(false);
    expect(bulkConsentContactsSchema.safeParse({ ...base, filter: {} }).success).toBe(false);
    expect(
      bulkConsentContactsSchema.safeParse({ ...base, filter: {}, ids: undefined }).success,
    ).toBe(true);
  });

  it('caps the note at 500 characters', () => {
    expect(bulkConsentContactsSchema.safeParse({ ...base, note: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });
});
