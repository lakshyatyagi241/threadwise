import { describe, expect, it, vi } from 'vitest';
import type {
  NormalisedInbound,
  NormalisedReceipt,
} from '../../../src/infra/providers/chat-conversations';
import { MetaCloudProvider } from '../../../src/infra/providers/whatsapp/meta-cloud.provider';
import type { InboundContext } from '../../../src/modules/whatsapp-cloud-api-waba';
import type { ChannelRow } from '../../../src/modules/chat-conversations/channels.repository';
import { WabaInboxSink } from '../../../src/modules/chat-conversations/waba-inbox-sink';
import { WabaChannelSyncConsumer } from '../../../src/modules/chat-conversations/waba-channel-sync.consumer';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { FX, webhookFixture } from '../../fixtures/whatsapp';

/**
 * The inbox's end of the WhatsApp webhook, fed the way the WABA domain feeds it: each payload goes through the WABA domain's own
 * provider (`MetaCloudProvider.parseWebhook`, which yields `NormalisedInboundMessage` / `NormalisedDeliveryEvent`) and then to the sink with
 * the context the ingest builds from the change. What is asserted is what reaches the ingest queue.
 */

const provider = new MetaCloudProvider({} as never, {} as never);

const channel = (over: Partial<ChannelRow> = {}): ChannelRow =>
  ({
    id: 5,
    uuid: '33333333-3333-4333-8333-333333333333',
    kind: 'whatsapp_cloud',
    name: 'Support',
    status: 'connected',
    externalId: FX.phoneNumberId,
    displayAddress: '+1 555-000-1111',
    businessAccountId: FX.wabaId,
    wabaConfigId: 9,
    ...over,
  }) as ChannelRow;

function setup(row: ChannelRow | null = channel()) {
  const links = {
    ensure: vi.fn(async () => row),
    find: vi.fn(async () => row),
  };
  const queued = { messages: [] as NormalisedInbound[], receipts: [] as NormalisedReceipt[] };
  const publisher = {
    enqueueInbound: vi.fn(
      async (_org: number, _uuid: string, m: NormalisedInbound) => void queued.messages.push(m),
    ),
    enqueueReceipt: vi.fn(
      async (_org: number, _uuid: string, r: NormalisedReceipt) => void queued.receipts.push(r),
    ),
  };
  const sink = new WabaInboxSink(links as never, publisher as never);
  return { sink, links, publisher, queued };
}

/** What `WabaIngestService` does with a fixture: parse it, build the context from the change, hand over each message and status. */
async function deliver(name: string, sink: WabaInboxSink) {
  const payload = webhookFixture(name);
  const change = (
    payload.entry as Array<{ changes: Array<{ value: Record<string, unknown> }> }>
  )[0]!.changes[0]!;
  const contacts = change.value.contacts as Array<{ profile?: { name?: string } }> | undefined;
  const ctx: InboundContext = {
    orgId: 7,
    configId: 9,
    configUuid: '44444444-4444-4444-8444-444444444444',
    wabaId: FX.wabaId,
    phoneNumberId: FX.phoneNumberId,
    contactName: contacts?.[0]?.profile?.name ?? null,
  };
  const parsed = provider.parseWebhook({ entry: [{ changes: [{ value: change.value }] }] });
  for (const e of parsed.deliveryEvents) await sink.onStatus(ctx, e);
  for (const m of parsed.inboundMessages) await sink.onMessage(ctx, m);
}

