import { Injectable } from '@nestjs/common';
import {
  walletDeliverySourceSchema,
  type WalletDeliverySource,
  type WalletDeliveryStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { deliveryProviderOf, emitDeliveryReported } from '../../kernel/outbox/delivery-report';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CONVERSATIONS_MODULE } from './conversation-lifecycle.service';
import { MessagesRepository } from './messages.repository';

export interface ReportableMessage {
  senderKind: string;
  templateId: number | null;
  meta: Record<string, unknown>;
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
 * the message, so the status and the report commit together. Only the WhatsApp Cloud channel is billed per message; the simulator
 * and web chat report nothing. Callers invoke it on a real transition only (a refused or repeated receipt is not one).
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
    },
  ): Promise<void> {
    if (!o.providerMessageId) return;
    const provider = deliveryProviderOf(o.channelKind);
    if (!provider) return;
    await emitDeliveryReported(this.outbox, tx, {
      orgId,
      aggregateModule: CONVERSATIONS_MODULE,
      aggregateId: o.conversationId,
      report: {
        provider,
        providerMessageId: o.providerMessageId,
        status: o.status,
        recipient: o.peerKey,
        category: await this.messages.templateCategory(tx, orgId, o.message.templateId),
        source: walletSourceOf(o.message),
      },
    });
  }
}
