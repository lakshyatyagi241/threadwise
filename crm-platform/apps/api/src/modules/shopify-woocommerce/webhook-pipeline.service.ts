import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { STORE_MIRROR, type StoreMirror } from './_shims/tokens';
import { CodService } from './cod.service';
import { StockService } from './stock.service';
import { EventMessageService } from './event-message.service';
import { isShopifyCod, isWooCod, shopifyRecipient, wooRecipient } from './event-rules';
import { EventsRepository, type LogRef } from './events.repository';
import {
  shopifyCustomer,
  shopifyOrder,
  shopifyProduct,
  wooCustomer,
  wooOrder,
  wooProduct,
  type StoreKind,
} from './mirror-rules';
import { MirrorRepository } from './mirror.repository';
import { StoresRepository } from './stores.repository';

type Json = Record<string, unknown>;

export interface WebhookJob {
  orgId: number;
  kind: StoreKind;
  storeId: number;
  eventType: string;
  data: Json;
  /** The delivery's log row, so the outcome lands on it. */
  log: { id: number; createdAt: string };
  /** 'send' is the delayed second half of an automation: only the message, the rest already ran. */
  phase: 'full' | 'send';
}

const STATUS_MEMORY_SECONDS = 30 * 86_400;

/**
 * What a verified delivery does, in order, each step guarded so one failing never stops the next: the event's message, the
 * WooCommerce order-status automation, then the mirror upkeep (the changed order, product or customer is written to the CRM).
 */
@Injectable()
export class WebhookPipelineService {
  private readonly logger = new Logger(WebhookPipelineService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly mirrorRepo: MirrorRepository,
    private readonly events: EventsRepository,
    private readonly message: EventMessageService,
    private readonly codService: CodService,
    private readonly stockService: StockService,
    @Inject(STORE_MIRROR) private readonly mirror: StoreMirror,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(QUEUES.ECOM_WEBHOOK) private readonly queue: Queue<WebhookJob>,
  ) {}

  async run(job: WebhookJob): Promise<void> {
    const log: LogRef = { id: job.log.id, createdAt: new Date(job.log.createdAt) };
    if (job.phase === 'send') {
      await this.automation(job, job.eventType, log, false);
      return;
    }
    await this.guarded(job, 'message', () => this.automation(job, job.eventType, log, true));
    const status = job.kind === 'woocommerce' ? wooStatusEvent(job) : null;
    if (status && (await this.firstTimeInStatus(job, status)))
      await this.guarded(job, status, () => this.pseudo(job, status, job.data));
    // Back in stock reads the product's previous stock state, so it runs before the mirror overwrites it.
    if (job.eventType === 'products/update' || job.eventType === 'product.updated')
      await this.guarded(job, 'stock', () =>
        this.stockService.onProductUpdate(job.orgId, job.kind, job.storeId, job.data),
      );
    await this.guarded(job, 'mirror', () => this.upkeep(job));
    await this.guarded(job, 'cod', () => this.cod(job));
    if (job.kind === 'shopify') {
      if (job.eventType === 'fulfillments/update')
        await this.guarded(job, 'delivered', () => this.delivered(job));
      if (job.eventType === 'app/uninstalled')
        await this.guarded(job, 'uninstall', () =>
          this.db.txAs({ orgId: job.orgId }, (tx) =>
            this.stores.markShopifyUninstalled(tx, job.orgId, job.storeId),
          ),
        );
    }
  }

