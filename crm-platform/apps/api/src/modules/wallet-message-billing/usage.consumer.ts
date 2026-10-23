import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { USAGE_REPORTED_EVENT, walletUsageReportedSchema } from '@crm/contracts';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { DatabaseService } from '../../infra/db/database.service';
import { UsageBillingService } from './usage-billing.service';
import { WalletLogService } from './wallet-log.service';
import { WalletRealtimePublisher } from './wallet-realtime.publisher';

/**
 * The only thing that charges a wallet for a usage that is not a WhatsApp message. A feature reports what it did as ONE
 * `usage.reported` event (see `emitUsageReported`); this subscriber prices it, takes the money and writes the expense row, or gives the
 * money back when the report says it failed. Idempotent per usage id inside the billing service, so the outbox's at-least-once
 * delivery settles once. A malformed payload is logged and dropped: retrying it forever cannot fix it.
 */
@Injectable()
export class UsageBillingConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'wallet-usage-billing';
  readonly eventTypes = [USAGE_REPORTED_EVENT] as const;
  private readonly logger = new Logger(UsageBillingConsumer.name);

  constructor(
    private readonly billing: UsageBillingService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly log: WalletLogService,
    private readonly db: DatabaseService,
    private readonly realtime: WalletRealtimePublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const parsed = walletUsageReportedSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn(
        { eventId: event.id, issues: parsed.error.issues.length },
        '[WALLET] malformed usage event dropped',
      );
      return;
    }
    const u = parsed.data;
    try {
      if (u.status === 'failed') {
        const out = await this.billing.settleFailed(event.orgId, u.kind, u.usageId);
        if (out.refunded)
          await this.realtime.balanceChanged(event.orgId, out.balanceAfterMinor, 'refund');
        return;
      }
      const out = await this.billing.settle({ ...u, orgId: event.orgId });
      if (out.status === 'charged')
        await this.realtime.balanceChanged(event.orgId, out.balanceAfterMinor, 'charge');
    } catch (err) {
      // Rethrown so the drain retries with backoff; the failure is also written where support can see it.
      await this.db
        .txAs({ orgId: event.orgId, userId: null }, (tx) =>
          this.log.event(tx, {
            orgId: event.orgId,
            event: 'wallet.settle.failed',
            severity: 'error',
            message: `Settlement of ${u.kind} ${u.usageId} failed: ${err instanceof Error ? err.message : String(err)}`,
            payload: { kind: u.kind, status: u.status, usageId: u.usageId },
          }),
        )
        .catch(() => undefined);
      throw err;
    }
  }
}
