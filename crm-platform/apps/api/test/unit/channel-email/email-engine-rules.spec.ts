import { describe, expect, it } from 'vitest';
import {
  campaignBodies,
  campaignMessageId,
  contactOfReference,
  monthStart,
  oneLine,
  quotaMessage,
} from '../../../src/modules/channel-email/email-engine.rules';

/** The pure rules of the email engine that sends a campaign. */
describe('the month a mail counts in', () => {
  it('starts on the first of the month, UTC', () => {
    expect(monthStart(new Date('2026-10-14T22:30:00Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(monthStart(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(monthStart(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });

  it('the plan sentence names the cap and is singular for one', () => {
    expect(quotaMessage(500)).toBe(
      "You've reached your plan's limit of 500 emails a month. Upgrade your plan to send more.",
    );
    expect(quotaMessage(1)).toContain('1 email a month');
  });
});

describe('who a send is for', () => {
  it('reads the contact out of a campaign or broadcast reference', () => {
    expect(contactOfReference('camp-12-345')).toBe(345);
    expect(contactOfReference('camp-12-345-r2')).toBe(345);
    expect(contactOfReference('bcast-9-7')).toBe(7);
  });

  it('any other shape names nobody', () => {
    for (const r of ['', 'camp-12', 'reply-1-2', 'camp-a-b', 'camp-1-2-x'])
      expect(contactOfReference(r), r).toBeNull();
  });
});

describe('the Message-ID of a campaign mail', () => {
  it('keeps the reference and the mailbox domain, and is unique per mail', () => {
    const a = campaignMessageId('camp-1-2', 'sales@acme.test');
    const b = campaignMessageId('camp-1-2', 'sales@acme.test');
    expect(a).toMatch(/^tw\.camp-1-2\.[0-9a-f-]{12}@acme\.test$/);
    // A recurring campaign mails the same contact again: two mails must never share an id.
    expect(a).not.toBe(b);
  });

  it('is built from a fixed nonce when one is given, and is safe in a header', () => {
    expect(campaignMessageId('camp 1/2>', 'a@b.test', 'n1')).toBe('tw.camp-1-2-.n1@b.test');
    expect(campaignMessageId('', 'nodomain', 'n1')).toBe('tw.campaign.n1@mail.invalid');
  });
});

describe('the two bodies of a campaign mail', () => {
  const url = 'https://app.test/u/tok?x=1&y=2';

  it('the text part is the message and the unsubscribe line', () => {
    const { text } = campaignBodies('Hi Asha\nOffer: 5 < 6 & more', url);
    expect(text).toBe(`Hi Asha\nOffer: 5 < 6 & more\n\nUnsubscribe: ${url}`);
  });

  it('the HTML part is the message escaped, line breaks kept, and the link an anchor', () => {
    const { html } = campaignBodies('Hi <b>Asha</b>\nOffer: 5 < 6 & "more"', url);
    expect(html).toContain(
      'Hi &lt;b&gt;Asha&lt;/b&gt;<br>\nOffer: 5 &lt; 6 &amp; &quot;more&quot;',
    );
    expect(html).not.toContain('<b>');
    expect(html).toContain('<a href="https://app.test/u/tok?x=1&amp;y=2">Unsubscribe</a>');
  });

  it('a script in the body never reaches the page as markup', () => {
    const { html } = campaignBodies('<script>alert(1)</script>', url);
    expect(html).not.toMatch(/<script/i);
  });
});

describe('one line', () => {
  it('turns line breaks into one space and trims', () => {
    expect(oneLine(' a\r\nb\n\nc ')).toBe('a b c');
  });
});
