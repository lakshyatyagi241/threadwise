import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  MESSAGE_DELIVERY_EVENT,
  isBillableStatus,
  isFailureStatus,
  walletDeliveryReportedSchema,
} from '@crm/contracts';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MessageBillingService } from './message-billing.service';
import { WalletLogService } from './wallet-log.service';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only thing that charges a wallet for a message (TW-WALLET-012). A channel reports what its provider said as ONE event; this
 * subscriber decides what that means for money: delivered/read charge (and `sent` for the engine that cannot report delivery), failed
 * or undelivered refund, anything else is ignored. Idempotent per message id inside the billing service, so the outbox's
 * at-least-once delivery, a webhook sent twice and two engines reporting one SID all settle once. A malformed payload is logged and
 * dropped: retrying it forever cannot fix it.
 */
@Injectable()
export class DeliveryBillingConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'wallet-delivery-billing';
  readonly eventTypes = [MESSAGE_DELIVERY_EVENT] as const;
  private readonly logger = new Logger(DeliveryBillingConsumer.name);

  constructor(
    private readonly billing: MessageBillingService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly log: WalletLogService,
    private readonly db: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const parsed = walletDeliveryReportedSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn(
        { eventId: event.id, issues: parsed.error.issues.length },
        '[WALLET] malformed delivery event dropped',
      );
      return;
    }
    const d = parsed.data;
    try {
      if (isFailureStatus(d.status)) {
        await this.billing.settleFailed(event.orgId, d.providerMessageId);
      } else if (isBillableStatus(d.provider, d.status)) {
        await this.billing.settleDelivered({
          orgId: event.orgId,
          provider: d.provider,
          providerMessageId: d.providerMessageId,
          recipient: d.recipient ?? null,
          category: d.category ?? null,
          source: d.source ?? null,
        });
      }
    } catch (err) {
      // Rethrown so the drain retries with backoff; the failure is also written where support can see it.
      await this.db
        .txAs({ orgId: event.orgId, userId: null }, (tx) =>
          this.log.event(tx, {
            orgId: event.orgId,
            event: 'wallet.settle.failed',
            severity: 'error',
            message: `Settlement of ${d.providerMessageId} failed: ${err instanceof Error ? err.message : String(err)}`,
            payload: { provider: d.provider, status: d.status, wamid: d.providerMessageId },
          }),
        )
        .catch(() => undefined);
      throw err;
    }
  }
}
