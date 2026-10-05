import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../common/context/request-context';
import type {
  NormalisedDeliveryEvent,
  NormalisedInboundMessage,
} from '../../infra/providers/whatsapp/whatsapp.port';
import { normaliseMetaWebhook } from '../../infra/providers/whatsapp';
import type {
  BusinessAppEcho,
  InboundContext,
  WabaInboundSink,
} from '../whatsapp-cloud-api-waba/waba-inbound.port';
import type { HistoryItem } from '../whatsapp-cloud-api-waba/waba-inbound.port';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import type { ChannelRow } from './channels.repository';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from './conversations.facade';
import { WabaChannelLinkService } from './waba-channel-link.service';

type Dict = Record<string, unknown>;

/**
 * The inbox's end of the WhatsApp webhook. The WABA domain receives the delivery (signature, routing by number, de-duplication of the
 * message id) and calls this sink with what belongs to the inbox: every inbound message, and the delivery reports of messages that no
 * broadcast sent (a reply from the inbox, a flow, an auto-reply).
 *
 * It does three small things and leaves the rest to the pipeline that already exists:
 *
 *   1. maps the connection (`InboundContext.configId`) to its channel, making it on the first message when the number has none yet;
 *   2. rebuilds the value of Meta's `messages` change around the one message or status it was handed, so the inbox's normaliser
 *      (`normaliseMetaWebhook`: every message type, reactions, referrals, own-number echoes, group messages) stays the single reader of
 *      the payload shape and `Normalised*` stays the WABA domain's contract;
 *   3. puts the normalised message or receipt on the ingest queue, where the existing worker stores it exactly once (the ledger's unique
 *      key on the provider message id), retries it, fetches its file in the background, and applies a receipt that arrives before its
 *      message is stored.
 *
 * A failure here is thrown back to the WABA ingest, which releases its de-duplication claim so Meta's redelivery can finish the job.
 */
@Injectable()
export class WabaInboxSink implements WabaInboundSink {
  private readonly logger = new Logger(WabaInboxSink.name);

  constructor(
    private readonly links: WabaChannelLinkService,
    private readonly publisher: ChannelIngestPublisher,
    @Optional() @Inject(CONVERSATIONS_FACADE) private readonly conversations?: ConversationsFacade,
  ) {}

  /**
   * A message typed on the WhatsApp Business app (the `smb_message_echoes` field, TW-WABA-044): an outbound bubble on the customer's
   * thread. No unread, no routing, no automation; the ledger makes a redelivery the same bubble.
   */
  async onEcho(ctx: InboundContext, echo: BusinessAppEcho): Promise<void> {
    if (!this.conversations) return;
    const channel = await this.links.ensure(ctx.orgId, ctx.configId, { create: true });
    if (!channel) return;
    const conversations = this.conversations;
    await RequestContextStore.run(
      {
        requestId: `waba-echo-${randomUUID()}`,
        orgId: ctx.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        conversations.recordOutbound({
          channelId: channel.uuid,
          peerKey: echo.to,
          source: 'business_app',
          body: echo.text,
          providerMessageId: echo.providerMessageId,
        }),
    );
  }

  /**
   * The chat history Meta pushes after coexistence onboarding (TW-WABA-046): one ingest job per message, stored backdated and quiet
   * (no unread, no contact, no alert). The ledger drops a message the inbox already has, so a repeated push adds nothing.
   */
  async onHistory(ctx: InboundContext, items: HistoryItem[]): Promise<void> {
    const channel = await this.links.ensure(ctx.orgId, ctx.configId, { create: true });
    if (!channel) return;
    for (const item of items) {
      await this.publisher.enqueueInbound(ctx.orgId, channel.uuid, {
        providerMessageId: item.providerMessageId,
        peerKey: item.customer,
        kind: 'text',
        body: item.text,
        providerTimestamp: item.at,
        history: { direction: item.outgoing ? 'out' : 'in' },
      });
    }
  }

  /**
   * A message in a Cloud API group (TW-WABA-039). The inbox's normaliser leaves a group message out because its sender is a member, not
   * the thread; here it is read without the group marker (so the one reader of the payload shape stays the normaliser) and put on the
   * group's own thread, keyed by the group id, with the participant named and no contact made.
   */
  async onGroupMessage(
    ctx: InboundContext,
    message: NormalisedInboundMessage,
    group: { groupId: string; title: string | null },
  ): Promise<void> {
    const channel = await this.links.ensure(ctx.orgId, ctx.configId, { create: true });
    if (!channel) return;
    const participant = message.from.replace(/\D+/g, '');
    const { group_id: _group, ...raw } = message.raw as Dict;
    const parsed = normaliseMetaWebhook(this.payload(ctx, channel, { messages: [raw] }), {
      phoneNumberId: ctx.phoneNumberId,
    });
    for (const m of parsed.messages) {
      await this.publisher.enqueueInbound(ctx.orgId, channel.uuid, {
        ...m,
        peerKey: group.groupId,
        peerName: undefined,
        group: {
          ...(group.title ? { title: group.title } : {}),
          participant,
          ...(ctx.contactName ? { participantName: ctx.contactName } : {}),
        },
      });
    }
  }

  async onMessage(ctx: InboundContext, message: NormalisedInboundMessage): Promise<void> {
    const channel = await this.links.ensure(ctx.orgId, ctx.configId, { create: true });
    if (!channel) {
      this.logger.warn(
        { orgId: ctx.orgId, number: ctx.configUuid, providerMessageId: message.providerMessageId },
        'inbound message for a number with no usable channel was acknowledged and not stored',
      );
      return;
    }
    const from = message.from.replace(/\D+/g, '');
    const parsed = normaliseMetaWebhook(
      this.payload(ctx, channel, {
        messages: [message.raw],
        ...(ctx.contactName && from
          ? { contacts: [{ wa_id: from, profile: { name: ctx.contactName } }] }
          : {}),
      }),
      { phoneNumberId: ctx.phoneNumberId },
    );
    for (const skipped of parsed.ignored ?? []) {
      this.logger.debug(
        { orgId: ctx.orgId, channel: channel.uuid, ...skipped },
        'inbound message not stored',
      );
    }
    for (const m of parsed.messages)
      await this.publisher.enqueueInbound(ctx.orgId, channel.uuid, m);
  }

  async onStatus(ctx: InboundContext, event: NormalisedDeliveryEvent): Promise<void> {
    // A report for a message the inbox did not send, on a number it has no channel for, is not the inbox's.
    const channel = await this.links.find(ctx.orgId, ctx.configId);
    if (!channel) return;
    const parsed = normaliseMetaWebhook(this.payload(ctx, channel, { statuses: [event.raw] }), {
      phoneNumberId: ctx.phoneNumberId,
    });
    for (const r of parsed.receipts)
      await this.publisher.enqueueReceipt(ctx.orgId, channel.uuid, r);
  }

  /** A Cloud API webhook body holding one `messages` change, as the normaliser reads it. */
  private payload(ctx: InboundContext, channel: ChannelRow, value: Dict): Dict {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: ctx.wabaId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  // The number's own digits let the normaliser recognise a message typed in the business app on the same number.
                  display_phone_number: channel.displayAddress ?? undefined,
                  phone_number_id: ctx.phoneNumberId ?? undefined,
                },
                ...value,
              },
            },
          ],
        },
      ],
    };
  }
}
