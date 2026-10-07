import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { CpnStore } from './cpn-store';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralCodeService } from './referral-code.service';
import { ReferralRewardService } from './referral-reward.service';

/** The events this domain reacts to. Emitted by AUTH (sign-up) and PAYGW (order paid); named here so a rename fails loudly. */
export const SIGNUP_COMPLETED_EVENT = 'auth.signup_completed';
export const REFERRAL_ATTRIBUTED_EVENT = 'referral.attributed';
export const ORDER_PAID_EVENT = 'paygw.order.paid';

const attributedSchema = z.object({
  referrerUserUuid: z.string().uuid(),
  referrerOrgUuid: z.string().uuid(),
  referredUserUuid: z.string().uuid(),
  referredOrgUuid: z.string().uuid(),
  codeUsed: z.string().min(1).max(64),
});
const signupSchema = z.object({ userUuid: z.string().uuid() });

/**
 * Issues the new user's referral code the moment the account exists (TW-CPN-029). Idempotent: an existing code is returned, so a
 * redelivery and the lazy issue on the first affiliate read can never produce two.
 */
@Injectable()
export class ReferralCodeConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'cpn-referral-code';
  readonly eventTypes = [SIGNUP_COMPLETED_EVENT] as const;
  private readonly logger = new Logger(ReferralCodeConsumer.name);

  constructor(
    private readonly codes: ReferralCodeService,
    private readonly store: CpnStore,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const parsed = signupSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({ eventId: event.id }, 'sign-up event without a user dropped');
      return;
    }
    await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id FROM users WHERE org_id = ${event.orgId} AND uuid = ${parsed.data.userUuid}::uuid`);
      const row = res.rows[0] as unknown as { id: string | number } | undefined;
      if (!row) return;
      await this.codes.ensureIn(tx, event.orgId, Number(row.id));
    });
  }
}

/** Writes the `referrals` row when sign-up announced an attribution (TW-CPN-032). A malformed event is dropped: retrying cannot fix it. */
@Injectable()
export class ReferralAttributionConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'cpn-referral-attribution';
  readonly eventTypes = [REFERRAL_ATTRIBUTED_EVENT] as const;
  private readonly logger = new Logger(ReferralAttributionConsumer.name);

  constructor(
    private readonly attribution: ReferralAttributionService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const parsed = attributedSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({ eventId: event.id }, 'malformed referral.attributed dropped');
      return;
    }
    await this.attribution.attribute(parsed.data);
  }
}

/**
 * Pays the referrer when the referee's workspace has an order paid (TW-CPN-033). It runs after the order's transaction committed,
 * in the worker, so a wallet failure is retried by the outbox and never reaches the checkout.
 */
@Injectable()
export class ReferralRewardConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'cpn-referral-reward';
  readonly eventTypes = [ORDER_PAID_EVENT] as const;

  constructor(
    private readonly reward: ReferralRewardService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    await this.reward.rewardFirstPayment(event.orgId);
  }
}
