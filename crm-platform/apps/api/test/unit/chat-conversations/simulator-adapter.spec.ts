import { describe, expect, it } from 'vitest';
import { SIMULATOR_DEFAULTS, type ChannelSettings } from '@crm/contracts';
import {
  SimulatorAdapter,
  ChannelError,
  inboundDup,
  outboundFault,
  outboundEnvelopeSchema,
  type ChannelRuntime,
} from '../../../src/infra/providers/chat-conversations';

const settings = (
  over: Partial<NonNullable<ChannelSettings['simulator']>> = {},
): ChannelSettings => ({
  metered: false,
  simulator: { ...SIMULATOR_DEFAULTS, ...over },
});

const channel = (s: ChannelSettings = settings()): ChannelRuntime => ({
  orgId: 1,
  uuid: '11111111-1111-4111-8111-111111111111',
  kind: 'simulator',
  status: 'connected',
  externalId: null,
  displayAddress: null,
  settings: s,
  capabilityOverrides: {},
  credentials: {},
});

const text = (body: string, attempt = 1, ref = 'ref-1') =>
  outboundEnvelopeSchema.parse({
    kind: 'text',
    to: '919876543210',
    clientReference: ref,
    body,
    attempt,
  });

const adapter = () => new SimulatorAdapter({ slowMs: 20, env: { NODE_ENV: 'test' } });

describe('simulator faults: the prefixes', () => {
  it('outboundFault reads /fail /flaky /slow /ooo at the start, case-insensitively, as a whole word', () => {
    expect(outboundFault('/fail please')).toBe('fail');
    expect(outboundFault('  /FLAKY')).toBe('flaky');
    expect(outboundFault('/slow')).toBe('slow');
    expect(outboundFault('/ooo hi')).toBe('ooo');
    expect(outboundFault('/failed')).toBeNull();
    expect(outboundFault('hello /fail')).toBeNull();
    expect(outboundFault(undefined)).toBeNull();
  });

  it('inboundDup asks for duplicate delivery and strips the prefix', () => {
    expect(inboundDup('/dup hello there')).toEqual({ dup: true, text: 'hello there' });
    expect(inboundDup('/dup')).toEqual({ dup: true, text: undefined });
    expect(inboundDup('hello /dup')).toEqual({ dup: false, text: 'hello /dup' });
    expect(inboundDup('/duplicate')).toEqual({ dup: false, text: '/duplicate' });
  });
});

describe('SimulatorAdapter.send', () => {
  it('/fail is a permanent rejection (not retryable) with the simulator code', async () => {
    const err = await adapter()
      .send(channel(), text('/fail nope'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ code: 'SIM_REJECTED', retryable: false });
  });

  it('/flaky is a retryable error on attempts 1 and 2 and succeeds on attempt 3', async () => {
    const a = adapter();
    for (const attempt of [1, 2]) {
      const err = await a.send(channel(), text('/flaky', attempt)).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'SIM_FLAKY', retryable: true });
    }
    const ok = await a.send(channel(), text('/flaky', 3));
    expect(ok.providerMessageId).toMatch(/^sim\./);
  });

  it('/slow waits before answering', async () => {
    const t0 = Date.now();
    await adapter().send(channel(), text('/slow'));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
  });

  it('a plain message is accepted and plans sent, delivered, read at the configured latencies', async () => {
    const r = await adapter().send(
      channel(settings({ latencyMs: { sent: 5, delivered: 50, read: 90 } })),
      text('hello'),
    );
    expect(r.plannedReceipts).toEqual([
      { status: 'sent', delayMs: 5 },
      { status: 'delivered', delayMs: 50 },
      { status: 'read', delayMs: 90 },
    ]);
  });

  it('/ooo plans the receipts in reverse: read, then delivered, then sent', async () => {
    const r = await adapter().send(channel(), text('/ooo hi'));
    const order = [...r.plannedReceipts!]
      .sort((a, b) => a.delayMs - b.delayMs)
      .map((p) => p.status);
    expect(order).toEqual(['read', 'delivered', 'sent']);
  });

  it('the provider id comes from the client reference: the same message twice is the same id, another message is another', async () => {
    const a = adapter();
    const one = await a.send(channel(), text('a', 1, 'ref-A'));
    const again = await a.send(channel(), text('a', 2, 'ref-A'));
    const other = await a.send(channel(), text('a', 1, 'ref-B'));
    expect(again.providerMessageId).toBe(one.providerMessageId);
    expect(other.providerMessageId).not.toBe(one.providerMessageId);
  });

  it('a media caption can carry a fault too', async () => {
    const env = outboundEnvelopeSchema.parse({
      kind: 'media',
      to: '919876543210',
      clientReference: 'r',
      media: { key: 'k', mediaKind: 'image', mime: 'image/png', caption: '/fail' },
    });
    await expect(adapter().send(channel(), env)).rejects.toMatchObject({ code: 'SIM_REJECTED' });
  });
});

