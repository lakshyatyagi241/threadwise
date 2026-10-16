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

export interface BackfillCounts {
  fetched: number;
  accepted: number;
  duplicates: number;
  failed: number;
  windowsDone: number;
  windowsTotal: number;
}

export interface BackfillOutcome {
  status: 'ok' | 'partial' | 'failed';
  /** A stable code: never the portal's own words. */
  error?: string;
  counts: BackfillCounts;
}

/** Seconds the portal's history is trusted back, less a margin (the same margin the poller keeps). */
const HISTORY_MARGIN_SECONDS = 3600;
const DEFAULT_HISTORY_SECONDS = 365 * 86_400;
/** A window that fails for a reason a retry may fix is tried this many times before the backfill stops (partial). */
const MAX_ATTEMPTS = 3;
const MAX_WINDOWS = 1_000;
/** Sleeps are cut into pieces this long so the run can report that it is alive. */
const SLEEP_PIECE_MS = 30_000;

/**
 * A backfill of a date range at a pull connection whose portal answers "the leads between two times" (a recipe with a `window`): the
 * same fetch, mapping and delivery as the poller, window by window from the start of the range to its end (BL-014, L-18).
 *
 * The portal's limits are kept as the poller keeps them, because a backfill is the heaviest thing that asks the portal anything: never
 * a request sooner than the recipe's minimum interval after the last one of ANY kind (the connection's `last_poll_at` is moved before
 * each request, so the poller defers while a backfill runs), the pace of requests per minute, and a window narrowed by half when the
 * portal's answer would not fit. Nothing is written twice: the leads go through the delivery service, whose dedupe keys absorb a lead
 * fetched again. A recipe that asks by cursor (no window) has no date to start from and cannot backfill.
 *
 * The connection's own poll state (its high-water mark, its failure count and health) is NOT touched: a backfill is extra, and a
 * portal that refuses it must not turn the connection red.
 */
@Injectable()
export class PullBackfillService {
  private readonly logger = new Logger(PullBackfillService.name);

  /** Replaceable in tests. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InstallationsRepository,
    private readonly state: PullStateRepository,
    private readonly registry: ConnectorRegistry,
    private readonly delivery: DeliveryService,
    private readonly crypto: CryptoService,
  ) {}

  /** The most days back this recipe's portal can be asked for, or 0 when it cannot be backfilled. */
  static reachSeconds(window: { maxLookbackSeconds?: number | undefined } | undefined): number {
    if (!window) return 0;
    return Math.max(
      0,
      (window.maxLookbackSeconds ?? DEFAULT_HISTORY_SECONDS) - HISTORY_MARGIN_SECONDS,
    );
  }

  async run(
    orgId: number,
    installationUuid: string,
    from: Date,
    to: Date,
    progress: (c: BackfillCounts) => Promise<void>,
  ): Promise<BackfillOutcome> {
    const counts: BackfillCounts = {
      fetched: 0,
      accepted: 0,
      duplicates: 0,
      failed: 0,
      windowsDone: 0,
      windowsTotal: 0,
    };
    const fail = (error: string): BackfillOutcome => ({ status: 'failed', error, counts });

    const row = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.byUuid(tx, orgId, installationUuid),
    );
    const conn = row?.connection;
    const recipe = row ? readRecipe(row.recipe) : null;
    if (!row || !conn || !recipe || recipe.connector.type !== 'pull') return fail('not_supported');
    if (row.status !== 'active' || row.app.status === 'killed' || conn.status !== 'active') {
      return fail('not_active');
    }
    const c = recipe.connector;
    const w = c.window;
    const type = this.registry.get(c.type);
    if (!w || !isPuller(type)) return fail('not_supported');

    const now = new Date();
    const floor = now.getTime() - PullBackfillService.reachSeconds(w) * 1000;
    const start0 = Math.max(from.getTime(), floor);
    const end = Math.min(to.getTime(), now.getTime());
    if (end - start0 < 1000) return fail('range_too_old');
    counts.windowsTotal = Math.max(
      1,
      Math.ceil((end - start0) / Math.max(1, (w.maxSeconds - w.overlapSeconds) * 1000)),
    );