  /**
   * A courier marking a shipment delivered fires the Delivered automation (WD-ECOM-018). The customer comes from the mirrored order
   * (phone, name, order name), the shipment's destination phone being the fallback.
   */
  private async delivered(job: WebhookJob): Promise<void> {
    const d = job.data;
    if (String(d.shipment_status ?? '').toLowerCase() !== 'delivered') return;
    const cfg = await this.message.config(job.orgId, 'shopify', job.storeId, 'order/delivered');
    if (!cfg) return;
    const orderId = String(d.order_id ?? '');
    const order = await this.db.txAs({ orgId: job.orgId }, (tx) =>
      this.mirrorRepo.orderByStoreId(tx, job.orgId, 'shopify', orderId),
    );
    const destination = (d.destination ?? {}) as { phone?: unknown };
    const phone =
      order?.phone || (typeof destination.phone === 'string' ? destination.phone : null);
    const data = {
      id: d.order_id ?? null,
      name: order?.orderName ?? `#${orderId}`,
      phone,
      customer: { first_name: order?.name || 'there', phone },
      fulfillments: [d],
    };
    await this.pseudo(job, 'order/delivered', data);
  }

  /**
   * An automation fired by the pipeline rather than a topic of its own (order status, COD prepaid, delivered): it needs a customer
   * phone and an active template, goes to the customer only, and writes its own log row. Nothing to send writes nothing.
   */
  private async pseudo(
    job: WebhookJob,
    type: string,
    data: Record<string, unknown>,
    extra?: Record<string, string>,
  ): Promise<void> {
    const cfg = await this.message.config(job.orgId, job.kind, job.storeId, type);
    if (!cfg) return;
    const phone = (job.kind === 'shopify' ? shopifyRecipient(data) : wooRecipient(data))?.replace(
      /\D/g,
      '',
    );
    if (!phone) return;
    const log = await this.db.txAs({ orgId: job.orgId }, (tx) =>
      this.events.log(tx, job.orgId, job.kind, job.storeId, {
        eventType: type,
        status: 'received',
        recipient: phone,
        payload: data,
      }),
    );
    await this.automation({ ...job, data }, type, log, false, { pseudo: true, extra });
  }

  /** A new cash-on-delivery order: risk score (WooCommerce), the confirmation, the prepaid nudge, then the risk log. */
  private async cod(job: WebhookJob): Promise<void> {
    const cod =
      job.kind === 'shopify'
        ? job.eventType === 'orders/create' && isShopifyCod(job.data)
        : job.eventType === 'order.created' && isWooCod(job.data);
    if (!cod) return;
    const risk =
      job.kind === 'woocommerce' ? await this.codService.risk(job.orgId, job.data) : null;
    await this.codService.confirm(job.orgId, job.kind, job.storeId, job.data);
    await this.pseudo(job, 'cod/prepaid', job.data, risk ? { risk_level: risk.level } : undefined);
    if (risk) {
      await this.db.txAs({ orgId: job.orgId }, (tx) =>
        this.events.log(tx, job.orgId, job.kind, job.storeId, {
          eventType: 'cod/risk',
          status: 'processed',
          recipient: wooRecipient(job.data),
          payload: { order: `#${String(job.data.number ?? '')}`, risk },
        }),
      );
    }
  }

