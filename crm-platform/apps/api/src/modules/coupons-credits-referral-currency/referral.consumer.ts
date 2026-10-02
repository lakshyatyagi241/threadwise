import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { ReferralCodeService } from './referral-code.service';
import { ReferralService } from './referral.service';

const EVENTS = ['auth.user.registered', 'referral.attributed', 'paygw.order.paid'] as const;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The referral program's side of three events, in the worker (TW-CPN-029, 032, 033). Each is idempotent, so the outbox's
 * at-least-once delivery is safe:
 *   auth.user.registered  the new user gets their referral code;
 *   referral.attributed   sign-up resolved a code: record the referee against the referrer (once);
 *   paygw.order.paid      any paid order of a referee pays the referrer's bonus (once).
 * Reference wrapped the payout in a try/catch so a failure could never break checkout; here the payout is already out of the checkout
 * transaction, and a failure retries with backoff instead of being logged and lost.
 */
@Injectable()
export class ReferralConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'cpn-referrals';
  readonly eventTypes = EVENTS;
  private readonly logger = new Logger(ReferralConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly referrals: ReferralService,
    private readonly codes: ReferralCodeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    if (event.eventType === 'auth.user.registered') {
      await this.codes.ensure(event.orgId, Number(event.aggregateId));
      return;
    }
    if (event.eventType === 'referral.attributed') {
      const outcome = await this.referrals.attribute({
        referrerUserUuid: text(p.referrerUserUuid),
        referrerOrgUuid: text(p.referrerOrgUuid),
        referredUserUuid: text(p.referredUserUuid),
        referredOrgUuid: text(p.referredOrgUuid),
        codeUsed: text(p.codeUsed),
      });
      if (outcome === 'ignored') this.logger.warn({ eventId: event.id }, 'referral not attributed');
      return;
    }
    // paygw.order.paid: the order id is the aggregate, the buyer's workspace the event's org.
    const result = await this.referrals.rewardOnPaidOrder(event.orgId, Number(event.aggregateId));
    if (result === 'paid') this.logger.log({ orderId: event.aggregateId }, 'referral bonus paid');
  }
}
