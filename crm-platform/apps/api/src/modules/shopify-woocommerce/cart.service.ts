import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { COMMERCE_SENDER, type CommerceSender } from './_shims/tokens';
import { CartRepository } from './cart.repository';
import { EventMessageService } from './event-message.service';
import { shopifyRecipient, wooRecipient } from './event-rules';
import { EventsRepository } from './events.repository';
import type { StoreKind } from './mirror-rules';

type Json = Record<string, unknown>;
const digits = (v: string | null): string => (v ?? '').replace(/\D/g, '');
const text = (x: unknown): string | null =>
  typeof x === 'string' && x !== '' ? x : typeof x === 'number' ? String(x) : null;

export const CART_STEPS = ['cart/step2', 'cart/step3'] as const;
/** The follow-up waits at least a minute and, when the automation sets no delay, an hour. */
const MIN_DELAY_SECONDS = 60;
const DEFAULT_DELAY_SECONDS = 3600;

/** One scheduled follow-up of an abandoned cart. */
export interface CartStepJob {
  orgId: number;
  kind: StoreKind;
  storeId: number;
  eventType: (typeof CART_STEPS)[number];
  recoveryId: number;
  /** The checkout as the store sent it: it fills the template. */
  data: Json;
}

/**
 * Multi-step abandoned-cart recovery (WD-ECOM-019). Step 1 is the ordinary `checkouts/create` automation. On that event the
 * `cart/step2` and `cart/step3` automations become delayed jobs for the shopper's number, tied together by one recovery row; when an
 * order arrives for the number the pending steps are removed and the row is closed, so nobody is told they forgot something after
 * buying.
 */
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly events: EventsRepository,
    private readonly carts: CartRepository,
    private readonly message: EventMessageService,
    @Inject(COMMERCE_SENDER) private readonly sender: CommerceSender,
    @InjectQueue(QUEUES.ECOM_WEBHOOK) private readonly queue: Queue<CartStepJob>,
  ) {}

  private phone(kind: StoreKind, data: Json): string {
    return digits(kind === 'shopify' ? shopifyRecipient(data) : wooRecipient(data));
  }

  /** On a new checkout: schedule the configured follow-up steps. Nothing is scheduled without a phone, a step or a connected number. */
  async schedule(orgId: number, kind: StoreKind, storeId: number, data: Json): Promise<void> {
    const phone = this.phone(kind, data);
    if (phone === '') return;
    const steps = await this.db.txAs({ orgId }, (tx) =>
      this.events.activeAmong(tx, orgId, kind, storeId, CART_STEPS),
    );
    if (steps.length === 0) return;
    if (!(await this.sender.canSend(orgId))) {
      this.logger.log({ orgId, kind, storeId }, '[CART] no connected sender, nothing scheduled');
      return;
    }

    const billing = (
      typeof data.billing === 'object' && data.billing !== null ? data.billing : {}
    ) as Json;
    const customer = (
      typeof data.customer === 'object' && data.customer !== null ? data.customer : {}
    ) as Json;
    const email = text(data.email) ?? text(kind === 'shopify' ? customer.email : billing.email);
    const token = text(data.token) ?? text(data.cart_key) ?? text(data.id) ?? '';
    const recoveryId = await this.db.txAs({ orgId }, (tx) =>
      this.carts.open(tx, orgId, kind, storeId, {
        encryptedToken: this.crypto.encrypt(token),
        phone,
        email,
      }),
    );

    const scheduled: string[] = [];
    for (const step of steps) {
      const delay = Math.max(MIN_DELAY_SECONDS, step.delaySeconds || DEFAULT_DELAY_SECONDS);
      const jobId = `ecom-cart-${kind}-${recoveryId}-${step.eventType.replace('/', '-')}`;
      try {
        await this.queue.add(
          'cart-step',
          {
            orgId,
            kind,
            storeId,
            eventType: step.eventType as CartStepJob['eventType'],
            recoveryId,
            data,
          },
          { jobId, delay: delay * 1000, attempts: 1, removeOnComplete: true, removeOnFail: 1000 },
        );
        scheduled.push(jobId);
      } catch (err) {
        this.logger.warn(
          { orgId, kind, storeId, step: step.eventType, err },
          '[CART] step not scheduled',
        );
      }
    }
    await this.db.txAs({ orgId }, async (tx) => {
      if (scheduled.length === 0)
        await this.carts.setStatus(tx, orgId, kind, recoveryId, 'cancelled');
      else await this.carts.setScheduled(tx, orgId, kind, recoveryId, scheduled);
    });
  }

  /** On an order: the cart converted. Pending follow-ups for this number are removed and the recoveries closed. */
  async cancelOnOrder(orgId: number, kind: StoreKind, data: Json): Promise<void> {
    const phone = this.phone(kind, data);
    if (phone === '') return;
    const recoveries = await this.db.txAs({ orgId }, (tx) =>
      this.carts.activeByPhone(tx, orgId, kind, phone),
    );
    for (const r of recoveries) {
      for (const id of r.scheduledIds) await this.queue.remove(id).catch(() => undefined);
      await this.db.txAs({ orgId }, (tx) =>
        this.carts.setStatus(tx, orgId, kind, r.id, 'recovered'),
      );
    }
  }

  /**
   * A follow-up comes due. It sends only while its recovery is still waiting (a job that could not be removed on an order is stopped
   * here) and while its automation is still on, and writes a log row with the outcome.
   */
  async runStep(job: CartStepJob): Promise<void> {
    const { orgId, kind, storeId, eventType, recoveryId, data } = job;
    const live = await this.db.txAs({ orgId }, (tx) =>
      this.carts.isActive(tx, orgId, kind, recoveryId),
    );
    if (!live) return;
    const cfg = await this.message.config(orgId, kind, storeId, eventType);
    if (!cfg) return;
    const phone = this.phone(kind, data);
    if (phone === '') return;
    const out = await this.message.send(
      orgId,
      kind,
      storeId,
      cfg,
      data,
      `ecom-cart-${kind}-${recoveryId}-${eventType}`,
      { customerOnly: true },
    );
    await this.db.txAs({ orgId }, (tx) =>
      this.events.log(tx, orgId, kind, storeId, {
        eventType,
        status: out.status === 'sent' ? 'sent' : out.status === 'failed' ? 'failed' : 'skipped',
        recipient: phone,
        payload: { recovery: recoveryId },
        error: out.error,
      }),
    );
  }
}
