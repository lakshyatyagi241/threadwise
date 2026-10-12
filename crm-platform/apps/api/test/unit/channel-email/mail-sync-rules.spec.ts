import { describe, expect, it } from 'vitest';
import { GoogleMailError } from '../../../src/infra/providers/channel-email';
import {
  backfillQuery,
  isQuiet,
  planBatch,
  planFailure,
  skippableByLabels,
} from '../../../src/modules/channel-email/mail-sync-rules';
import { recipientsOf, replyMessageId } from '../../../src/modules/channel-email/email-send-rules';
import {
  attachmentIdOfKey,
  keyOfAttachmentId,
} from '../../../src/modules/channel-email/mail-ingest.service';

describe('TW-MAIL-021: sync decisions', () => {
  it('only live history mail alerts; backfill and repair are quiet', () => {
    expect(isQuiet('history')).toBe(false);
    expect(isQuiet('backfill')).toBe(true);
    expect(isQuiet('repair')).toBe(true);
  });

  it('drafts, spam and trash are skipped before they are downloaded; unknown labels are not', () => {
    expect(skippableByLabels(['INBOX', 'SPAM'])).toBe(true);
    expect(skippableByLabels(['DRAFT'])).toBe(true);
    expect(skippableByLabels(['TRASH'])).toBe(true);
    expect(skippableByLabels(['INBOX', 'UNREAD'])).toBe(false);
    expect(skippableByLabels(null)).toBe(false);
  });

  it('a batch is oldest first and cut at the cap, saying whether mail is left', () => {
    const newestFirst = ['e', 'd', 'c', 'b', 'a'].map((id) => ({ id }));
    expect(planBatch(newestFirst, 3)).toEqual({
      batch: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      leftover: true,
    });
    expect(planBatch(newestFirst, 5).leftover).toBe(false);
    expect(planBatch([], 3)).toEqual({ batch: [], leftover: false });
  });

  it('the backfill reads the last days', () => {
    expect(backfillQuery(7)).toBe('newer_than:7d');
  });

  it('a failure is described without Google words; outages retry, refusals do not', () => {
    const retry = (kind: ConstructorParameters<typeof GoogleMailError>[0]) =>
      planFailure(new GoogleMailError(kind, 500, 'x'));
    for (const k of ['server', 'network', 'timeout', 'rate_limit', 'auth'] as const)
      expect(retry(k).retry).toBe(true);
    for (const k of ['forbidden', 'invalid_client', 'bad_request'] as const)
      expect(retry(k).retry).toBe(false);
    expect(retry('forbidden').message).toMatch(/Reconnect/);
    expect(retry('server').message).not.toMatch(/500|x/);
  });
});

describe('TW-MAIL-022: the reply', () => {
  it('its Message-ID comes from the idempotency key, so a retry builds the same one', () => {
    expect(replyMessageId('7b0f-1', 'support@acme.test')).toBe('tw.7b0f-1@acme.test');
    expect(replyMessageId('a b/c', 'support@acme.test')).toBe('tw.a-b-c@acme.test');
    expect(replyMessageId('x', 'nodomain')).toBe('tw.x@mail.invalid');
  });

  it('recipients are lower-cased, listed once, and the mailbox itself is left out of cc and bcc', () => {
    const email = {
      to: ['Ana@Example.com'],
      cc: ['ana@example.com', 'Bob@x.com', 'SUPPORT@acme.test'],
      bcc: ['bob@x.com', 'c@x.com', 'support@acme.test'],
      subject: 's',
      inReplyTo: null,
      references: [],
      threadId: 't',
    };
    expect(recipientsOf(email, 'support@acme.test')).toEqual({
      to: ['ana@example.com'],
      cc: ['bob@x.com'],
      bcc: ['c@x.com'],
    });
  });

  it('an attachment id is the object key and comes back as it was', () => {
    const key = 'chat/12/2026/10/3f9a8c.pdf';
    expect(keyOfAttachmentId(attachmentIdOfKey(key))).toBe(key);
    expect(attachmentIdOfKey(key)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(attachmentIdOfKey(key).length).toBeLessThanOrEqual(128);
  });
});
