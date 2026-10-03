import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import type { ConnectorLead } from '../../infra/providers/marketplace';
import { InstallationsRepository } from './installations.repository';
import { LeadPipelineGateway } from './lead-pipeline.gateway';

/** Where a connection's leads go, and what the pipeline needs to give them a source of their own. */
export interface DeliveryTarget {
  orgId: number;
  connectionId: number;
  installationId: number;
  installationUuid: string;
  appSlug: string;
  appName: string;
  /** The pipeline's source for the connection, when it already has one. */
  leadSourceId: number | null;
}

export interface DeliveryCounts {
  received: number;
  accepted: number;
  duplicates: number;
  failed: number;
  rejected: number;
  /** The pipeline could not take the leads at all: the sender should retry, nothing was lost. */
  pipelineDown: boolean;
  firstError: string | null;
  /** Sender ids of the leads, in order, with the outcome of each: for the manual "send sample lead" answer. */
  outcomes: Array<{ externalId: string; status: 'accepted' | 'duplicate' | 'failed' }>;
}

/**
 * Takes a connection's leads through to the lead pipeline, one at a time, exactly once per delivery id.
 *
 * The door's own idempotency guard is the `marketplace_connection_events` row of each delivery id (the pipeline is idempotent on
 * `(source, external id)` too, so a crash between the pipeline call and the row never makes a second lead). Order, per lead:
 *   1. an id already accepted is a duplicate: counted, the pipeline is not called again;
 *   2. otherwise the pipeline is called OUTSIDE any transaction of ours (it opens its own);
 *   3. the outcome is recorded: accepted, or failed with the reason, so a retry of the same id tries again.
 * The connection's counters and the installation's health move once at the end, in one transaction.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InstallationsRepository,
    private readonly pipeline: LeadPipelineGateway,
  ) {}

  async process(
    target: DeliveryTarget,
    leads: ConnectorLead[],
    rejected: number,
  ): Promise<DeliveryCounts> {
    const { orgId } = target;
    const counts: DeliveryCounts = {
      received: leads.length + rejected,
      accepted: 0,
      duplicates: 0,
      failed: 0,
      rejected,
      pipelineDown: false,
      firstError: rejected > 0 ? 'unmappable_item' : null,
      outcomes: [],
    };
    let sourceId = target.leadSourceId;

    for (const lead of leads) {
      const known = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.eventOf(tx, orgId, target.connectionId, lead.externalId),
      );
      if (known?.status === 'accepted') {
        await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.bumpSeen(tx, orgId, known.id),
        );
        counts.duplicates += 1;
        counts.outcomes.push({ externalId: lead.externalId, status: 'duplicate' });
        continue;
      }
      try {
        if (sourceId === null) {
          sourceId = await this.pipeline.ensureSource(orgId, {
            providerKey: target.appSlug,
            externalRef: target.installationUuid,
            name: target.appName,
          });
          if (sourceId === null) throw this.noSource();
          const id = sourceId;
          await this.db.txAs({ orgId, userId: null }, (tx) =>
            this.repo.setLeadSource(tx, orgId, target.connectionId, id),
          );
        }
        const outcome = await this.pipeline.deliver(orgId, sourceId, lead);
        if (outcome === 'failed') throw new Error('pipeline_failed');
        await this.record(orgId, target.connectionId, lead.externalId, 'accepted', null);
        if (outcome === 'duplicate') {
          counts.duplicates += 1;
          counts.outcomes.push({ externalId: lead.externalId, status: 'duplicate' });
        } else {
          counts.accepted += 1;
          counts.outcomes.push({ externalId: lead.externalId, status: 'accepted' });
        }
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'internal_error';
        if (err instanceof AppError && err.code === ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE)
          counts.pipelineDown = true;
        else
          this.logger.warn(
            { err, orgId, connectionId: target.connectionId },
            'lead delivery failed',
          );
        counts.failed += 1;
        counts.firstError ??= String(code);
        counts.outcomes.push({ externalId: lead.externalId, status: 'failed' });
        await this.record(
          orgId,
          target.connectionId,
          lead.externalId,
          'failed',
          String(code).slice(0, 200),
        ).catch(() => undefined);
      }
    }

    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.recordDelivery(tx, orgId, target.connectionId, target.installationId, {
        received: counts.received,
        accepted: counts.accepted,
        duplicates: counts.duplicates,
        failed: counts.failed + counts.rejected,
        error: counts.firstError,
      }),
    );
    return counts;
  }

  private record(
    orgId: number,
    connectionId: number,
    externalId: string,
    status: 'accepted' | 'failed',
    error: string | null,
  ): Promise<void> {
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.recordEvent(tx, orgId, connectionId, externalId, status, error),
    );
  }

  private noSource(): AppError {
    return new AppError(
      ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE,
      'Leads cannot be received right now. Try again in a moment.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
