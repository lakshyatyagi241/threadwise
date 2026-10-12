import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import { MailOutboundPreparer } from '../../../src/modules/channel-email/mail-outbound.preparer';
import { attachmentNotFound } from '../../../src/modules/channel-email/mail-outbound-errors';
import { ChannelError } from '../../../src/infra/providers/chat-conversations/channel.port';
import type { OutgoingMail } from '../../../src/infra/providers/channel-email';

type Sig = { bodyHtml: string; bodyText: string };
interface Library {
  user?: Sig;
  mailbox?: Sig;
  named?: Record<string, Sig>;
}

/** Mirrors the SQL of `MailSignaturesRepository.forSend` over an in-memory library. */
function makePreparer(
  lib: Library,
  opts: { files?: () => Promise<unknown[]>; used?: string[][] } = {},
) {
  const signatures = {
    forSend: (_tx: unknown, _org: number, q: { named: string | null; userId: number | null }) => {
      if (q.named) return Promise.resolve(lib.named?.[q.named] ?? 'missing');
      return Promise.resolve((q.userId ? lib.user : undefined) ?? lib.mailbox ?? null);
    },
    senderFacts: () => Promise.resolve({ name: 'Ana Agent', title: 'Lead', phone: '+1555' }),
  };
  const files = {
    resolveForSend: opts.files ?? (() => Promise.resolve([])),
    markUsed: (_o: number, _u: number | null, ids: string[]) => {
      opts.used?.push([...ids]);
      return Promise.resolve();
    },
  };
  const db = { txAs: (_t: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  return new MailOutboundPreparer(db as never, signatures as never, files as never);
}

const mailbox = { id: 7, address: 'support@acme.test' } as never;
const draft = (over: Partial<OutgoingMail> = {}): OutgoingMail => ({
  messageId: 'tw.1@acme.test',
  from: { name: 'Acme', address: 'support@acme.test' },
  to: ['c@x.test'],
  cc: [],
  bcc: [],
  subject: 'Re: hi',
  text: 'Hello',
  html: null,
  inReplyTo: 'o@x',
  references: ['o@x'],
  threadKey: 't1',
  attachments: [],
  headers: {},
  attempt: 1,
  ...over,
});
const email = (over: Record<string, unknown> = {}) =>
  ({
    to: ['c@x.test'],
    cc: [],
    bcc: [],
    subject: 'Re: hi',
    inReplyTo: 'o@x',
    references: [],
    threadId: 't1',
    sentBy: 5,
    ...over,
  }) as never;
const ctx = (e = email()) => ({ orgId: 1, mailbox, email: e });

describe('TW-MAIL-027: which signature a reply gets', () => {
  const lib: Library = {
    user: { bodyHtml: '', bodyText: 'USER {{name}}' },
    mailbox: { bodyHtml: '', bodyText: 'MAILBOX' },
    named: {
      '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50': { bodyHtml: '<i>NAMED {{title}}</i>', bodyText: '' },
    },
  };

  it('the named one wins, then the sender default, then the mailbox default', async () => {
    const p = makePreparer(lib);
    const named = await p.prepare(
      ctx(email({ signatureId: '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50' })),
      draft(),
    );
    expect(named.text).toContain('-- \nNAMED Lead');
    expect(named.html).toContain('<i>NAMED Lead</i>');
    expect((await p.prepare(ctx(), draft())).text).toContain('-- \nUSER Ana Agent');
    expect((await makePreparer({ mailbox: lib.mailbox }).prepare(ctx(), draft())).text).toContain(
      '-- \nMAILBOX',
    );
  });

  it('a send by automation (no sender) gets the mailbox default, never a user signature', async () => {
    const out = await makePreparer(lib).prepare(ctx(email({ sentBy: null })), draft());
    expect(out.text).toContain('MAILBOX');
    expect(out.text).not.toContain('USER');
  });

  it('signature: false sends none; no signature configured leaves the mail untouched', async () => {
    const none = await makePreparer(lib).prepare(ctx(email({ signature: false })), draft());
    expect(none.text).toBe('Hello');
    expect(none.html).toBeNull();
    expect(await makePreparer({}).prepare(ctx(), draft())).toEqual(draft());
  });

  it("a named signature that is not the mailbox's or the sender's is refused", async () => {
    await expect(
      makePreparer({}).prepare(
        ctx(email({ signatureId: '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50' })),
        draft(),
      ),
    ).rejects.toMatchObject({ code: 'MAIL_SIGNATURE_NOT_FOUND', retryable: false });
  });
});

describe('TW-MAIL-027: the rich body', () => {
  it('sanitises the composer HTML and derives the text part', async () => {
    const out = await makePreparer({}).prepare(
      ctx(email({ bodyHtml: '<p>Hi <b>Ana</b></p><script>x()</script><p onclick="y()">Bye</p>' })),
      draft({ text: 'composer text' }),
    );
    expect(out.html).toBe('<p>Hi <b>Ana</b></p><p>Bye</p>');
    expect(out.text).toBe('Hi Ana\nBye');
  });
});

describe('TW-MAIL-027: the files', () => {
  const file = {
    uuid: 'u1',
    name: 'a.pdf',
    mime: 'application/pdf',
    size: 4,
    objectKey: 'chat/1/a.pdf',
    bytes: Buffer.from('%PDF'),
  };

  it('puts the resolved bytes in the mail', async () => {
    const out = await makePreparer({}, { files: () => Promise.resolve([file]) }).prepare(
      ctx(email({ attachmentIds: ['u1'] })),
      draft(),
    );
    expect(out.attachments).toEqual([
      {
        name: 'a.pdf',
        mime: 'application/pdf',
        bytes: Buffer.from('%PDF'),
        objectKey: 'chat/1/a.pdf',
      },
    ]);
  });

  it('a refused file ends the send for good with the same code', async () => {
    const p = makePreparer({}, { files: () => Promise.reject(attachmentNotFound() as AppError) });
    const err = await p
      .prepare(ctx(email({ attachmentIds: ['u1'] })), draft())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ retryable: false });
  });

  it('after the send: the files are spent and the message records what went out', async () => {
    const used: string[][] = [];
    const p = makePreparer({}, { files: () => Promise.resolve([file]), used });
    const e = email({ attachmentIds: ['u1'] });
    const mail = await p.prepare(ctx(e), draft({ cc: ['b@x.test'] }));
    const meta = (await p.sent(ctx(e), mail, { providerMessageId: 'g1', threadKey: 'th9' })) as {
      email: {
        attachments: Array<{ name: string; size: number; id: string }>;
        threadId: string;
        delivery: string;
        cc: unknown[];
      };
    };
    expect(used).toEqual([['u1']]);
    expect(meta.email).toMatchObject({
      threadId: 'th9',
      delivery: 'sent',
      cc: [{ name: null, address: 'b@x.test' }],
    });
    expect(meta.email.attachments).toEqual([
      expect.objectContaining({
        name: 'a.pdf',
        size: 4,
        id: Buffer.from('chat/1/a.pdf').toString('base64url'),
      }),
    ]);
  });
});
