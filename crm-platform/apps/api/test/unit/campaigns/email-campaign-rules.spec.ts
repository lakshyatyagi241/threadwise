import { describe, expect, it } from 'vitest';
import { CAMPAIGN_EMAIL_SUBJECT_MAX } from '@crm/contracts';
import {
  EMPTY_SUBJECT_FALLBACK,
  SUBJECT_SEND_MAX,
  cleanSubject,
  emailCampaignProblems,
  emailCleared,
  isEmailProvider,
  isMailableAddress,
  isWalletFree,
  normalizeAddress,
  subjectSource,
} from '../../../src/modules/campaigns/email-campaign-rules';

/** What an email campaign is and is not (Reference's `?channel=email` builder and `EmailCampaignRunner`). */
describe('which campaigns are email campaigns', () => {
  it('only a mailbox sender makes one', () => {
    expect(isEmailProvider('email')).toBe(true);
    for (const p of ['waba', 'baileys', 'twilio', 'sms', null, undefined, ''])
      expect(isEmailProvider(p)).toBe(false);
  });

  it('SMS and email are never charged to the wallet; WhatsApp is', () => {
    expect(isWalletFree('email')).toBe(true);
    expect(isWalletFree('sms')).toBe(true);
    for (const p of ['waba', 'baileys', 'twilio', null]) expect(isWalletFree(p)).toBe(false);
  });
});

describe('what an email campaign form may hold', () => {
  const ok = { type: 'custom', customHeader: 'Your May offer', abTesting: false };

  it('a typed message with a subject is fine, and so is no subject at all', () => {
    expect(emailCampaignProblems(ok)).toEqual([]);
    expect(emailCampaignProblems({ type: 'text' })).toEqual([]);
    expect(emailCampaignProblems({ type: 'custom', customHeader: null })).toEqual([]);
  });

  it('refuses a template, a flow, an A/B test and an attachment (Reference hides them)', () => {
    const paths = (f: Parameters<typeof emailCampaignProblems>[0]) =>
      emailCampaignProblems(f).map((p) => p.path);
    expect(paths({ ...ok, type: 'template' })).toEqual(['type']);
    expect(paths({ ...ok, type: 'flow' })).toEqual(['type']);
    expect(paths({ ...ok, type: 'media' })).toEqual(['type']);
    expect(paths({ ...ok, templateId: 'x' })).toEqual(['templateId']);
    expect(paths({ ...ok, templateIdB: 'x' })).toEqual(['templateId']);
    expect(paths({ ...ok, flowIdB: 'x' })).toEqual(['flowId']);
    expect(paths({ ...ok, abTesting: true })).toEqual(['abTesting']);
    expect(paths({ ...ok, mediaUrl: 'https://x.test/a.png' })).toEqual(['mediaUrl']);
  });

  it('reports every problem at once, each on its own field', () => {
    const out = emailCampaignProblems({
      type: 'template',
      templateId: 't',
      abTesting: true,
      mediaUrl: 'https://x.test/a.pdf',
    });
    expect(out.map((p) => p.path)).toEqual(['type', 'templateId', 'abTesting', 'mediaUrl']);
  });

  it('the subject is at most 150 characters', () => {
    expect(CAMPAIGN_EMAIL_SUBJECT_MAX).toBe(150);
    expect(emailCampaignProblems({ ...ok, customHeader: 'a'.repeat(150) })).toEqual([]);
    expect(emailCampaignProblems({ ...ok, customHeader: 'a'.repeat(151) })).toEqual([
      { path: 'customHeader', message: 'The subject can be at most 150 characters.' },
    ]);
  });

  it('clears what a mail does not use: footer, buttons, pacing, window, tracking', () => {
    expect(emailCleared()).toEqual({
      customFooter: null,
      customButtons: [],
      customQuickReplies: [],
      throttleMinSec: null,
      throttleMaxSec: null,
      batchSize: null,
      batchPauseMin: null,
      dailyLimit: null,
      windowStart: null,
      windowEnd: null,
      trackingEnabled: false,
    });
    // A fresh object each time: the arrays are never shared between two campaigns.
    expect(emailCleared().customButtons).not.toBe(emailCleared().customButtons);
  });
});

describe('the address a mail goes to', () => {
  it('is trimmed and lower-cased, so two spellings of one address are one', () => {
    expect(normalizeAddress('  Asha.K@Example.COM ')).toBe('asha.k@example.com');
    expect(normalizeAddress(null)).toBe('');
    expect(normalizeAddress(undefined)).toBe('');
  });

  it('accepts a plain address and refuses junk, lists and header tricks', () => {
    for (const a of ['a@b.co', 'first.last+tag@sub.example.org', 'x_y-z@example.io'])
      expect(isMailableAddress(a)).toBe(true);
    for (const a of [
      '',
      'no-at-sign',
      'a@b',
      '@b.co',
      'a@',
      'a b@c.co',
      'a@b.co, c@d.co',
      'a@b.co;c@d.co',
      'Name <a@b.co>',
      'a@b.co\nBcc: x@y.co',
      `${'a'.repeat(320)}@b.co`,
    ])
      expect(isMailableAddress(a), a).toBe(false);
  });
});

describe('the subject of a mail', () => {
  it('is the Header field, else the campaign name', () => {
    expect(subjectSource('Your May offer', 'Offer')).toBe('Your May offer');
    expect(subjectSource('', 'Offer')).toBe('Offer');
    expect(subjectSource('   ', ' Offer ')).toBe('Offer');
    expect(subjectSource(null, 'Offer')).toBe('Offer');
  });

  it('has its line breaks turned into spaces once the contact values are merged in (header injection)', () => {
    expect(cleanSubject('Hello Asha\r\nBcc: boss@evil.test')).toBe(
      'Hello Asha Bcc: boss@evil.test',
    );
    expect(cleanSubject('a\n\n\nb')).toBe('a b');
    expect(cleanSubject('  padded  ')).toBe('padded');
  });

  it('is cut at 255 characters', () => {
    expect(cleanSubject('x'.repeat(400))).toHaveLength(SUBJECT_SEND_MAX);
  });

  it('says "Message" when nothing is left (a contact value that merged to nothing)', () => {
    expect(cleanSubject('')).toBe(EMPTY_SUBJECT_FALLBACK);
    expect(cleanSubject('\r\n')).toBe('Message');
    expect(cleanSubject(null)).toBe('Message');
  });
});
