import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  ICS_FEED_HORIZON_DAYS,
  ICS_FEED_LIMIT,
  ICS_FEED_MAX_INTERVALS,
  ICS_FEED_REFRESH_MINUTES,
  type CreateIcsFeedInput,
  type IcsFeed,
  type IcsFeedListResponse,
  type UpdateIcsFeedInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ICS_FEED_FETCHER,
  IcsFetchError,
  normalizeFeedUrl,
  type IcsFeedFetcherPort,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { BookingTypesRepository } from './booking-types.repository';
import { IcsFormatError, parseIcsBusy } from './ics-feed-parser';
import { IcsFeedsRepository, type FetchOutcome, type IcsFeedRow } from './ics-feeds.repository';
import { resolveZone } from './slots.service';

export const ICS_FEED_AUDIT_MODULE = 'calendar_ics_feed';
/** A person pressing "refresh" repeatedly does not hit the remote calendar more than this often. */
const REFRESH_NOW_MIN_GAP_MS = 30_000;
const DAY_MS = 86_400_000;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/** What one read of a feed produced: the outcome to record, and its busy intervals. */
interface Read {
  outcome: FetchOutcome;
  busy?: Array<{ startMs: number; endMs: number }>;
}

/**
 * The workspace's read-only iCal subscriptions (BL-035). A feed contributes BUSY TIME only: nothing of it is imported, shown to anyone or sent
 * anywhere. The address is a secret (published-calendar addresses carry a token): it is sealed at rest, never returned and never written to a log;
 * only its host is kept for display. Adding a feed reads it once first, so a wrong address or a page that is not a calendar is told at the
 * moment it is typed, not discovered a day later as slots that ignore it.
 */
@Injectable()
export class IcsFeedsService {
  private readonly logger = new Logger(IcsFeedsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly feeds: IcsFeedsRepository,
    private readonly types: BookingTypesRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(ICS_FEED_FETCHER) private readonly fetcher: IcsFeedFetcherPort,
  ) {}

  // --- staff -----------------------------------------------------------------------------------------------------------

  async list(): Promise<IcsFeedListResponse> {
    const orgId = RequestContextStore.require().orgId;
    const rows = await this.db.tx((tx) => this.feeds.list(tx, orgId));
    return { data: rows.map(toResponse) };
  }

