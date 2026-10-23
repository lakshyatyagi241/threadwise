import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { emitUsageReported } from '../../kernel/outbox/usage-report';
import { UsageBillingService } from '../wallet-message-billing';
import { chatUsageReport, usageKindOfChannel } from './chat-usage';

/** What a message belongs to, as the wallet needs it: the aggregate its event is ordered by and the name the expense log shows. */
export interface BroadcastUsageRef {
  /** The broadcast table's module key (`telegram_broadcasts`...), or `conversations` for a send that has no broadcast record. */
  module: string;
  id: number;
  /** For the log line of a billing fault. */
  uuid: string;
  /** The broadcast's name; null when it has none. */
  name: string | null;
}

/**
 * The channels' own senders that work outside the team inbox's dispatch pipeline (the Telegram, Messenger, LINE and Viber broadcasts,
 * Instagram's reply-only send) report the platform's per-message fee themselves, through this. They share the rules of the inbox path (`chat-usage.ts`): one message is one
 * `chat_message` unit, billed on a stable per-recipient id, and an empty wallet is refused before the work.
 */
@Injectable()
export class ChatUsageReporter {
  private readonly logger = new Logger(ChatUsageReporter.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly usage: UsageBillingService,
  ) {}

  /** Refuses with 422 `WALLET_EMPTY` when the wallet cannot pay for `units` messages: for a request that sends at once. */
  assertCanAfford(orgId: number, units = 1): Promise<void> {
    return this.usage.assertCanAfford(orgId, 'chat_message', units);
  }

  /**
   * The pre-send check of ONE message on `channelKind` (a flow's reply): refuses with 422 `WALLET_EMPTY` on a billed channel (email or
   * a chat channel) whose fee the wallet cannot pay; any other channel passes.
   */
  async assertSendable(orgId: number, channelKind: string): Promise<void> {
    const kind = usageKindOfChannel(channelKind);
    if (kind) await this.usage.assertCanAfford(orgId, kind, 1);
  }

  /**
   * Why the wallet cannot pay for the next batch of a broadcast, or null when it can (or the fee is free: a price of 0, a
   * platform-owned workspace, a failed billing lookup). The sender stops its run on a sentence and leaves nobody failed.
   */
  async refusal(orgId: number, units = 1): Promise<string | null> {
    try {
      await this.assertCanAfford(orgId, units);
      return null;
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.WALLET_EMPTY) return err.message;
      throw err;
    }
  }

  /**
   * Reports one message the provider accepted, in its own transaction. Never throws: the message is gone,
   * and a billing fault must not turn it into a failed recipient (a failed one is sent again). `providerMessageId` must be unique per
   * recipient; a sender whose provider gives none passes a synthetic one (`<broadcast uuid>:<recipient row id>`). `scope` is the
   * Telegram bot's row id (see `chatUsageId`).
   */
  async reportMessage(
    orgId: number,
    broadcast: BroadcastUsageRef,
    o: {
      channelKind: string;
      peerKey: string;
      providerMessageId: string | null;
      scope?: string | null;
      /** Where it came from; a broadcast unless the caller says otherwise (`inbox`). */
      source?: string;
    },
  ): Promise<void> {
    const report = chatUsageReport({
      channelKind: o.channelKind,
      providerMessageId: o.providerMessageId,
      status: 'used',
      peerKey: o.peerKey,
      source: o.source ?? 'broadcast',
      scope: o.scope ?? null,
      subjectName: broadcast.name,
    });
    if (!report) return;
    try {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        emitUsageReported(this.outbox, tx, {
          orgId,
          aggregateModule: broadcast.module,
          aggregateId: broadcast.id,
          report,
        }),
      );
    } catch (err) {
      this.logger.warn(
        { orgId, broadcast: broadcast.uuid, err: String(err) },
        'message could not be billed',
      );
    }
  }
}
