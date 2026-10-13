import { describe, expect, it } from 'vitest';
import { emailReplyExtrasSchema, MAIL_ATTACHMENTS_MAX_COUNT } from '@crm/contracts';
import {
  emailEnvelopeOf,
  messageFieldsOf,
} from '../../../src/modules/chat-conversations/outbound-envelope';

const inbound = {
  subject: 'Hello',
  from: { name: null, address: 'c@x.test' },
  messageId: 'm1@x',
  references: [],
  threadId: 't1',
};
const ID = '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50';

describe('TW-MAIL-027: reply extras travel from the composer to the adapter', () => {
  it('the contract accepts attachment ids, a signature id and signature: false, and caps the count', () => {
    const ok = emailReplyExtrasSchema.parse({
      attachmentIds: [ID],
      signatureId: ID,
      signature: false,
    });
    expect(ok).toMatchObject({ attachmentIds: [ID], signatureId: ID, signature: false });
    expect(
      emailReplyExtrasSchema.safeParse({
        attachmentIds: Array(MAIL_ATTACHMENTS_MAX_COUNT + 1).fill(ID),
      }).success,
    ).toBe(false);
    expect(emailReplyExtrasSchema.safeParse({ attachmentIds: ['nope'] }).success).toBe(false);
  });

  it('a queued message keeps them, and only when something is set', () => {
    const quiet = messageFieldsOf({ kind: 'text', body: 'hi', email: { cc: [], bcc: [] } });
    expect(quiet.meta).toEqual({});
    const withFiles = messageFieldsOf({
      kind: 'text',
      body: 'hi',
      email: { cc: [], bcc: [], attachmentIds: [ID], signature: false },
    });
    expect(withFiles.meta).toEqual({
      emailReply: { cc: [], bcc: [], attachmentIds: [ID], signature: false },
    });
  });

  it('the envelope carries them with the writing user; a plain reply carries nothing extra', () => {
    expect(emailEnvelopeOf(inbound, undefined, 't1')).toEqual({
      to: ['c@x.test'],
      cc: [],
      bcc: [],
      subject: 'Re: Hello',
      inReplyTo: 'm1@x',
      references: ['m1@x'],
      threadId: 't1',
    });
    expect(
      emailEnvelopeOf(
        inbound,
        { cc: [], bcc: [], attachmentIds: [ID], signatureId: ID, signature: false },
        't1',
        7,
      ),
    ).toMatchObject({ attachmentIds: [ID], signatureId: ID, signature: false, sentBy: 7 });
  });
});