  async create(input: CreateIcsFeedInput): Promise<IcsFeed> {
    const ctx = RequestContextStore.require();
    const url = normalizeFeedUrl(input.url);
    if (!url) {
      throw new AppError(
        ERROR_CODES.APPT_ICS_FEED_INVALID,
        'Enter the calendar address that starts with https://, http:// or webcal://, without a user name or password in it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'url', message: 'invalid' }],
      );
    }
    const existing = await this.db.tx((tx) => this.feeds.count(tx, ctx.orgId));
    if (existing >= ICS_FEED_LIMIT) {
      throw new AppError(
        ERROR_CODES.APPT_ICS_FEED_LIMIT,
        `A workspace can subscribe to at most ${ICS_FEED_LIMIT} calendars.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const normalized = url.toString();
    // Read before saving: the vendor call is slow and must not hold a transaction.
    const zone = await this.zoneOf(ctx.orgId);
    const read = await this.read(
      normalized,
      { etag: null, lastModified: null },
      zone,
      input.blockAllDay,
    );
    if (read.outcome.kind === 'failed') {
      throw new AppError(
        ERROR_CODES.APPT_ICS_FEED_UNREADABLE,
        'That address could not be read as a calendar.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'url', message: read.outcome.code }],
      );
    }
    const row = await this.db.tx(async (tx) => {
      const inserted = await this.feeds.insert(tx, ctx.orgId, {
        name: input.name,
        urlEnc: this.crypto.encrypt(normalized),
        urlHost: url.hostname.slice(0, 200),
        urlHash: sha(normalized),
        blockAllDay: input.blockAllDay,
        createdBy: ctx.userId,
      });
      if (!inserted) {
        throw new AppError(
          ERROR_CODES.APPT_ICS_FEED_DUPLICATE,
          'This workspace already subscribes to that calendar.',
          HttpStatus.CONFLICT,
        );
      }
      await this.feeds.record(
        tx,
        ctx.orgId,
        inserted.id,
        read.outcome,
        nextRead(true, 0),
        read.busy,
      );
      await this.audit.record(tx, {
        module: ICS_FEED_AUDIT_MODULE,
        recordId: inserted.id,
        action: 'insert',
        // The address is a secret and never goes into an audit row; the name and the host say which calendar it is.
        delta: {
          name: { old: null, new: inserted.name },
          host: { old: null, new: inserted.urlHost },
        },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: ICS_FEED_AUDIT_MODULE,
        aggregateId: inserted.id,
        eventType: 'calendar_ics_feed.created',
        payload: { uuid: inserted.uuid },
      });
      return (await this.feeds.findById(tx, ctx.orgId, inserted.id))!;
    });
    return toResponse(row);
  }

  async update(uuid: string, input: UpdateIcsFeedInput): Promise<IcsFeed> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      const before = await this.mustFind(tx, ctx.orgId, uuid, true);
      if (before.rowVersion !== input.rowVersion)
        throw AppError.rowVersionConflict('Calendar feed');
      const after = await this.feeds.update(tx, ctx.orgId, before.id, input.rowVersion, input);
      if (!after) throw AppError.rowVersionConflict('Calendar feed');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.name !== undefined && input.name !== before.name)
        delta.name = { old: before.name, new: input.name };
      if (input.isActive !== undefined && input.isActive !== before.isActive) {
        delta.isActive = { old: before.isActive, new: input.isActive };
      }
      if (input.blockAllDay !== undefined && input.blockAllDay !== before.blockAllDay) {
        delta.blockAllDay = { old: before.blockAllDay, new: input.blockAllDay };
      }
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: ICS_FEED_AUDIT_MODULE,
          recordId: before.id,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          orgId: ctx.orgId,
          aggregateModule: ICS_FEED_AUDIT_MODULE,
          aggregateId: before.id,
          eventType: 'calendar_ics_feed.updated',
          payload: { uuid: before.uuid, isActive: after.isActive },
        });
      }
      return after;
    });
    return toResponse(row);
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const before = await this.mustFind(tx, ctx.orgId, uuid, true);
      // The busy intervals go with it (the foreign key cascades): its slots are free again at once.
      await this.feeds.remove(tx, ctx.orgId, before.id);
      await this.audit.record(tx, {
        module: ICS_FEED_AUDIT_MODULE,
        recordId: before.id,
        action: 'delete',
        delta: { name: { old: before.name, new: null } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: ICS_FEED_AUDIT_MODULE,
        aggregateId: before.id,
        eventType: 'calendar_ics_feed.deleted',
        payload: { uuid: before.uuid },
      });
    });
  }

  /** "Read it now": one feed, in the request. A feed read within the last half minute is left alone (the page just shows it). */
  async refreshNow(uuid: string): Promise<IcsFeed> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.mustFind(tx, ctx.orgId, uuid));
    const recent =
      row.lastFetchedAt && Date.now() - row.lastFetchedAt.getTime() < REFRESH_NOW_MIN_GAP_MS;
    if (!recent && row.isActive) await this.refresh(ctx.orgId, row.id);
    return toResponse(await this.db.tx((tx) => this.mustFind(tx, ctx.orgId, uuid)));
  }

  // --- the worker ------------------------------------------------------------------------------------------------------

  /**
   * Reads one feed and stores the result. Never throws for what the remote calendar says: a failure is recorded (status, code, a back-off) and the
   * busy intervals of the last good read stay. Returns what happened, for the job's log.
   */
  async refresh(
    orgId: number,
    feedId: number,
  ): Promise<'ok' | 'not_modified' | 'failed' | 'skipped'> {
    return RequestContextStore.run(
      {
        requestId: `ics-feed-${orgId}-${feedId}-${Date.now()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        const row = await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.feeds.findById(tx, orgId, feedId),
        );
        if (!row || !row.isActive) return 'skipped';
        let address: string;
        try {
          address = this.crypto.decrypt(row.urlEnc);
        } catch {
          // Sealed with a key that is gone: the feed cannot be read until it is added again.
          await this.store(orgId, row, { outcome: { kind: 'failed', code: 'unreachable' } });
          return 'failed';
        }
        const zone = await this.zoneOf(orgId);
        const read = await this.read(
          address,
          { etag: row.etag, lastModified: row.lastModified },
          zone,
          row.blockAllDay,
        );
        await this.store(orgId, row, read);
        return read.outcome.kind === 'failed' ? 'failed' : read.outcome.kind;
      },
    );
  }