    let credentials: Record<string, string> = {};
    try {
      credentials = row.credentialsEnc
        ? (JSON.parse(this.crypto.decrypt(row.credentialsEnc)) as Record<string, string>)
        : {};
    } catch {
      /* unreadable credentials read as none; the portal refuses and the run says so */
    }
    const spacingMs =
      Math.max(c.limits.minIntervalSeconds, Math.ceil(60 / c.limits.requestsPerMinute)) * 1000;
    const target = {
      orgId,
      connectionId: conn.id,
      installationId: row.id,
      installationUuid: row.uuid,
      appSlug: row.app.slug,
      appName: row.app.name,
      leadSourceId: conn.leadSourceId,
    };

    let start = start0;
    let span: number | null = null;
    let incomplete = false;
    let attempts = 0;
    for (let i = 0; i < MAX_WINDOWS && start < end; i++) {
      // Never sooner than the portal allows after the last request of any kind.
      await this.waitForPortal(
        orgId,
        conn.id,
        c.limits.minIntervalSeconds * 1000,
        progress,
        counts,
      );
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.state.markPolling(tx, orgId, conn.id),
      );

      const widest = Math.min(span ?? w.maxSeconds, w.maxSeconds);
      const room = Math.floor((end - start) / 1000);
      const windowSeconds = Math.max(1, Math.min(widest, room));
      try {
        const result = await type.pull(
          { recipe, credentials, config: row.config },
          {
            // The window starts `overlapSeconds` before its cursor: this one starts exactly at `start`.
            cursor: new Date(start + w.overlapSeconds * 1000).toISOString(),
            since: null,
            now: new Date(),
            windowSeconds,
          },
        );
        if (result.overflow) {
          // Too many leads for one answer: nothing was handed over, ask for half of it.
          span = narrowerSpan(w, result.windowSeconds) ?? windowSeconds;
          await this.sleep(spacingMs);
          continue;
        }
        const delivered = await this.delivery.process(
          target,
          result.leads,
          result.rejected.length,
          result.rejected[0] ? `unmappable_item:${result.rejected[0].reason}` : undefined,
          { quietRepeats: true },
        );
        counts.fetched += result.fetched;
        counts.accepted += delivered.accepted;
        counts.duplicates += delivered.duplicates;
        counts.failed += delivered.failed;
        if (delivered.failed > 0) incomplete = true;
        counts.windowsDone = Math.min(counts.windowsTotal, counts.windowsDone + 1);
        attempts = 0;
        span = widerSpan(w, result.windowSeconds ?? windowSeconds);
        await progress(counts);
        const next = result.windowEnd ? result.windowEnd.getTime() : start + windowSeconds * 1000;
        // A window that did not move forward would loop for ever: step over it.
        start = next > start ? next : start + windowSeconds * 1000;
        if (start < end) await this.sleep(spacingMs);
      } catch (err) {
        const e =
          err instanceof ConnectorError
            ? err
            : new ConnectorError('internal_error', 'The pull failed.', false, 'degraded');
        if (!(err instanceof ConnectorError)) {
          this.logger.error({ err, orgId, connectionId: conn.id }, 'backfill crashed');
        }
        if (e.retry && ++attempts < MAX_ATTEMPTS) {
          i -= 1;
          await this.sleep(Math.max(spacingMs, (e.retryAfterSeconds ?? 0) * 1000));
          continue;
        }
        // Everything before this window is in; what is left is for a second run.
        return {
          status: counts.accepted + counts.duplicates > 0 ? 'partial' : 'failed',
          error: e.health === 'needs_reauth' ? 'credentials_refused' : e.code,
          counts,
        };
      }
    }
    if (start < end) incomplete = true;
    return {
      status: incomplete ? 'partial' : 'ok',
      ...(incomplete ? { error: 'incomplete' } : {}),
      counts,
    };
  }

  /** Waits until the portal's minimum interval has passed since the connection's last request, reporting that it is alive. */
  private async waitForPortal(
    orgId: number,
    connectionId: number,
    minIntervalMs: number,
    progress: (c: BackfillCounts) => Promise<void>,
    counts: BackfillCounts,
  ): Promise<void> {
    for (;;) {
      const s = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.state.stateOf(tx, orgId, connectionId),
      );
      const waitMs = s.lastPollAt ? minIntervalMs - (Date.now() - s.lastPollAt.getTime()) : 0;
      if (waitMs <= 0) return;
      await this.sleep(Math.min(waitMs, SLEEP_PIECE_MS));
      await progress(counts);
    }
  }
}
