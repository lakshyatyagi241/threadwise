import { describe, expect, it } from 'vitest';
import { normaliseMetaWebhook, UNSUPPORTED_131051 } from '../../../src/infra/providers/whatsapp/meta-inbound';
import { FX, webhookFixture } from '../../fixtures/whatsapp';

const ctx = { phoneNumberId: FX.phoneNumberId };
const one = (name: string) => {
  const parsed = normaliseMetaWebhook(webhookFixture(name), ctx);
  expect(parsed.messages, name).toHaveLength(1);
  return parsed.messages[0]!;
};

describe('normaliseMetaWebhook: inbound messages, one fixture per type', () => {
  it('text: body, sender digits, profile name, provider time', () => {
    expect(one('text')).toMatchObject({
      kind: 'text',
      body: 'Hi, is the course still open?',
      peerKey: FX.customer,
      peerName: 'Asha Rao',
      providerTimestamp: new Date(1760000000 * 1000),
    });
  });

  it('a reply carries the id of the message it answers; a forwarded flag lands in meta', () => {
    expect(one('text-reply').replyToProviderMessageId).toBe('wamid.OUT1');
    expect(one('text-forwarded').meta).toEqual({ forwarded: true });
  });

  it('image: media reference with mime, sha256 and the caption as body', () => {
    expect(one('image')).toMatchObject({
      kind: 'media',
      body: 'My marksheet',
      media: { providerMediaId: '1166733224118011', mediaKind: 'image', mime: 'image/jpeg', sha256: 'a'.repeat(64) },
    });
  });

  it('a voice note is audio with the voice flag; a plain audio file is not', () => {
    expect(one('voice').media).toMatchObject({ mediaKind: 'audio', voice: true });
    expect(one('audio-file').media?.voice).toBeUndefined();
  });

  it('document keeps its file name and caption; video and sticker are media too', () => {
    expect(one('document')).toMatchObject({
      body: 'Resume',
      media: { mediaKind: 'document', name: 'resume.pdf', mime: 'application/pdf' },
    });
    expect(one('video').media?.mediaKind).toBe('video');
    expect(one('sticker').media?.mediaKind).toBe('sticker');
  });

  it('a media message with no media id cannot be fetched: it is stored as unsupported, not dropped', () => {
    expect(one('image-no-id')).toMatchObject({ kind: 'unsupported', body: '[Image message]', meta: { rawType: 'image' } });
  });

  it('location', () => {
    expect(one('location')).toMatchObject({
      kind: 'location',
      location: { latitude: 37.4845, longitude: -122.1477, name: 'Meta HQ', address: '1 Hacker Way, Menlo Park' },
    });
  });

  it('contacts: every card with its phones, emails and company; the body is the first name', () => {
    const m = one('contacts');
    expect(m.kind).toBe('contact');
    expect(m.body).toBe('Ravi Kumar');
    expect(m.meta?.contacts).toEqual([
      { name: 'Ravi Kumar', phones: ['+91 98765 11111', '+91 22 5555 0000'], emails: ['ravi@example.test'], org: 'Example Ltd' },
      { name: 'Meera Shah', phones: ['+91 98765 22222'], emails: [], org: null },
    ]);
  });

  it('reaction: set carries the emoji and the target; removed carries an empty emoji', () => {
    expect(one('reaction-set')).toMatchObject({ kind: 'reaction', replyToProviderMessageId: 'wamid.OUT1', reactionEmoji: '\u{1F44D}' });
    expect(one('reaction-removed')).toMatchObject({ kind: 'reaction', replyToProviderMessageId: 'wamid.OUT1', reactionEmoji: '' });
  });

  it('interactive replies: button_reply, list_reply, template quick-reply button', () => {
    expect(one('button-reply')).toMatchObject({
      kind: 'interactive',
      body: 'Yes, call me',
      replyToProviderMessageId: 'wamid.OUT2',
      meta: { interactive: { type: 'button_reply', id: 'opt_yes', title: 'Yes, call me', description: null } },
    });
    expect(one('list-reply').meta).toEqual({
      interactive: { type: 'list_reply', id: 'row_small', title: 'Small', description: '250 ml' },
    });
    expect(one('template-button')).toMatchObject({
      kind: 'interactive',
      body: 'Confirm',
      meta: { interactive: { type: 'button', id: null, title: 'Confirm' }, buttonPayload: 'CONFIRM_APPT' },
    });
  });

  it('a form (nfm) reply keeps its answer', () => {
    expect(one('flow-reply')).toMatchObject({
      kind: 'interactive',
      body: 'Sent',
      meta: { flowName: 'flow', flowResponse: '{"flow_token":"t","city":"Pune"}' },
    });
  });

  it('an ad click: the referral is kept on the message that carried it', () => {
    expect(one('referral').meta?.referral).toEqual({
      sourceType: 'ad',
      sourceUrl: 'https://fb.me/ad123',
      sourceId: '120200000000',
      headline: 'Admissions open',
      body: 'Apply today',
      ctwaClid: 'AfXYZ',
    });
  });

  it('an order is stored as an unsupported placeholder with its text and item count', () => {
    expect(one('order')).toMatchObject({ kind: 'unsupported', body: 'Two for me', meta: { rawType: 'order', order: { catalogId: 'cat1', items: 1 } } });
  });

  it('Meta\'s own "unsupported" (131051) gets its placeholder text; any unknown type is stored with its raw type, never dropped', () => {
    expect(one('unsupported-131051')).toMatchObject({ kind: 'unsupported', body: UNSUPPORTED_131051, meta: { rawType: 'unsupported', providerErrors: [131051] } });
    expect(one('unknown-type-poll')).toMatchObject({ kind: 'unsupported', body: '[Poll message]', meta: { rawType: 'poll' } });
  });

  it('a batch keeps every message in order', () => {
    const parsed = normaliseMetaWebhook(webhookFixture('batch'), ctx);
    expect(parsed.messages.map((m) => m.providerMessageId)).toEqual(['wamid.B1', 'wamid.B2', 'wamid.B3']);
    expect(parsed.messages[2]!.kind).toBe('media');
  });
});