  private async store(orgId: number, row: IcsFeedRow, read: Read): Promise<void> {
    const failures = read.outcome.kind === 'failed' ? row.consecutiveFailures + 1 : 0;
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.feeds.record(
        tx,
        orgId,
        row.id,
        read.outcome,
        nextRead(read.outcome.kind !== 'failed', failures),
        read.busy,
      ),
    );
    if (read.outcome.kind === 'failed') {
      // The code only: the address never reaches a log.
      this.logger.warn(
        { orgId, feed: row.uuid, code: read.outcome.code, failures },
        'iCal feed could not be read',
      );
    }
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  /** Fetches and parses a feed. The result is an outcome, never an exception for what the remote calendar did. */
  private async read(
    address: string,
    validators: { etag: string | null; lastModified: string | null },
    zone: string,
    blockAllDay: boolean,
  ): Promise<Read> {
    let got;
    try {
      got = await this.fetcher.fetch(address, validators);
    } catch (err) {
      if (err instanceof IcsFetchError) return { outcome: { kind: 'failed', code: err.code } };
      this.logger.warn({ err: String(err) }, 'iCal feed fetch failed unexpectedly');
      return { outcome: { kind: 'failed', code: 'unreachable' } };
    }
    if (got.kind === 'not_modified') return { outcome: { kind: 'not_modified' } };
    const now = Date.now();
    try {
      const parsed = parseIcsBusy(got.text, {
        defaultZone: zone,
        fromMs: now - DAY_MS,
        toMs: now + ICS_FEED_HORIZON_DAYS * DAY_MS,
        blockAllDay,
        maxIntervals: ICS_FEED_MAX_INTERVALS,
      });
      return {
        busy: parsed.busy,
        outcome: {
          kind: 'ok',
          etag: got.etag,
          lastModified: got.lastModified,
          calendarName: parsed.calendarName,
          eventCount: parsed.events,
          busyCount: parsed.busy.length,
          warnings: parsed.warnings,
        },
      };
    } catch (err) {
      if (err instanceof IcsFormatError)
        return { outcome: { kind: 'failed', code: 'not_a_calendar' } };
      throw err;
    }
  }

  private async zoneOf(orgId: number): Promise<string> {
    return this.db.txAs({ orgId, userId: null }, async (tx) =>
      resolveZone((await this.types.org(tx, orgId)).timezone),
    );
  }

  private async mustFind(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<IcsFeedRow> {
    const row = await this.feeds.findByUuid(tx, orgId, uuid, forUpdate);
    if (!row) throw AppError.notFound('Calendar feed', uuid);
    return row;
  }
}

/** When to read next: every `ICS_FEED_REFRESH_MINUTES` while healthy; after a failure 15 minutes doubling up to 6 hours. */
export function nextRead(healthy: boolean, failures: number, now: Date = new Date()): Date {
  const minutes = healthy
    ? ICS_FEED_REFRESH_MINUTES
    : Math.min(ICS_FEED_REFRESH_MINUTES * 2 ** Math.max(0, failures - 1), 360);
  return new Date(now.getTime() + minutes * 60_000);
}

export function toResponse(r: IcsFeedRow): IcsFeed {
  return {
    id: r.uuid,
    name: r.name,
    host: r.urlHost,
    isActive: r.isActive,
    blockAllDay: r.blockAllDay,
    status: r.status,
    errorCode: r.lastErrorCode,
    lastFetchedAt: r.lastFetchedAt?.toISOString() ?? null,
    lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
    calendarName: r.calendarName,
    eventCount: r.eventCount,
    busyCount: r.busyCount,
    warnings: r.warnings,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
  };
}
