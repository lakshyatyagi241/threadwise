import { describe, expect, it, vi } from 'vitest';
import { emailMetaSchema, sendMessageSchema, messageBodyMaxFor } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { outboundTextMaxFor } from '../../../src/infra/providers/chat-conversations';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { normalizeSettings } from '../../../src/modules/chat-conversations/channel-settings';
import { ChannelDispatcher } from '../../../src/modules/chat-conversations/channel-dispatcher.service';
import {
  InboundMessageHooks,
  isAutomatedEmail,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../../../src/modules/chat-conversations/inbound-hooks';
import {
  EMAIL_META_MAX_BYTES,
  channelMetaOf,
  emailMetaOf,
} from '../../../src/modules/chat-conversations/message-rules';
import {
  defaultTitle,
  identityOfPeer,
  normalizePeerKey,
} from '../../../src/modules/chat-conversations/peer-key';
import {
  emailEnvelopeOf,
  envelopeOf,
  messageFieldsOf,
  replySubject,
  threadIdOfPeerKey,
} from '../../../src/modules/chat-conversations/outbound-envelope';
import { FakeEmailAdapter } from '../../e2e/chat-conversations/fake-email-adapter';

const mail = (over: Record<string, unknown> = {}) => ({
  subject: 'Invoice question',
  from: { name: 'Ada', address: 'ada@example.com' },
  to: [{ name: null, address: 'support@shop.test' }],
  messageId: 'm2@example.com',
  references: ['m1@example.com'],
  threadId: '18c0ffee',
  ...over,
});

describe('peer key and title for email', () => {
  it('keeps the thread key exactly as given (case kept, no phone rules), at most 128 characters', () => {
    expect(normalizePeerKey('email', '  t:18C0ffee ')).toBe('t:18C0ffee');
    expect(normalizePeerKey('email', 't:' + 'a'.repeat(126))).toHaveLength(128);
    expect(normalizePeerKey('email', 't:' + 'a'.repeat(127))).toBeNull();
    expect(normalizePeerKey('email', '   ')).toBeNull();
  });

  it('has no contact identity of its own (the adapter says whose mail it is)', () => {
    expect(identityOfPeer('email', 't:18c0ffee')).toBeNull();
  });

  it('names a thread by the sender, else "(no subject)", never by the opaque key', () => {
    expect(defaultTitle('email', 't:1', 'Ada')).toBe('Ada');
    expect(defaultTitle('email', 't:1', null)).toBe('(no subject)');
  });
});

describe('channelMetaOf with the email block', () => {
  const big = 'x'.repeat(60_000);

  it('keeps a valid email block for kind email, with the parsed defaults', () => {
    const picked = channelMetaOf({ email: mail({ html: '<p>hi</p>' }) }, 'email');
    expect(emailMetaSchema.parse(picked.email).html).toBe('<p>hi</p>');
    expect((picked.email as { automated: boolean }).automated).toBe(false);
  });

  it('ignores the email key on every other kind (the 16K cap is not loosened for them)', () => {
    expect(channelMetaOf({ email: mail() }, 'telegram')).toEqual({});
    expect(channelMetaOf({ email: mail() })).toEqual({});
    expect(channelMetaOf({ referral: { a: 'x'.repeat(17_000) } }, 'whatsapp_cloud')).toEqual({});
  });

  it('keeps the 16K cap on the other keys even for an email message', () => {
    expect(channelMetaOf({ referral: { a: 'x'.repeat(17_000) }, email: mail() }, 'email')).toEqual(
      {},
    );
  });

  it('drops a malformed email block instead of storing it or failing', () => {
    expect(channelMetaOf({ email: { subject: 1 } }, 'email')).toEqual({});
    expect(channelMetaOf({ email: 'nope' }, 'email')).toEqual({});
  });

  it('strips keys the schema does not know', () => {
    const picked = channelMetaOf({ email: mail({ rawMime: 'secret' }) }, 'email');
    expect(picked.email).not.toHaveProperty('rawMime');
  });

  it('a 64K html fits the email budget untouched; an over-budget block is trimmed: html first, flagged', () => {
    const fits = emailMetaOf(mail({ html: big }))!;
    expect(fits.html).toBe(big);

    // 100 addresses with long names push the block past the budget even without the html.
    const crowd = Array.from({ length: 100 }, (_, i) => ({
      name: 'n'.repeat(200),
      address: `u${i}@${'d'.repeat(300)}.test`,
    }));
    const trimmed = emailMetaOf(mail({ html: big, to: crowd, cc: crowd, bcc: crowd }))!;
    expect(trimmed.html).toBeNull();
    expect(trimmed.htmlTruncated).toBe(true);
    expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(EMAIL_META_MAX_BYTES);
  });
});

describe('outbound email envelope', () => {
  it('answers the sender, in the thread, with Re: and the references chain', () => {
    const e = emailEnvelopeOf(mail(), null, '18c0ffee')!;
    expect(e).toEqual({
      to: ['ada@example.com'],
      cc: [],
      bcc: [],
      subject: 'Re: Invoice question',
      inReplyTo: 'm2@example.com',
      references: ['m1@example.com', 'm2@example.com'],
      threadId: '18c0ffee',
    });
  });

  it('takes cc, bcc and a subject override from the stored extras', () => {
    const e = emailEnvelopeOf(
      mail(),
      { cc: ['a@x.test'], bcc: ['b@x.test'], subject: 'Your invoice' },
      't',
    )!;
    expect(e.cc).toEqual(['a@x.test']);
    expect(e.bcc).toEqual(['b@x.test']);
    expect(e.subject).toBe('Your invoice');
  });

  it('does not stack Re: and de-duplicates the chain', () => {
    expect(replySubject('RE: hello')).toBe('RE: hello');
    expect(replySubject('hello')).toBe('Re: hello');
    const e = emailEnvelopeOf(
      mail({ references: ['m1@example.com', 'm2@example.com'] }),
      null,
      't',
    )!;
    expect(e.references).toEqual(['m1@example.com', 'm2@example.com']);
  });

  it('keeps the first and the newest ids of a very long chain, within the 100 cap', () => {
    const refs = Array.from({ length: 150 }, (_, i) => `r${i}@x`);
    const e = emailEnvelopeOf(mail({ references: refs }), null, 't')!;
    expect(e.references).toHaveLength(100);
    expect(e.references[0]).toBe('r0@x');
    expect(e.references.at(-1)).toBe('m2@example.com');
  });

  it('is null when there is no mail to answer; the thread id falls back to the peer key', () => {
    expect(emailEnvelopeOf(null, null, 't')).toBeNull();
    expect(emailEnvelopeOf(mail({ threadId: '' }), null, 'fromkey')!.threadId).toBe('fromkey');
    expect(threadIdOfPeerKey('t:abc')).toBe('abc');
  });

  it('a text message carries the block into the envelope; the reply extras are stored on the message', () => {
    const fields = messageFieldsOf({
      kind: 'text',
      body: 'Thanks',
      email: { cc: ['a@x.test'], bcc: [], subject: 'S' },
    });
    expect(fields.meta).toEqual({ emailReply: { cc: ['a@x.test'], bcc: [], subject: 'S' } });
    expect(messageFieldsOf({ kind: 'text', body: 'Thanks' }).meta).toEqual({});
    expect(
      messageFieldsOf({ kind: 'text', body: 'Thanks', email: { cc: [], bcc: [] } }).meta,
    ).toEqual({});

    const email = emailEnvelopeOf(mail(), fields.meta.emailReply as never, 't');
    const env = envelopeOf(
      {
        ...({} as never),
        kind: 'text',
        body: 'Thanks',
        meta: fields.meta,
        clientMessageId: 'c1',
        uuid: 'u1',
      },
      't:18c0ffee',
      null,
      2,
      email,
    ) as { email?: unknown; attempt: number; clientReference: string };
    expect(env.email).toMatchObject({ subject: 'S', cc: ['a@x.test'] });
    // A retry keeps the same idempotency reference.
    expect(env.clientReference).toBe('c1');
    expect(env.attempt).toBe(2);
  });
});

describe('send limits are per kind', () => {
  it('email takes 100000 characters, every other kind keeps 4096', () => {
    expect(messageBodyMaxFor('email')).toBe(100_000);
    expect(messageBodyMaxFor('whatsapp_cloud')).toBe(4096);
    expect(outboundTextMaxFor('email')).toBe(100_000);
    expect(outboundTextMaxFor('telegram')).toBe(4096);
  });

  it('the send schema accepts cc/bcc/subject and rejects a malformed address', () => {
    const base = { kind: 'text', clientMessageId: crypto.randomUUID(), body: 'hi' };
    const ok = sendMessageSchema.safeParse({
      ...base,
      email: { cc: ['a@x.test'], subject: 'S' },
    });
    expect(ok.success).toBe(true);
    expect(
      sendMessageSchema.safeParse({ ...base, email: { cc: ['not-an-address'] } }).success,
    ).toBe(false);
  });
});

describe('metering', () => {
  it('an email channel is never metered, whatever the stored or sent settings say', () => {
    expect(normalizeSettings('email', { metered: true })).toEqual({ metered: false });
    expect(normalizeSettings('email', undefined)).toEqual({ metered: false });
    expect(normalizeSettings('telegram', undefined)).toEqual({ metered: true });
  });
});

describe('ChannelDispatcher with an email channel', () => {
  const channel = (over: Record<string, unknown> = {}) => ({
    orgId: 7,
    uuid: '11111111-1111-4111-8111-111111111111',
    kind: 'email',
    status: 'connected' as const,
    externalId: null,
    displayAddress: 'support@shop.test',
    settings: { metered: false },
    capabilityOverrides: {},
    credentials: {},
    ...over,
  });
  const dispatcherOf = () => {
    const adapter = new FakeEmailAdapter();
    const plans = { assertWithinLimit: vi.fn(async () => undefined) };
    const dispatcher = new ChannelDispatcher(
      new ChannelAdapterRegistry([adapter]),
      {} as never,
      plans as never,
      { beforeSend: async () => undefined } as never,
      {} as never,
    );
    return { adapter, dispatcher, plans };
  };
  const text = (over: Record<string, unknown> = {}) => ({
    kind: 'text',
    to: 't:18c0ffee',
    clientReference: 'ref-1',
    body: 'Thanks',
    ...over,
  });
  const err = async (p: Promise<unknown>) => (await p.catch((e: unknown) => e)) as AppError;

  it('has no window: a reply is allowed with no customer message and long after the last one, and the plan cap is not consulted', async () => {
    const { dispatcher, plans } = dispatcherOf();
    for (const lastInboundAt of [null, new Date(Date.now() - 90 * 24 * 3_600_000)]) {
      const r = await dispatcher.assertCanQueue(
        { channel: channel() as never, envelope: text(), lastInboundAt },
        { monthlyUsed: 10_000 },
      );
      expect(r.window.open).toBe(true);
    }
    expect(plans.assertWithinLimit).not.toHaveBeenCalled();
  });

  it('accepts a long email body, and still refuses it on any other kind', async () => {
    const { dispatcher } = dispatcherOf();
    const long = text({ body: 'x'.repeat(50_000) });
    await expect(
      dispatcher.assertCanQueue({
        channel: channel() as never,
        envelope: long,
        lastInboundAt: null,
      }),
    ).resolves.toBeDefined();
    const sim = new FakeEmailAdapter();
    const other = new ChannelDispatcher(
      new ChannelAdapterRegistry([Object.assign(sim, { kind: 'telegram' })]) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const e = await err(
      other.assertCanQueue({
        channel: channel({ kind: 'telegram' }) as never,
        envelope: long,
        lastInboundAt: null,
      }),
    );
    expect(e.code).toBe('VALIDATION_FAILED');
  });

  it('refuses templates and files on email (capabilities)', async () => {
    const { dispatcher } = dispatcherOf();
    const template = {
      kind: 'template',
      to: 't:1',
      clientReference: 'r',
      template: { name: 'n', language: 'en' },
    };
    expect(
      (
        await err(
          dispatcher.assertCanQueue({
            channel: channel() as never,
            envelope: template,
            lastInboundAt: null,
          }),
        )
      ).code,
    ).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
    const file = {
      kind: 'media',
      to: 't:1',
      clientReference: 'r',
      media: { key: 'k', mediaKind: 'image', mime: 'image/png' },
    };
    expect(
      (
        await err(
          dispatcher.assertCanQueue({
            channel: channel() as never,
            envelope: file,
            lastInboundAt: null,
          }),
        )
      ).code,
    ).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
  });

  it('refuses the email block on a channel of another kind', async () => {
    const sim = Object.assign(new FakeEmailAdapter(), { kind: 'telegram' });
    const d = new ChannelDispatcher(
      new ChannelAdapterRegistry([sim as never]),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const envelope = text({
      email: { to: ['a@x.test'], subject: 'S', inReplyTo: null, references: [], threadId: 't' },
    });
    const e = await err(
      d.assertCanQueue({
        channel: channel({ kind: 'telegram' }) as never,
        envelope,
        lastInboundAt: null,
      }),
    );
    expect(e.code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
  });
});

describe('inbound hooks on email', () => {
  const event = (
    over: Partial<InboundStoredEvent> = {},
    email?: Record<string, unknown>,
  ): InboundStoredEvent =>
    ({
      orgId: 1,
      channelKind: 'email',
      message: {
        kind: 'text',
        body: 'x',
        meta: email ? { email } : {},
        location: null,
        mediaKey: null,
      },
      ...over,
    }) as InboundStoredEvent;

  const listener = (name: string, extra: Partial<InboundMessageListener> = {}) => {
    const onStored = vi.fn(async () => ({ consumed: false }));
    return { name, onStored, ...extra } as InboundMessageListener & { onStored: typeof onStored };
  };

  it('detects automated mail from meta.email', () => {
    expect(isAutomatedEmail(event({}, { automated: true }))).toBe(true);
    expect(isAutomatedEmail(event({}, { automated: false }))).toBe(false);
    expect(isAutomatedEmail(event())).toBe(false);
  });

  it('by default a listener does not run for an email message (no flow or keyword auto-reply), one that opts in does', async () => {
    const hooks = new InboundMessageHooks();
    const flow = listener('flow');
    const routing = listener('routing', { runsOnEmail: true });
    hooks.register(flow);
    hooks.register(routing);
    await hooks.run(event());
    expect(flow.onStored).not.toHaveBeenCalled();
    expect(routing.onStored).toHaveBeenCalledTimes(1);
    // Other channels are untouched.
    await hooks.run(event({ channelKind: 'telegram' }));
    expect(flow.onStored).toHaveBeenCalledTimes(1);
  });

  it('automated mail reaches no listener at all and counts as consumed', async () => {
    const hooks = new InboundMessageHooks();
    const routing = listener('routing', { runsOnEmail: true });
    hooks.register(routing);
    const r = await hooks.run(event({}, { automated: true }));
    expect(r).toEqual({ consumed: true });
    expect(routing.onStored).not.toHaveBeenCalled();
  });
});
