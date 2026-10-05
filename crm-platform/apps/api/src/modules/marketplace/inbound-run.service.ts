import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectorRegistry,
  describeReadFailure,
  isInbound,
  readDelivery,
  type RawDelivery,
} from '../../infra/providers/marketplace';
import { DatabaseService } from '../../infra/db/database.service';
import { DeliveryService, type DeliveryTarget } from './delivery.service';
import { InboundEventsRepository, type ClaimedInboundEvent } from './inbound-events.repository';
import { InstallationsRepository } from './installations.repository';
import { readRecipe } from './marketplace.mapper';
import { PullStateRepository } from './pull-state.repository';

export interface InboundOutcome {
  status: 'skipped' | 'processed' | 'rejected' | 'retry';
}

/** After this many tries from the stored copy a delivery is given up on (about eight hours with the back-off below). */
export const INBOUND_MAX_ATTEMPTS = 12;
/** 30 seconds, doubling, at most an hour. */
export const inboundBackoffSeconds = (attempts: number): number =>
  Math.min(30 * 2 ** Math.max(attempts - 1, 0), 3600);

/**
 * One delivery of a portal connection that answers at once, taken from the inbox: read it again from the stored bytes (JSON, form, XML or
 * query string, as it arrived), map it with the recipe, hand the leads to the pipeline through the same delivery service every door uses
 * (idempotent on the connection's delivery ids and the pipeline's `(source, external id)`), and settle the stored row.
 *
 * Settled one of three ways: processed (the body is dropped), rejected for good (it cannot be read, holds no lead, or its connection was
 * switched off: the body stays for support), or retried later from the stored copy (the pipeline could not take it). A worker that dies
 * mid-delivery leaves it `processing`, and the sweep takes it over; running it again is harmless, an accepted lead is only ever a duplicate.
 */
@Injectable()
export class InboundRunService {
  private readonly logger = new Logger(InboundRunService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly events: InboundEventsRepository,
    private readonly repo: InstallationsRepository,
    private readonly pull: PullStateRepository,
    private readonly registry: ConnectorRegistry,
    private readonly delivery: DeliveryService,
  ) {}

  async run(orgId: number, eventId: number): Promise<InboundOutcome> {
    const claimed = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.events.claim(tx, orgId, eventId),
    );
    if (!claimed) return { status: 'skipped' };
    try {
      return await this.process(orgId, claimed);
    } catch (err) {
      // Never leave it `processing` for the sweep to find in five minutes without a count against it.
      this.logger.error({ err, orgId, eventId }, 'inbound delivery crashed');
      return this.later(orgId, claimed, 'internal_error');
    }
  }

  private async process(orgId: number, ev: ClaimedInboundEvent): Promise<InboundOutcome> {
    const row = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const installationId = await this.pull.installationIdOf(tx, orgId, ev.connectionId);
      return installationId === null ? null : this.repo.byId(tx, orgId, installationId);
    });
    const conn = row?.connection;
    if (!row || !conn) return this.reject(orgId, ev, 'connection_gone');
    if (
      row.status !== 'active' ||
      row.app.status === 'killed' ||
      conn.status === 'paused' ||
      conn.status === 'disabled'
    ) {
      // The admin paused it (or the platform killed it) after the sender's delivery was stored: switched off means no new leads.
      return this.reject(orgId, ev, 'connection_inactive');
    }
    const recipe = readRecipe(row.recipe);
    const type = recipe ? this.registry.get(recipe.connector.type) : null;
    if (!recipe || !type || !isInbound(type)) return this.reject(orgId, ev, 'not_inbound');

    const target: DeliveryTarget = {
      orgId,
      connectionId: conn.id,
      installationId: row.id,
      installationUuid: row.uuid,
      appSlug: row.app.slug,
      appName: row.app.name,
      leadSourceId: conn.leadSourceId,
    };

    const raw: RawDelivery = {
      method: ev.method,
      contentType: ev.contentType ?? undefined,
      body: Buffer.from(ev.format === 'query' ? '' : ev.body, 'utf8'),
      query: ev.format === 'query' ? ev.body : '',
    };
    const read = readDelivery(ev.format, raw);
    if (!read.ok) {
      await this.delivery.process(target, [], 1, `unreadable:${read.reason}`);
      return this.reject(orgId, ev, describeReadFailure(ev.format, read.reason), {
        received: 1,
        accepted: 0,
        duplicates: 0,
        rejected: 1,
      });
    }

    const parsed = type.parse(recipe, read.value);
    const reason = parsed.rejected[0] ? `unmappable_item:${parsed.rejected[0].reason}` : undefined;
    if (parsed.leads.length === 0) {
      const n = Math.max(parsed.rejected.length, 1);
      await this.delivery.process(target, [], n, reason ?? 'unmappable_item:empty');
      return this.reject(orgId, ev, reason ?? 'The delivery holds no lead.', {
        received: n,
        accepted: 0,
        duplicates: 0,
        rejected: n,
      });
    }

    const counts = await this.delivery.process(
      target,
      parsed.leads,
      parsed.rejected.length,
      reason,
    );
    const summary = {
      received: counts.received,
      accepted: counts.accepted,
      duplicates: counts.duplicates,
      rejected: counts.rejected,
    };
    if (counts.failed > 0) {
      return this.later(orgId, ev, counts.firstError ?? 'lead_not_stored', summary);
    }
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.events.processed(tx, orgId, ev.id, summary),
    );
    return { status: 'processed' };
  }

  private async reject(
    orgId: number,
    ev: ClaimedInboundEvent,
    error: string,
    counts?: { received: number; accepted: number; duplicates: number; rejected: number },
  ): Promise<InboundOutcome> {
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.events.rejected(tx, orgId, ev.id, error, counts),
    );
    return { status: 'rejected' };
  }

  /** The pipeline could not take it now: from the stored copy again after a back-off, or given up on after too many tries. */
  private async later(
    orgId: number,
    ev: ClaimedInboundEvent,
    error: string,
    counts?: { received: number; accepted: number; duplicates: number; rejected: number },
  ): Promise<InboundOutcome> {
    if (ev.attempts >= INBOUND_MAX_ATTEMPTS) {
      return this.reject(orgId, ev, `gave_up:${error}`, counts);
    }
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.events.retryLater(tx, orgId, ev.id, error, inboundBackoffSeconds(ev.attempts)),
    );
    return { status: 'retry' };
  }
}
