import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { ConnectorError, ConnectorRegistry, isPuller } from '../../infra/providers/marketplace';
import { DeliveryService } from './delivery.service';
import { InstallationsRepository } from './installations.repository';
import { readRecipe } from './marketplace.mapper';
import { PullStateRepository } from './pull-state.repository';

export interface PullOutcome {
  status: 'skipped' | 'ok' | 'failed' | 'retry';
  accepted: number;
  duplicates: number;
  failed: number;
}

/**
 * One poll of one pull connection: fetch through the connector (templated request, address guard, error mapping), hand the leads to the
 * pipeline once each (the same delivery service the push door uses), move the cursor, schedule the next poll. A failed poll never loses
 * anything: the cursor only moves after the leads are in, and a retryable failure backs off.
 *
 * Runs in the worker process, one job per connection (`mkt-pull`, job id = the connection, so a poll still running is never queued twice).
 */
@Injectable()
export class PullRunService {
  private readonly logger = new Logger(PullRunService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InstallationsRepository,
    private readonly state: PullStateRepository,
    private readonly registry: ConnectorRegistry,
    private readonly delivery: DeliveryService,
    private readonly crypto: CryptoService,
  ) {}

  async run(orgId: number, connectionId: number): Promise<PullOutcome> {
    const row = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const installationId = await this.state.installationIdOf(tx, orgId, connectionId);
      return installationId === null ? null : this.repo.byId(tx, orgId, installationId);
    });
    const conn = row?.connection;
    const recipe = row ? readRecipe(row.recipe) : null;
    if (!row || !conn || !recipe || conn.id !== connectionId) return this.skipped();
    if (row.status !== 'active' || row.app.status === 'killed' || conn.status !== 'active')
      return this.skipped();
    const type = this.registry.get(recipe.connector.type);
    if (!isPuller(type) || recipe.connector.type !== 'pull') return this.skipped();
    const interval = recipe.connector.pollIntervalSeconds;

    let credentials: Record<string, string> = {};
    try {
      credentials = row.credentialsEnc
        ? (JSON.parse(this.crypto.decrypt(row.credentialsEnc)) as Record<string, string>)
        : {};
    } catch {
      /* unreadable credentials read as none; the portal will refuse and the failure says so */
    }

    const now = new Date();
    try {
      const result = await type.pull(
        { recipe, credentials, config: row.config },
        { cursor: conn.pollCursor, since: conn.lastSuccessAt, now },
      );
      const counts = await this.delivery.process(
        {
          orgId,
          connectionId,
          installationId: row.id,
          installationUuid: row.uuid,
          appSlug: row.app.slug,
          appName: row.app.name,
          leadSourceId: conn.leadSourceId,
        },
        result.leads,
        result.rejected.length,
      );
      if (counts.failed > 0) {
        // Leads did not all get in: the cursor stays, the next poll fetches them again and the pipeline's idempotency absorbs the repeats.
        await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.state.scheduled(tx, orgId, connectionId, conn.pollCursor, Math.min(interval, 300)),
        );
        return {
          status: 'retry',
          accepted: counts.accepted,
          duplicates: counts.duplicates,
          failed: counts.failed,
        };
      }
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.state.scheduled(
          tx,
          orgId,
          connectionId,
          result.nextCursor ?? conn.pollCursor,
          interval,
        ),
      );
      return { status: 'ok', accepted: counts.accepted, duplicates: counts.duplicates, failed: 0 };
    } catch (err) {
      const e =
        err instanceof ConnectorError
          ? err
          : new ConnectorError('internal_error', 'The poll failed unexpectedly.', true, 'degraded');
      if (!(err instanceof ConnectorError))
        this.logger.error({ err, orgId, connectionId }, 'pull crashed');
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.state.failed(tx, orgId, connectionId, row.id, {
          message: e.message,
          retry: e.retry,
          health: e.health,
          intervalSeconds: interval,
        }),
      );
      return { status: 'failed', accepted: 0, duplicates: 0, failed: 1 };
    }
  }

  private skipped(): PullOutcome {
    return { status: 'skipped', accepted: 0, duplicates: 0, failed: 0 };
  }
}
