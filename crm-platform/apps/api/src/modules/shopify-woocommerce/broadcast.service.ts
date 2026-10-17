import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { BroadcastResult, SendOfferInput, SendWinbackInput } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { SendWindowService, wakeDelayMs } from '../compliance-center';
import { purposeOfCategory } from '../contact-consent';
import {
  COMMERCE_SENDER,
  ECOM_PLAN_GATE,
  ECOM_TEMPLATES,
  type CommerceSender,
  type EcomPlanGate,
  type EcomTemplates,
} from './_shims/tokens';
import { offerContext, winbackContext, type StoreFacts } from './event-rules';
import { EventsRepository } from './events.repository';
import type { StoreKind } from './mirror-rules';
import { SegmentsRepository } from './segments.repository';
import { StoresRepository } from './stores.repository';

export interface BroadcastJob {
  orgId: number;
  kind: StoreKind;
  storeId: number;
  type: 'offer' | 'winback';
  templateId: number;
  /**
   * BL-191: set on the run that takes up what the quiet hours held back. The audience is the held people only (their numbers and names),
   * and the counts so far travel with it so the one log row ends with the totals of the whole broadcast.
   */
  resume?: {
    audience: Array<{ phone: string; name: string | null }>;
    sent: number;
    failed: number;
    firstError: string | null;
  };
  /** What defines the audience and fills the template; the audience itself is read again when the job runs. */
  input: {
    groupUuid?: string;
    productUuid?: string;
    couponCode?: string;
    days?: number;
    minOrders?: number;
    minSpentMinor?: number;
  };
  log: { id: number; createdAt: string };
}

const digits = (v: string): string => v.replace(/\D/g, '');
const NO_AUDIENCE_OFFER = 'That segment has no contactable (opted-in) members.';
const NO_AUDIENCE_WINBACK = 'No customers match this segment.';