describe('SimulatorAdapter: the 24 hour window', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('auto: closed before any customer message, open for 24 hours after one, closed after', () => {
    const a = adapter();
    expect(a.windowInfo(channel(), null, now)).toEqual({ open: false, expiresAt: null });
    const recent = new Date('2026-10-10T00:00:00Z');
    const w = a.windowInfo(channel(), recent, now);
    expect(w.open).toBe(true);
    expect(w.expiresAt?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(a.windowInfo(channel(), new Date('2026-10-08T00:00:00Z'), now).open).toBe(false);
  });

  it('open and closed force the answer whatever the last message was (the window toggle)', () => {
    const a = adapter();
    expect(a.windowInfo(channel(settings({ window: 'open' })), null, now).open).toBe(true);
    expect(
      a.windowInfo(channel(settings({ window: 'closed' })), new Date('2026-10-10T11:59:00Z'), now)
        .open,
    ).toBe(false);
  });
});

describe('SimulatorAdapter: inbound', () => {
  it('turns a text payload built by the dev route into a normalised message', () => {
    const { id, payload } = SimulatorAdapter.inboundPayload(
      { from: '919876543210', name: 'Asha', kind: 'text', text: '/dup hello' },
      new Date('2026-10-10T12:00:00Z'),
    );
    const parsed = adapter().parseInbound(channel(), payload);
    expect(parsed.receipts).toEqual([]);
    expect(parsed.messages).toEqual([
      {
        providerMessageId: id,
        peerKey: '919876543210',
        peerName: 'Asha',
        kind: 'text',
        body: 'hello',
        providerTimestamp: new Date('2026-10-10T12:00:00Z'),
      },
    ]);
  });

  it('keeps an explicit provider message id, and /dup or fault dup asks for repeat delivery', () => {
    const base = { from: '919876543210', kind: 'text' as const, providerMessageId: 'wamid.X' };
    expect(SimulatorAdapter.inboundPayload({ ...base, text: 'hi' }).id).toBe('wamid.X');
    expect(SimulatorAdapter.wantsDuplicateDelivery({ ...base, text: '/dup hi' })).toBe(true);
    expect(SimulatorAdapter.wantsDuplicateDelivery({ ...base, text: 'hi', fault: 'dup' })).toBe(
      true,
    );
    expect(SimulatorAdapter.wantsDuplicateDelivery({ ...base, text: 'hi' })).toBe(false);
  });

  it('media and location payloads normalise, with a media id derived from the message id', () => {
    const media = SimulatorAdapter.inboundPayload({
      from: '919876543210',
      kind: 'media',
      media: { mediaKind: 'image', mime: 'image/jpeg', name: 'a.jpg' },
      providerMessageId: 'm1',
    });
    const m = adapter().parseInbound(channel(), media.payload).messages[0]!;
    expect(m.kind).toBe('media');
    expect(m.media).toMatchObject({
      providerMediaId: 'm1.media',
      mediaKind: 'image',
      mime: 'image/jpeg',
    });

    const loc = SimulatorAdapter.inboundPayload({
      from: '919876543210',
      kind: 'location',
      location: { latitude: 12.9, longitude: 77.6, name: 'Office' },
    });
    expect(adapter().parseInbound(channel(), loc.payload).messages[0]).toMatchObject({
      kind: 'location',
      location: { latitude: 12.9, longitude: 77.6, name: 'Office' },
    });
  });

  it('turns a receipt payload into a normalised receipt', () => {
    const payload = SimulatorAdapter.receiptPayload(
      { providerMessageId: 'p1', status: 'failed', errorCode: 'X1', delayMs: 0 },
      new Date('2026-10-10T12:00:00Z'),
    );
    expect(adapter().parseInbound(channel(), payload).receipts).toEqual([
      {
        providerMessageId: 'p1',
        status: 'failed',
        at: new Date('2026-10-10T12:00:00Z'),
        errorCode: 'X1',
        errorMessage: undefined,
      },
    ]);
  });

  it('garbage in is an empty result, not an exception', () => {
    expect(adapter().parseInbound(channel(), null)).toEqual({ messages: [], receipts: [] });
    expect(adapter().parseInbound(channel(), { messages: [{ nope: true }] })).toEqual({
      messages: [],
      receipts: [],
    });
  });

  it('is never reachable from a public webhook: verifyInbound is false whatever it is given', () => {
    expect(adapter().verifyInbound()).toBe(false);
  });

  it('a downloaded image is a real PNG, any other file is plain text', async () => {
    const img = await adapter().fetchMedia(channel(), {
      providerMediaId: 'x',
      mediaKind: 'image',
      mime: 'image/jpeg',
    });
    expect(img.mime).toBe('image/png');
    expect([...img.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const doc = await adapter().fetchMedia(channel(), {
      providerMediaId: 'x',
      mediaKind: 'document',
      mime: 'application/pdf',
      name: 'a.pdf',
    });
    expect(doc.mime).toBe('text/plain');
  });
});

describe('SimulatorAdapter: production', () => {
  it('refuses to be created in a production environment', () => {
    expect(() => new SimulatorAdapter({ env: { NODE_ENV: 'production' } })).toThrow(/production/);
  });

  it('is WhatsApp-shaped: 24 hour window, templates, media, reactions, all three receipts', () => {
    expect(adapter().capabilities()).toMatchObject({
      windowHours: 24,
      templates: true,
      reactions: true,
      receipts: ['sent', 'delivered', 'read'],
    });
  });
});