describe('normaliseMetaWebhook: what is ignored, and why', () => {
  const ignored = (name: string) => {
    const parsed = normaliseMetaWebhook(webhookFixture(name), ctx);
    expect(parsed.messages).toEqual([]);
    expect(parsed.receipts).toEqual([]);
    return parsed.ignored;
  };

  it('a system message (the customer changed number) is ignored safely', () => {
    expect(ignored('system-number-change')).toEqual([{ reason: 'system', detail: 'user_changed_number' }]);
  });
  it('a group message is not stored as a one-to-one thread', () => {
    expect(ignored('group-message')).toEqual([{ reason: 'group_message', detail: 'text' }]);
  });
  it('a message from our own number (a business-app echo) is not a customer message', () => {
    expect(ignored('own-number-echo')).toEqual([{ reason: 'own_number_echo', detail: 'text' }]);
  });
  it('a change that names another phone number is not this channel\'s', () => {
    expect(ignored('other-number')).toEqual([{ reason: 'other_number', detail: '999999999999999' }]);
  });
  it('a non-message field (template status) is ignored', () => {
    expect(ignored('field-template-status')).toEqual([{ reason: 'field', detail: 'message_template_status_update' }]);
  });
  it('with no channel number known, a change is not filtered by number', () => {
    expect(normaliseMetaWebhook(webhookFixture('other-number')).messages).toHaveLength(1);
  });
});

describe('normaliseMetaWebhook: delivery receipts', () => {
  const receipts = (name: string) => normaliseMetaWebhook(webhookFixture(name), ctx).receipts;

  it('sent, delivered and read carry the provider id and time', () => {
    expect(receipts('status-sent')).toEqual([{ providerMessageId: 'wamid.OUT1', status: 'sent', at: new Date(1760000100 * 1000) }]);
    expect(receipts('status-delivered')[0]).toMatchObject({ status: 'delivered' });
    expect(receipts('status-read')[0]).toMatchObject({ status: 'read' });
  });

  it('a failure is classified into our vocabulary and keeps Meta\'s words', () => {
    const [w] = receipts('status-failed-131047');
    expect(w).toMatchObject({ status: 'failed', errorCode: 'SERVICE_WINDOW_CLOSED' });
    expect(w!.errorMessage).toContain('more than 24 hours');
    expect(w!.errorMessage).toContain('#131047');
    expect(receipts('status-failed-131026')[0]!.errorCode).toBe('RECIPIENT_UNDELIVERABLE');
    expect(receipts('status-failed-131048')[0]!.errorCode).toBe('SPAM_RATE_LIMITED');
    expect(receipts('status-failed-131049')[0]!.errorCode).toBe('ECOSYSTEM_ENGAGEMENT_BLOCKED');
  });

  it('an error code the table does not know keeps its number', () => {
    expect(receipts('status-failed-unknown-code')[0]!.errorCode).toBe('139999');
  });

  it('a status Meta added later and a group status are ignored; out-of-order statuses are all reported', () => {
    expect(receipts('status-deleted')).toEqual([]);
    expect(receipts('status-group')).toEqual([]);
    expect(receipts('status-mixed').map((r) => r.status)).toEqual(['read', 'delivered', 'sent']);
  });
});

describe('normaliseMetaWebhook never throws', () => {
  it.each([null, undefined, 'x', 42, [], {}, { entry: 'no' }, { entry: [null] }, { entry: [{ changes: 'no' }] }, { entry: [{ changes: [{ value: { messages: [null, 1, 'x', {}] } }] }] }])(
    'for %j',
    (bad) => {
      expect(() => normaliseMetaWebhook(bad, ctx)).not.toThrow();
    },
  );

  it('a message without an id or a sender is ignored, not stored', () => {
    const p = normaliseMetaWebhook({ entry: [{ changes: [{ value: { messages: [{ type: 'text', from: '9198' }, { id: 'a', type: 'text' }] } }] }] });
    expect(p.messages).toEqual([]);
    expect(p.ignored).toEqual([{ reason: 'no_message_id', detail: 'text' }, { reason: 'no_sender', detail: 'text' }]);
  });

  it('a timestamp that is not a number falls back to now instead of an invalid date', () => {
    const p = normaliseMetaWebhook({ entry: [{ changes: [{ value: { messages: [{ id: 'a', from: '919800000000', type: 'text', timestamp: 'x', text: { body: 'hi' } }] } }] }] });
    expect(Number.isNaN(p.messages[0]!.providerTimestamp.getTime())).toBe(false);
  });
});
