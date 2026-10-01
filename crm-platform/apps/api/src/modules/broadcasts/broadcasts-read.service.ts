import { Injectable } from '@nestjs/common';
import type {
  BroadcastDetail,
  BroadcastLiveStats,
  BroadcastSummary,
  ListBroadcastRecipientsQuery,
  ListBroadcastRecipientsResponse,
  ListBroadcastsQuery,
  ListBroadcastsResponse,
  PageResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import {
  cascade,
  deliveryCurve,
  donut,
  failureHistogram,
  headerPct,
  liveStats,
  pct,
} from './broadcast-stats';
import { toBroadcastResponse } from './broadcasts.mapper';
import {
  BroadcastsReadRepository,
  type BroadcastReadRow,
  type RecipientReadRow,
} from './broadcasts-read.repository';
import { assemblePhone } from './recipient-phone';
import { isKnownTimeZone } from './schedule';

const toListItem = (r: BroadcastReadRow) => ({
  ...toBroadcastResponse(
    {
      id: r.id,
      uuid: r.uuid,
      name: r.name,
      status: r.status,
      provider: r.provider,
      deviceId: r.deviceId,
      templateUuid: r.templateUuid,
      timezone: r.timezone,
      scheduledAt: r.scheduledAt,
      completedAt: r.completedAt,
      totalRecipients: r.totalRecipients,
      successCount: r.successCount,
      deliveredCount: r.deliveredCount,
      readCount: r.readCount,
      clickedCount: r.clickedCount,
      failCount: r.failCount,
      rowVersion: r.rowVersion,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    },
    r.senderKey,
  ),
  templateName: r.templateName,
});

const recipientName = (r: RecipientReadRow) =>
  r.contactName?.trim() ||
  [r.firstName, r.lastName].filter(Boolean).join(' ').trim() ||
  'Unknown contact';

const toRecipient = (r: RecipientReadRow) => ({
  contactId: r.contactUuid,
  name: recipientName(r),
  phone: r.phone ? `+${assemblePhone(r.phone, r.countryCode)}` : '',
  status: r.status,
  error: r.error,
  providerMessageId: r.providerMessageId,
  queuedAt: r.createdAt.toISOString(),
  sentAt: r.sentAt?.toISOString() ?? null,
  deliveredAt: r.deliveredAt?.toISOString() ?? null,
  readAt: r.readAt?.toISOString() ?? null,
  clicks: r.clicks,
  lastClickAt: r.lastClickAt?.toISOString() ?? null,
});

/** The read side of broadcasts: the list, the tiles, the detail page, its recipients and the live counters. */
@Injectable()
export class BroadcastsReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BroadcastsReadRepository,
    private readonly progress: BroadcastProgressService,
  ) {}

  async list(query: ListBroadcastsQuery): Promise<ListBroadcastsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query);
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toListItem), page };
    });
  }

  async summary(): Promise<BroadcastSummary> {
    const ctx = RequestContextStore.require();
    const s = await this.db.tx((tx) => this.repo.summary(tx, ctx.orgId));
    const statusCounts: Record<string, number> = {
      all: s.totals.total,
      scheduled: 0,
      processing: 0,
      completed: 0,
      completed_with_errors: 0,
      failed: 0,
    };
    for (const r of s.byStatus) statusCounts[r.status] = Number(r.n);
    const t = s.totals;
    return {
      stats: {
        ...t,
        processing: s.recipientStates.processing,
        queued: s.recipientStates.queued,
        deliveryPct: pct(t.delivered, t.sent),
        readPct: pct(t.read, t.delivered),
        failedPct: pct(t.failed, t.sent),
      },
      statusCounts,
    };
  }

  private async load(
    tx: Parameters<BroadcastsReadRepository['findByUuid']>[0],
    orgId: number,
    uuid: string,
  ) {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Broadcast', uuid);
    return row;
  }

  async detail(uuid: string): Promise<BroadcastDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const b = await this.load(tx, ctx.orgId, uuid);
      const counts = await this.progress.counts(tx, ctx.orgId, b.id);
      const k = cascade(counts);
      const zone = b.timezone && isKnownTimeZone(b.timezone) ? b.timezone : 'UTC';
      const curveIn = await this.repo.curveInputs(tx, ctx.orgId, b.id, b.createdAt, zone);
      const curve = deliveryCurve(curveIn.createdHour, curveIn);
      const tpl =
        b.templateId === null ? undefined : await this.repo.template(tx, ctx.orgId, b.templateId);
      const sender = await this.repo.sender(tx, ctx.orgId, b.provider, b.deviceId);
      const failures = await this.repo.failureReasons(tx, ctx.orgId, b.id);

      return {
        broadcast: toListItem(b),
        template: tpl
          ? {
              id: tpl.uuid,
              name: tpl.template_name,
              category: tpl.category,
              type: tpl.template_type,
              language: tpl.language,
              header: tpl.header,
              body: tpl.template_body,
              footer: tpl.footer,
              buttons: tpl.buttons,
            }
          : null,
        sender: sender
          ? {
              engine: b.provider ?? '',
              label: sender.label ?? '',
              phone: sender.phone ? `+${assemblePhone(sender.phone, sender.country_code)}` : '',
            }
          : null,
        counts: {
          total: k.total,
          sent: k.sent,
          delivered: k.delivered,
          read: k.read,
          failed: k.failed,
          queued: k.queued,
        },
        pct: headerPct(k),
        donut: donut(counts),
        deliveryCurve: {
          labels: curve.labels,
          sent: curve.sent,
          delivered: curve.delivered,
          read: curve.read,
        },
        failureReasons: failureHistogram(failures),
        events: {
          createdAt: b.createdAt.toISOString(),
          scheduledAt: b.scheduledAt?.toISOString() ?? null,
          status: b.status,
          completedAt: b.completedAt?.toISOString() ?? null,
        },
      };
    });
  }

  async recipients(
    uuid: string,
    query: ListBroadcastRecipientsQuery,
  ): Promise<ListBroadcastRecipientsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const b = await this.load(tx, ctx.orgId, uuid);
      const rows = await this.repo.recipients(tx, ctx.orgId, b.id, query);
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toRecipient), page } as PageResponse<ReturnType<typeof toRecipient>>;
    });
  }

  /** The counters the page polls while a broadcast is moving (WD-BCAST-035). */
  async live(uuid: string): Promise<BroadcastLiveStats> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const b = await this.load(tx, ctx.orgId, uuid);
      return liveStats(b.status, await this.progress.counts(tx, ctx.orgId, b.id), new Date());
    });
  }

  /** WD-BCAST-036: the same cascade as the live counters, plus the recipients being sent. */
  async statistics(uuid: string) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const b = await this.load(tx, ctx.orgId, uuid);
      const k = cascade(await this.progress.counts(tx, ctx.orgId, b.id));
      return {
        sent: k.sent,
        delivered: k.delivered,
        read: k.read,
        failed: k.failed,
        processing: k.processing,
        queued: k.queued,
      };
    });
  }
}
