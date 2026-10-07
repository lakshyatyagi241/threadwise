import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PERSONAL_WA_NOTICE_ITEMS,
  PERSONAL_WA_NOTICE_ITEM_IDS,
  PERSONAL_WA_NOTICE_NOTES,
  PERSONAL_WA_NOTICE_VERSION,
  acknowledgementInputSchema,
  personalWaNoticeCanonicalText,
} from '@crm/contracts';
import {
  noticeRequired,
  noticeTextSha256,
} from '../../../src/modules/whatsapp-devices-baileys/risk-notice.service';

describe('the risk notice (spec 6)', () => {
  it('is versioned as YYYY-MM-DD.N and has the three statements, each with its own id', () => {
    expect(PERSONAL_WA_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(PERSONAL_WA_NOTICE_ITEMS.map((i) => i.id)).toEqual([...PERSONAL_WA_NOTICE_ITEM_IDS]);
    expect(PERSONAL_WA_NOTICE_ITEMS).toHaveLength(3);
  });

  it('is honest: unofficial, against the terms, bannable, no support for bans; never safe or guaranteed', () => {
    const all = personalWaNoticeCanonicalText();
    expect(all).toMatch(/not an approved way/i);
    expect(all).toMatch(/against WhatsApp.s terms/i);
    expect(all).toMatch(/permanently ban/i);
    expect(all).toMatch(/not covered by support/i);
    expect(all).toMatch(/shared inbox/i);
    for (const word of ['safe', 'protected', 'guaranteed']) {
      expect(all.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    expect(PERSONAL_WA_NOTICE_NOTES.length).toBeGreaterThan(0);
  });

  it('the canonical text carries the version, so any wording change is a new version', () => {
    expect(
      personalWaNoticeCanonicalText().startsWith(`version: ${PERSONAL_WA_NOTICE_VERSION}\n`),
    ).toBe(true);
  });

  it('the stored hash is the SHA-256 (hex) of the canonical English text', () => {
    const expected = createHash('sha256')
      .update(personalWaNoticeCanonicalText(), 'utf8')
      .digest('hex');
    expect(noticeTextSha256()).toBe(expected);
    expect(noticeTextSha256()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an acknowledgement needs all three statements ticked', () => {
    const base = { version: PERSONAL_WA_NOTICE_VERSION };
    expect(
      acknowledgementInputSchema.safeParse({ ...base, items: [true, true, true] }).success,
    ).toBe(true);
    expect(acknowledgementInputSchema.safeParse({ ...base, items: [true, true] }).success).toBe(
      false,
    );
    expect(
      acknowledgementInputSchema.safeParse({ ...base, items: [true, false, true] }).success,
    ).toBe(false);
    expect(acknowledgementInputSchema.parse({ ...base, items: [true, true, true] }).locale).toBe(
      'en',
    );
  });

  it('a missing acknowledgement is 409 PERSONAL_WA_NOTICE_REQUIRED naming the version in force', () => {
    const e = noticeRequired();
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('PERSONAL_WA_NOTICE_REQUIRED');
    expect(e.details).toEqual([{ path: 'requiredVersion', message: PERSONAL_WA_NOTICE_VERSION }]);
  });
});
