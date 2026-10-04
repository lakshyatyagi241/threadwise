import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ConnectorError,
  ConnectorRegistry,
  isPuller,
  narrowerSpan,
  widerSpan,
} from '../../infra/providers/marketplace';
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
 * One poll of one pull connection: fetch through the connector (templated request, signature, window, address guard, error mapping), hand
 * the leads to the pipeline once each (the same delivery service the push door uses), move the high-water mark, schedule the next poll.
 *
 * The portal's limits are kept HERE, not trusted to the schedule: a request is never made sooner than the recipe's minimum interval after
 * the last one (whoever asks: the sweep, "Sync now", a retry), and a connection that is behind (paused, failing, newly installed) catches up
 * one window per poll at the pace the portal allows instead of waiting out the whole interval each time.
 *
 * Nothing is lost: the mark only moves after the leads are in; each window starts a little before the last one ended and the dedupe keys
 * (the portal's lead id, or a hash the recipe declares) absorb what is fetched twice; a retryable failure backs off, never sooner than the
 * portal's stated penalty; a refusal that retrying cannot fix (the portal rejected the key) stops the connection and says so.
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
    const c = recipe.connector;
    const interval = c.pollIntervalSeconds;
    // The soonest the portal lets us ask again, and the pace of a connection that is catching up.
    const spacing = Math.max(
      c.limits.minIntervalSeconds,
      Math.ceil(60 / c.limits.requestsPerMinute),
    );

    const before = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.state.stateOf(tx, orgId, connectionId),
    );
    const now = new Date();
    if (before.lastPollAt) {
      const waitMs =
        c.limits.minIntervalSeconds * 1000 - (now.getTime() - before.lastPollAt.getTime());
      if (waitMs > 0) {
        // Too soon for this portal: nothing is asked, the schedule moves to the moment it is allowed.
        await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.state.deferred(tx, orgId, connectionId, Math.ceil(waitMs / 1000)),
        );
        return this.skipped();
      }
    }

    let credentials: Record<string, string> = {};
    try {
      credentials = row.credentialsEnc
        ? (JSON.parse(this.crypto.decrypt(row.credentialsEnc)) as Record<string, string>)
        : {};
    } catch {
      /* unreadable credentials read as none; the portal will refuse and the failure says so */
    }

    // Marked BEFORE the request: a worker that dies mid-call must not let the next poll go out at once.
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.state.markPolling(tx, orgId, connectionId),
    );
    try {
      const result = await type.pull(
        { recipe, credentials, config: row.config },
        {
          cursor: conn.pollCursor,
          since: conn.lastSuccessAt,
          now,
          windowSeconds: before.pollWindowSeconds,
        },
      );
      if (result.overflow && c.window) {
        const narrower = narrowerSpan(c.window, result.windowSeconds);
        if (narrower !== null) {
          // More leads in the window than one answer carries: nothing was handed over, so nothing is lost or counted twice; ask again for half.
          await this.db.txAs({ orgId, userId: null }, (tx) =>
            this.state.narrowed(tx, orgId, connectionId, narrower, spacing),
          );
          return { status: 'retry', accepted: 0, duplicates: 0, failed: 0 };
        }
      }
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
        result.rejected[0] ? `unmappable_item:${result.rejected[0].reason}` : undefined,
        { quietRepeats: true },
      );
      if (counts.failed > 0) {
        // Leads did not all get in: the mark stays, the next poll fetches them again and the pipeline's idempotency absorbs the repeats.
        await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.state.scheduled(
            tx,
            orgId,
            connectionId,
            conn.pollCursor,
            Math.max(spacing, Math.min(interval, 300)),
          ),
        );
        return {
          status: 'retry',
          accepted: counts.accepted,
          duplicates: counts.duplicates,
          failed: counts.failed,
        };
      }
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.state.succeeded(tx, orgId, connectionId, row.id, {
          // A window recipe resumes from the end of the window it covered; a cursor recipe from the greatest id it saw.
          cursor: result.windowEnd
            ? result.windowEnd.toISOString()
            : (result.nextCursor ?? conn.pollCursor),
          nextInSeconds: result.behind ? spacing : interval,
          windowSeconds: c.window ? widerSpan(c.window, before.pollWindowSeconds) : null,
          leads: result.fetched,
          clean: counts.rejected === 0,
        }),
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
          retryAfterSeconds: e.retryAfterSeconds,
        }),
      );
      return { status: 'failed', accepted: 0, duplicates: 0, failed: 1 };
    }
  }

  private skipped(): PullOutcome {
    return { status: 'skipped', accepted: 0, duplicates: 0, failed: 0 };
  }
}
