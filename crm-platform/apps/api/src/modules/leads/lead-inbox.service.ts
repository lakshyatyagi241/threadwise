import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  LEAD_INBOX_DEFAULT_WINDOW_DAYS,
  LEAD_EVENT_STATUSES,
  statusesOfFilter,
  type LeadInboxDetailResponse,
  type LeadInboxItem,
  type LeadInboxListResponse,
  type LeadInboxSummaryQuery,
  type LeadInboxSummaryResponse,
  type LeadRetryOutcome,
  type ListLeadInboxQuery,
  type RetryLeadInboxResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  LeadEventsRepository,
  type InboxFilter,
  type LeadEventRow,
} from './lead-events.repository';
import { maskLeadPayload } from './lead-payload-mask';
import { LeadSourcesService } from './lead-sources.service';
import { toLeadEventResponse } from './leads.mapper';

const EVENTS_MODULE = 'lead_events';

/** A lead waits for a person when it needs review or failed, its payload is still stored and its source is switched on. */
export const isRetryableRow = (
  e: Pick<LeadEventRow, 'status' | 'payload' | 'sourceStatus'>,
): boolean =>
  (e.status === 'needs_review' || e.status === 'failed') &&
  e.payload !== null &&
  e.sourceStatus === 'active';

export function toInboxItem(row: LeadEventRow): LeadInboxItem {
  return {
    ...toLeadEventResponse(row),
    sourceName: row.sourceName,
    sourceKind: row.sourceKind,
    sourceStatus: row.sourceStatus,
    retryable: isRetryableRow(row),
  };
}

/** The error codes of a refused retry, as the outcome the bulk answer reports per lead. */
const OUTCOME_OF_CODE: Record<string, LeadRetryOutcome> = {
  [ERROR_CODES.LEAD_EVENT_NOT_RETRYABLE]: 'not_retryable',
  [ERROR_CODES.LEAD_PAYLOAD_PURGED]: 'payload_purged',
  [ERROR_CODES.LEAD_SOURCE_PAUSED]: 'source_paused',
  [ERROR_CODES.NOT_FOUND]: 'not_found',
};

/**
 * The lead inbox (BL-014, spec L-17): every delivery of every source in one list, with filters, a masked look at the payload and a
 * retry for the leads that wait. A retry is the source screen's own (`LeadSourcesService.retryEvent`): the stored payload goes through
 * the same pipeline again under the source's current settings, and its idempotency key makes a lead that already became a contact
 * a no-op, so retrying twice, or in bulk over a page someone else already fixed, writes nothing twice.
 */
@Injectable()
export class LeadInboxService {
  private readonly logger = new Logger(LeadInboxService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly events: LeadEventsRepository,
    private readonly sources: LeadSourcesService,
    private readonly audit: AuditService,
  ) {}

  private filterOf(q: {
    sourceId?: string;
    status?: ListLeadInboxQuery['status'];
    reason?: string;
    isTest?: boolean;
    from?: string;
    to?: string;
    q?: string;
  }): InboxFilter {
    return {
      sourceUuid: q.sourceId,
      statuses: q.status ? statusesOfFilter(q.status) : undefined,
      reason: q.reason,
      isTest: q.isTest,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      q: q.q,
    };
  }

  async list(query: ListLeadInboxQuery): Promise<LeadInboxListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.events.inbox(tx, ctx.orgId, {
        ...this.filterOf(query),
        limit: query.limit,
        cursor: query.cursor,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map(toInboxItem),
        page: {
          nextCursor: hasMore && last ? this.events.inboxCursor(last) : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  async summary(query: LeadInboxSummaryQuery): Promise<LeadInboxSummaryResponse> {
    const ctx = RequestContextStore.require();
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - LEAD_INBOX_DEFAULT_WINDOW_DAYS * 86_400_000);
    const counts = await this.db.tx((tx) =>
      this.events.inboxCounts(tx, ctx.orgId, { ...this.filterOf(query), from }),
    );
    const full = Object.fromEntries(LEAD_EVENT_STATUSES.map((s) => [s, counts[s] ?? 0]));
    return {
      counts: full,
      attention: (full.needs_review ?? 0) + (full.failed ?? 0),
      total: Object.values(full).reduce((a, b) => a + b, 0),
      from: from.toISOString(),
      to: query.to ?? null,
    };
  }

  /** One delivery with its payload masked. Opening a payload is audited (action `read`), masked or not: it is still a stranger's data. */
  async detail(uuid: string): Promise<LeadInboxDetailResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.events.findAnyByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Lead event', uuid);
      let payload: Record<string, unknown> | null = null;
      let masked = false;
      if (row.payload !== null) {
        const m = maskLeadPayload(row.payload);
        payload = m.payload;
        masked = m.masked;
        await this.audit.record(tx, {
          module: EVENTS_MODULE,
          recordId: row.id,
          action: 'read',
          delta: { payload: { old: null, new: 'viewed_masked' } },
        });
      }
      return { ...toInboxItem(row), payload, payloadMasked: masked };
    });
  }

  /** Retries one lead; refusals are errors with their own codes, as on the source screen. */
  async retry(uuid: string): Promise<LeadInboxItem> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.events.findAnyByUuid(tx, ctx.orgId, uuid));
    if (!row) throw AppError.notFound('Lead event', uuid);
    await this.sources.retryEvent(row.sourceUuid, row.uuid);
    const after = await this.db.tx((tx) => this.events.findAnyByUuid(tx, ctx.orgId, uuid));
    return toInboxItem(after ?? row);
  }

  /**
   * Retries many, one after the other (never at once: each runs the whole pipeline and takes its lead's lock). A lead that cannot be
   * retried is reported with the reason and the rest go on; the answer never fails as a whole because one lead did.
   */
  async retryMany(uuids: readonly string[]): Promise<RetryLeadInboxResponse> {
    const ctx = RequestContextStore.require();
    const results: RetryLeadInboxResponse['results'] = [];
    for (const id of uuids) {
      try {
        const row = await this.db.tx((tx) => this.events.findAnyByUuid(tx, ctx.orgId, id));
        if (!row) {
          results.push({ id, outcome: 'not_found', status: null });
          continue;
        }
        const { event } = await this.sources.retryEvent(row.sourceUuid, row.uuid);
        results.push({ id, outcome: 'retried', status: event.status });
      } catch (err) {
        const outcome = err instanceof AppError ? OUTCOME_OF_CODE[err.code] : undefined;
        if (!outcome) this.logger.error({ err, orgId: ctx.orgId }, 'bulk retry of a lead failed');
        results.push({ id, outcome: outcome ?? 'error', status: null });
      }
    }
    const retried = results.filter((r) => r.outcome === 'retried').length;
    return { results, retried, skipped: results.length - retried };
  }
}