describe('WabaInboxSink.onMessage', () => {
  it("finds or makes the number's channel, and queues the message in the inbox's normalised shape (sender, name, text, provider time)", async () => {
    const { sink, links, publisher, queued } = setup();
    await deliver('text', sink);

    expect(links.ensure).toHaveBeenCalledWith(7, 9, { create: true });
    expect(publisher.enqueueInbound).toHaveBeenCalledTimes(1);
    expect(publisher.enqueueInbound.mock.calls[0]!.slice(0, 2)).toEqual([
      7,
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(queued.messages[0]).toMatchObject({
      providerMessageId: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhggQTEyMw==',
      peerKey: FX.customer,
      peerName: 'Asha Rao',
      kind: 'text',
      body: 'Hi, is the course still open?',
      providerTimestamp: new Date(1760000000 * 1000),
    });
  });

  it('keeps every message type the normaliser understands: media with its id and digest, a reply context, a reaction', async () => {
    const { sink, queued } = setup();
    await deliver('image', sink);
    await deliver('text-reply', sink);
    await deliver('reaction-set', sink);
    expect(queued.messages[0]).toMatchObject({
      kind: 'media',
      body: 'My marksheet',
      media: {
        providerMediaId: '1166733224118011',
        mediaKind: 'image',
        mime: 'image/jpeg',
        sha256: 'a'.repeat(64),
      },
    });
    expect(queued.messages[1]).toMatchObject({
      kind: 'text',
      replyToProviderMessageId: 'wamid.OUT1',
    });
    expect(queued.messages[2]).toMatchObject({ kind: 'reaction' });
  });

  it("a message typed in the business app on the same number is not a customer's: nothing is queued", async () => {
    const { sink, publisher } = setup();
    await deliver('own-number-echo', sink);
    expect(publisher.enqueueInbound).not.toHaveBeenCalled();
  });

  it('a group message is not stored as a one-to-one thread', async () => {
    const { sink, publisher } = setup();
    await deliver('group-message', sink);
    expect(publisher.enqueueInbound).not.toHaveBeenCalled();
  });

  it('a number with no usable channel (held by another workspace) is acknowledged without storing or failing', async () => {
    const { sink, publisher } = setup(null);
    await expect(deliver('text', sink)).resolves.toBeUndefined();
    expect(publisher.enqueueInbound).not.toHaveBeenCalled();
  });

  it("a failure to queue is thrown back, so the WABA ingest releases its claim and Meta's redelivery finishes the job", async () => {
    const { sink, publisher } = setup();
    publisher.enqueueInbound.mockRejectedValueOnce(new Error('redis is down'));
    await expect(deliver('text', sink)).rejects.toThrow('redis is down');
  });
});

describe('WabaInboxSink.onStatus', () => {
  it("queues the delivery report of a message the inbox sent, with the failure classified in the inbox's vocabulary", async () => {
    const { sink, links, queued } = setup();
    await deliver('status-failed-131047', sink);
    expect(links.find).toHaveBeenCalledWith(7, 9);
    expect(links.ensure).not.toHaveBeenCalled(); // a report alone never creates a channel
    expect(queued.receipts).toHaveLength(1);
    expect(queued.receipts[0]).toMatchObject({
      providerMessageId: 'wamid.OUT2',
      status: 'failed',
      errorCode: 'SERVICE_WINDOW_CLOSED',
    });
    expect(queued.receipts[0]!.errorMessage).toContain('more than 24 hours');
  });

  it('delivered and read reports are queued as receipts', async () => {
    const { sink, queued } = setup();
    await deliver('status-delivered', sink);
    await deliver('status-read', sink);
    expect(queued.receipts.map((r) => r.status)).toEqual(['delivered', 'read']);
  });

  it('a report for a number with no channel is dropped', async () => {
    const { sink, publisher } = setup(null);
    await deliver('status-delivered', sink);
    expect(publisher.enqueueReceipt).not.toHaveBeenCalled();
  });
});

describe('WabaChannelSyncConsumer', () => {
  const event = (eventType: string, aggregateId = '9') => ({
    id: '1',
    orgId: 7,
    aggregateModule: 'wa_provider_configs',
    aggregateId,
    eventType,
    payload: {},
  });

  it('registers itself for the three connection events', () => {
    const registry = new OutboxSubscriberRegistry();
    const consumer = new WabaChannelSyncConsumer({} as never, registry);
    consumer.onModuleInit();
    expect(consumer.eventTypes).toEqual([
      'whatsapp.connection.connected',
      'whatsapp.connection.disconnected',
      'whatsapp.connection.removed',
    ]);
  });

  it('connected: the channel is made or brought back; disconnected: only an existing one is changed; removed: orphaned channels are shown disconnected', async () => {
    const links = { ensure: vi.fn(async () => null), connectionRemoved: vi.fn(async () => 1) };
    const consumer = new WabaChannelSyncConsumer(links as never, new OutboxSubscriberRegistry());
    await consumer.handle(event('whatsapp.connection.connected'));
    await consumer.handle(event('whatsapp.connection.disconnected'));
    await consumer.handle(event('whatsapp.connection.removed'));
    expect(links.ensure).toHaveBeenNthCalledWith(1, 7, 9, { create: true, revive: true });
    expect(links.ensure).toHaveBeenNthCalledWith(2, 7, 9, { create: false, revive: false });
    expect(links.connectionRemoved).toHaveBeenCalledWith(7);
  });

  it('an event without a usable connection id does nothing', async () => {
    const links = { ensure: vi.fn(), connectionRemoved: vi.fn() };
    const consumer = new WabaChannelSyncConsumer(links as never, new OutboxSubscriberRegistry());
    await consumer.handle(event('whatsapp.connection.connected', 'not-a-number'));
    expect(links.ensure).not.toHaveBeenCalled();
  });
});