/**
 * The offer and win-back broadcasts (TW-ECOM-014, 015). The request checks the plan, the template and that the audience is not
 * empty, writes the log row and queues the sends; the worker sends one by one and writes the sent and failed counts on that row.
 * Opted-out contacts are never messaged.
 *
 * Quiet hours (BL-191): an offer or a win-back with a MARKETING template (a utility one is a notice and is never held) is held, not
 * denied, for each customer whose local time is inside the workspace's quiet hours (their contact's time zone, else their number's
 * country, else the workspace's). The rest of the audience goes; the held ones are queued as a delayed job for the first opening, which
 * reads the hours again and the opt-out list again, and the one log row stays `processed` (with the held count) until it ends.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly events: EventsRepository,
    private readonly segments: SegmentsRepository,
    @Inject(ECOM_PLAN_GATE) private readonly plan: EcomPlanGate,
    @Inject(ECOM_TEMPLATES) private readonly templates: EcomTemplates,
    @Inject(COMMERCE_SENDER) private readonly sender: CommerceSender,
    private readonly sendWindow: SendWindowService,
    @InjectQueue(QUEUES.ECOM_WEBHOOK) private readonly queue: Queue<BroadcastJob>,
  ) {}

  async offer(kind: StoreKind, storeUuid: string, input: SendOfferInput): Promise<BroadcastResult> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, kind);
    const prepared = await this.db.tx(async (tx) => {
      const store = await this.store(tx, orgId, kind, storeUuid);
      const templateId = await this.templates.idOf(tx, orgId, input.templateUuid);
      if (templateId === undefined) return { message: 'Template not found.' };
      const members = await this.segments.groupMembers(tx, orgId, input.groupUuid);
      if (members.length === 0) return { message: NO_AUDIENCE_OFFER };
      const product = input.productUuid
        ? await this.segments.product(tx, orgId, input.productUuid)
        : undefined;
      return { store, templateId, total: members.length, product };
    });
    if ('message' in prepared) return { ok: false, message: prepared.message };
    await this.start(
      orgId,
      kind,
      prepared.store.id,
      {
        type: 'offer',
        templateId: prepared.templateId,
        input: {
          groupUuid: input.groupUuid,
          productUuid: input.productUuid,
          couponCode: input.couponCode,
        },
      },
      {
        recipient: `${prepared.total} contacts`,
        payload: { product: prepared.product?.name ?? null, coupon: input.couponCode ?? null },
      },
    );
    return { ok: true, total: prepared.total, queued: true };
  }

  async winback(
    kind: StoreKind,
    storeUuid: string,
    input: SendWinbackInput,
  ): Promise<BroadcastResult> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, kind);
    const minSpentMinor = Math.round(input.minSpent * 100);
    const prepared = await this.db.tx(async (tx) => {
      const store = await this.store(tx, orgId, kind, storeUuid);
      const templateId = await this.templates.idOf(tx, orgId, input.templateUuid);
      if (templateId === undefined) return { message: 'Template not found.' };
      const phones = await this.segments.lapsedPhones(tx, orgId, kind, {
        days: input.days,
        minOrders: input.minOrders,
        minSpentMinor,
      });
      if (phones.length === 0) return { message: NO_AUDIENCE_WINBACK };
      return { store, templateId, total: phones.length };
    });
    if ('message' in prepared) return { ok: false, message: prepared.message };
    await this.start(
      orgId,
      kind,
      prepared.store.id,
      {
        type: 'winback',
        templateId: prepared.templateId,
        input: {
          days: input.days,
          minOrders: input.minOrders,
          minSpentMinor,
          couponCode: input.couponCode,
        },
      },
      {
        recipient: `${prepared.total} lapsed (>${input.days}d)`,
        payload: { days: input.days, coupon: input.couponCode ?? null },
      },
    );
    return { ok: true, total: prepared.total, queued: true };
  }

  private async store(
    tx: Parameters<StoresRepository['shopifyByUuid']>[0],
    orgId: number,
    kind: StoreKind,
    uuid: string,
  ) {
    const row =
      kind === 'shopify'
        ? await this.stores.shopifyByUuid(tx, orgId, uuid)
        : await this.stores.wooByUuid(tx, orgId, uuid);
    if (!row)
      throw AppError.notFound(kind === 'shopify' ? 'Shopify store' : 'WooCommerce store', uuid);
    return row;
  }

  /** Writes the log row and queues the sends. A queue that is down fails the row, so the screen never shows a broadcast that is not going. */
  private async start(
    orgId: number,
    kind: StoreKind,
    storeId: number,
    job: Pick<BroadcastJob, 'type' | 'templateId' | 'input'>,
    log: { recipient: string; payload: unknown },
  ): Promise<void> {
    const eventType = job.type === 'offer' ? 'offer/broadcast' : 'winback/broadcast';
    const ref = await this.db.txAs({ orgId }, (tx) =>
      this.events.log(tx, orgId, kind, storeId, {
        eventType,
        status: 'processed',
        recipient: log.recipient,
        payload: log.payload,
      }),
    );
    try {
      await this.queue.add(
        'broadcast',
        {
          orgId,
          kind,
          storeId,
          ...job,
          log: { id: ref.id, createdAt: ref.createdAt.toISOString() },
        },
        { attempts: 1, removeOnComplete: true, removeOnFail: 1000 },
      );
    } catch (err) {
      await this.db.txAs({ orgId }, (tx) =>
        this.events.setLog(tx, orgId, kind, ref, {
          status: 'failed',
          error: 'The broadcast could not be queued.',
        }),
      );
      throw err;
    }
  }

  /** Sends to the audience one by one and writes the counts on the log row. Runs in the worker. */
  async run(job: BroadcastJob): Promise<void> {
    const { orgId, kind, storeId } = job;
    const ref = { id: job.log.id, createdAt: new Date(job.log.createdAt) };
    const loaded = await this.db.txAs({ orgId }, async (tx) => {
      const store = await this.stores.storeById(tx, orgId, kind, storeId);
      const template = await this.templates.sendable(tx, orgId, job.templateId);
      const product = job.input.productUuid
        ? await this.segments.product(tx, orgId, job.input.productUuid)
        : undefined;
      const audience = job.resume
        ? job.resume.audience
        : job.type === 'offer'
          ? await this.segments.groupMembers(tx, orgId, job.input.groupUuid ?? '')
          : (
              await this.segments.lapsedPhones(tx, orgId, kind, {
                days: job.input.days ?? 60,
                minOrders: job.input.minOrders ?? 0,
                minSpentMinor: job.input.minSpentMinor ?? 0,
              })
            ).map((phone) => ({ phone, name: null as string | null }));
      // A run that takes up held customers asks the opt-out list again, whatever the type: somebody may have left while they waited.
      const optedOut =
        job.type === 'winback' || job.resume
          ? await this.segments.optedOut(tx, orgId)
          : new Set<string>();
      // A MARKETING template is held for the quiet hours; a utility or authentication one is a notice the person needs.
      const cat = await tx.execute(sql`
        SELECT lower(coalesce(meta_category, category)) AS category FROM wa_templates
        WHERE org_id = ${orgId} AND id = ${job.templateId}`);
      const marketing =
        purposeOfCategory((cat.rows[0] as { category?: string } | undefined)?.category) ===
        'marketing_messaging';
      return { store, template, product, audience, optedOut, marketing };
    });
    if (!loaded.store || !loaded.template) {
      await this.finish(
        orgId,
        kind,
        ref,
        0,
        loaded.audience.length,
        'The template is missing or not approved by Meta yet.',
      );
      return;
    }
    const { store, template, product, audience, optedOut, marketing } = loaded;
    const facts: StoreFacts = {
      storeName: store.storeName,
      storeUrl: store.storeUrl,
      currency: 'shopCurrency' in store ? store.shopCurrency : store.storeCurrency,
    };
    const chosen = (store.metadata as { senderKey?: unknown } | null)?.senderKey;
    const senderKey = kind === 'woocommerce' && typeof chosen === 'string' ? chosen : null;

    let sent = job.resume?.sent ?? 0;
    let failed = job.resume?.failed ?? 0;
    let firstError: string | null = job.resume?.firstError ?? null;
    // One statement per thousand customers; a utility broadcast is never asked.
    const windows = marketing
      ? await this.sendWindow.checkPhones(
          orgId,
          'message',
          audience.map((a) => a.phone),
        )
      : null;
    const heldAudience: Array<{ phone: string; name: string | null }> = [];
    let heldEarliest: Date | null = null;
    for (const a of audience) {
      const phone = digits(a.phone);
      if ((job.type === 'winback' || job.resume) && (phone === '' || optedOut.has(phone))) continue;
      if (phone === '') {
        failed += 1;
        continue;
      }
      // Held, not denied: kept for the delayed run; the rest of the audience carries on.
      const hold = windows?.get(phone);
      if (hold && hold.decision === 'hold') {
        heldAudience.push({ phone: a.phone, name: a.name });
        const at = new Date(hold.until);
        if (heldEarliest === null || at.getTime() < heldEarliest.getTime()) heldEarliest = at;
        continue;
      }
      const ctx =
        job.type === 'offer'
          ? offerContext(facts, product, job.input.couponCode, a.name)
          : winbackContext(facts, job.input.couponCode);
      try {
        await this.sender.send(orgId, {
          to: phone,
          template,
          ctx,
          reference: `ecom-${job.type}-${kind}-${storeId}-${ref.id}-${phone}`,
          senderKey,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        firstError ??= err instanceof Error ? err.message : 'The message was not sent.';
        this.logger.warn({ orgId, kind, storeId, type: job.type, err }, 'broadcast message failed');
      }
    }
    if (heldAudience.length > 0 && heldEarliest) {
      await this.holdRest(job, heldAudience, heldEarliest, { sent, failed, firstError });
      return;
    }
    await this.finish(orgId, kind, ref, sent, failed, sent > 0 ? null : firstError);
  }

  /** The customers the quiet hours keep back: the log row says so and a delayed run comes for them at the first opening. */
  private async holdRest(
    job: BroadcastJob,
    held: Array<{ phone: string; name: string | null }>,
    at: Date,
    so: { sent: number; failed: number; firstError: string | null },
  ): Promise<void> {
    const { orgId, kind } = job;
    const ref = { id: job.log.id, createdAt: new Date(job.log.createdAt) };
    await this.db.txAs({ orgId }, (tx) =>
      this.events.setLog(tx, orgId, kind, ref, {
        status: 'processed',
        response: {
          sent: so.sent,
          failed: so.failed,
          held: held.length,
          heldUntil: at.toISOString(),
        },
      }),
    );
    try {
      await this.queue.add(
        'broadcast',
        { ...job, resume: { audience: held, ...so } },
        {
          jobId: `ecom-held-${kind}-${job.storeId}-${job.log.id}-${Math.floor(at.getTime() / 1000)}`,
          delay: wakeDelayMs(at, this.sendWindow.now()),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    } catch (err) {
      // No job means nothing would ever send them: the log says how it ended, with the customers that never got the message as failed.
      this.logger.error({ orgId, kind, err }, 'could not queue the wake-up of a held broadcast');
      await this.finish(
        orgId,
        kind,
        ref,
        so.sent,
        so.failed + held.length,
        so.sent > 0 ? null : 'The broadcast could not be queued for after the quiet hours.',
      );
    }
  }

  private finish(
    orgId: number,
    kind: StoreKind,
    ref: { id: number; createdAt: Date },
    sent: number,
    failed: number,
    error: string | null,
  ): Promise<void> {
    return this.db.txAs({ orgId }, (tx) =>
      this.events.setLog(tx, orgId, kind, ref, {
        status: sent > 0 ? 'sent' : 'failed',
        response: { sent, failed },
        error,
      }),
    );
  }
}
