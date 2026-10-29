import { Injectable } from '@nestjs/common';
import {
  walletDeliverySourceSchema,
  type WalletDeliverySource,
  type WalletDeliveryStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { deliveryProviderOf, emitDeliveryReported } from '../../kernel/outbox/delivery-report';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { emitUsageReported } from '../../kernel/outbox/usage-report';
import { chatUsageReport } from './chat-usage';
import { CONVERSATIONS_MODULE } from './conversation-lifecycle.service';
import { MessagesRepository } from './messages.repository';

export interface ReportableMessage {
  senderKind: string;
  templateId: number | null;
  meta: Record<string, unknown>;
  /** The stored message's kind: a reaction is not a billable message. */
  kind?: string;
}

/** Who sent it, as the wallet names the origin. A producer may say so itself in `meta.source`; otherwise the sender kind decides. */
export function walletSourceOf(
  m: Pick<ReportableMessage, 'senderKind' | 'meta'>,
): WalletDeliverySource {
  const stated = walletDeliverySourceSchema.safeParse(m.meta?.source);
  if (stated.success) return stated.data;
  switch (m.senderKind) {
    case 'agent':
      return 'inbox';
    case 'bot':
      return 'auto_reply';
    case 'broadcast':
      return 'broadcast';
    default:
      return 'chat';
  }
}

/**
 * Tells the wallet what a provider said about an OUTBOUND message of a conversation (TW-WALLET-012), in the transaction that moved
 * the message, so the status and the report commit together. WhatsApp is billed per message by the rate card
 * (`message.delivery_reported`); email and the other chat channels carry the platform's per-message fee and are reported as
 * `usage.reported` (see `chat-usage.ts` for what is and is not billed); the simulator and web chat report nothing. Callers invoke it
 * on a real transition only (a refused or repeated receipt is not one).
 */
@Injectable()
export class DeliveryReporter {
  constructor(
    private readonly outbox: OutboxService,
    private readonly messages: MessagesRepository,
  ) {}

  async report(
    tx: Tx,
    orgId: number,
    o: {
      channelKind: string;
      conversationId: number;
      peerKey: string;
      status: WalletDeliveryStatus;
      providerMessageId: string | null;
      message: ReportableMessage;
      /** The channel's `external_id` (a Telegram bot's row id): it keeps a chat message's billing key unique across the workspace's bots. */
      channelExternalId?: string | null;
      /** Meta's `pricing.billable` for this message; false means the wallet charges nothing (a template inside the free service window). */
      billable?: boolean;
    },
  ): Promise<void> {
    if (!o.providerMessageId) return;
    const provider = deliveryProviderOf(o.channelKind);
    if (!provider) {
      await this.reportUsage(tx, orgId, o);
      return;
    }
    const template = await this.messages.templateFacts(tx, orgId, o.message.templateId);
    await emitDeliveryReported(this.outbox, tx, {
      orgId,
      aggregateModule: CONVERSATIONS_MODULE,
      aggregateId: o.conversationId,
      report: {
        provider,
        providerMessageId: o.providerMessageId,
        status: o.status,
        recipient: o.peerKey,
        category: template.category,
        source: walletSourceOf(o.message),
        templateName: template.templateName,
        ...(o.billable === undefined ? {} : { billable: o.billable }),
      },
    });
  }

  /**
   * Email and the other chat channels are billed on ACCEPTANCE and never refunded: their receipts (Viber's `failed`) are signed with a
   * secret the workspace itself holds (its own bot or page token), so a receipt cannot be what gives the platform's fee back. The
   * billing key is the provider's message id, so a replayed send reports the same one.
   */
  private async reportUsage(
    tx: Tx,
    orgId: number,
    o: {
      channelKind: string;
      conversationId: number;
      peerKey: string;
      status: WalletDeliveryStatus;
      providerMessageId: string | null;
      message: ReportableMessage;
      channelExternalId?: string | null;
    },
  ): Promise<void> {
    if (o.status !== 'sent') return;
    const report = chatUsageReport({
      channelKind: o.channelKind,
      providerMessageId: o.providerMessageId,
      status: 'used',
      peerKey: o.peerKey,
      source: walletSourceOf(o.message),
      scope: o.channelExternalId ?? null,
      messageKind: o.message.kind ?? null,
    });
    if (!report) return;
    await emitUsageReported(this.outbox, tx, {
      orgId,
      aggregateModule: CONVERSATIONS_MODULE,
      aggregateId: o.conversationId,
      report,
    });
  }
}