  private async guarded(job: WebhookJob, step: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        { orgId: job.orgId, kind: job.kind, storeId: job.storeId, event: job.eventType, step, err },
        '[ECOM] webhook step failed',
      );
    }
  }

  /** One automation: sent now, or queued for later when it has a delay. Writes its outcome on the log row. */
  private async automation(
    job: WebhookJob,
    eventType: string,
    log: LogRef,
    mayDelay: boolean,
    opts: { pseudo?: boolean; extra?: Record<string, string> } = {},
  ): Promise<void> {
    const cfg = await this.message.config(job.orgId, job.kind, job.storeId, eventType);
    if (!cfg) {
      await this.setLog(job, log, { status: 'skipped' });
      return;
    }
    // Only the cart steps wait (as in WaDesk); every other automation sends at once whatever delay was saved.
    if (mayDelay && cfg.delaySeconds > 0 && cfg.eventType.startsWith('cart/')) {
      await this.queue.add(
        'send',
        {
          ...job,
          eventType,
          log: { id: log.id, createdAt: log.createdAt.toISOString() },
          phase: 'send',
        },
        { delay: cfg.delaySeconds * 1000, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
      await this.setLog(job, log, { status: 'processed' });
      return;
    }
    const out = await this.message.send(
      job.orgId,
      job.kind,
      job.storeId,
      cfg,
      job.data,
      `ecom-${job.kind}-${job.storeId}-${log.id}`,
      { extra: opts.extra, customerOnly: opts.pseudo },
    );
    await this.setLog(job, log, {
      status: out.status === 'sent' ? 'sent' : out.status === 'failed' ? 'failed' : 'skipped',
      recipient: out.recipient,
      response: out.response,
      error: out.error,
    });
  }

  private setLog(
    job: WebhookJob,
    log: LogRef,
    v: Parameters<EventsRepository['setLog']>[4],
  ): Promise<void> {
    return this.db.txAs({ orgId: job.orgId }, (tx) =>
      this.events.setLog(tx, job.orgId, job.kind, log, v),
    );
  }

  /** A status automation fires once per order and status: later updates of the same order that keep the status do not message again. */
  private async firstTimeInStatus(job: WebhookJob, status: string): Promise<boolean> {
    const key = `ecom:woo-status:${job.orgId}:${job.storeId}:${String(job.data.id)}:${status}`;
    try {
      return (await this.redis.set(key, '1', 'EX', STATUS_MEMORY_SECONDS, 'NX')) === 'OK';
    } catch {
      // Redis down: fail open for the customer's message, the delivery id guard still bounds repeats.
      return true;
    }
  }

  /** Keeps the CRM's copy of the store current. A row that cannot be mapped is logged and skipped. */
  private async upkeep(job: WebhookJob): Promise<void> {
    const { orgId, kind, storeId, data } = job;
    const topic = job.eventType;
    const store = await this.db.txAs({ orgId }, (tx) =>
      this.stores.storeById(tx, orgId, kind, storeId),
    );
    if (!store) return;
    const currency = 'shopCurrency' in store ? store.shopCurrency : store.storeCurrency;
    const ctx = { storeUrl: store.storeUrl, currency };
    const kindOf = topic.split(/[./]/)[0]!;
    if (kindOf.startsWith('order') && !topic.includes('deleted')) {
      const m = kind === 'shopify' ? shopifyOrder(data, ctx) : wooOrder(data, ctx);
      if (m.storeId !== '')
        await this.db.txAs({ orgId }, (tx) => this.mirror.upsertOrder(tx, orgId, kind, m));
    } else if (kindOf.startsWith('product') && !topic.includes('delete')) {
      const m = kind === 'shopify' ? shopifyProduct(data, ctx) : wooProduct(data, ctx);
      if (m.storeId !== '')
        await this.db.txAs({ orgId }, (tx) =>
          this.mirror.upsertProduct(tx, orgId, kind, store.userId, m),
        );
    } else if (kindOf.startsWith('customer') && !topic.includes('delete')) {
      const m = kind === 'shopify' ? shopifyCustomer(data) : wooCustomer(data);
      if (!m || m.storeId === '') return;
      const cached = (
        store.metadata as { shopify_group_id?: unknown; woo_group_id?: unknown } | null
      )?.[kind === 'shopify' ? 'shopify_group_id' : 'woo_group_id'];
      await this.db.txAs({ orgId }, async (tx) => {
        const group = await this.mirror.ensureGroup(
          tx,
          orgId,
          store.userId,
          kind,
          typeof cached === 'number' ? cached : null,
        );
        if (group !== cached)
          await this.stores.mergeMetadata(tx, orgId, kind, storeId, {
            [kind === 'shopify' ? 'shopify_group_id' : 'woo_group_id']: group,
          });
        await this.mirror.upsertCustomer(tx, orgId, store.userId, kind, m, group);
      });
    }
  }
}

/** `order.<status>` for a WooCommerce order delivery that carries a status. */
function wooStatusEvent(job: WebhookJob): string | null {
  if (job.eventType !== 'order.created' && job.eventType !== 'order.updated') return null;
  const status = job.data.status;
  return typeof status === 'string' && status !== '' ? `order.${status}` : null;
}
