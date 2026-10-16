import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DatabaseService } from '../../infra/db/database.service';
// Only the leaf port of the lead pipeline's pulls: it imports nothing, so this module's import graph does not pull the leads module in
// (the lead pipeline is reached through ports here, and the leads module must not import this module either).
import {
  LEAD_PULL_REGISTRY,
  type LeadPullCapabilities,
  type LeadPullProgress,
  type LeadPullProvider,
  type LeadPullRegistryPort,
  type LeadPullRequest,
  type LeadPullResult,
  type LeadPullSource,
} from '../leads/lead-pull.port';
import { InstallationsRepository } from './installations.repository';
import { readRecipe } from './marketplace.mapper';
import { PullBackfillService } from './pull-backfill.service';
import { PullRunService } from './pull-run.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NONE: LeadPullProgress = {
  fetched: 0,
  accepted: 0,
  duplicates: 0,
  failed: 0,
  windowsDone: 0,
  windowsTotal: 0,
};

/**
 * The marketplace's pull connectors as pullable lead sources (BL-014, L-18). A connector's lead source (`kind: connector`) carries its
 * installation's uuid as `externalRef`; the installation's recipe says whether it is polled and whether the portal can be asked for a
 * date range. "Sync now" runs the poller's own step (`PullRunService.run`, which keeps the portal's minimum interval itself); a backfill
 * is `PullBackfillService`.
 */
@Injectable()
export class MarketplaceLeadPullProvider implements LeadPullProvider {
  readonly name = 'marketplace';

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InstallationsRepository,
    private readonly poll: PullRunService,
    private readonly backfill: PullBackfillService,
  ) {}

  async capabilities(orgId: number, source: LeadPullSource): Promise<LeadPullCapabilities | null> {
    // The reference of a connector source is its installation's uuid; another domain's connector sources carry other references.
    if (source.kind !== 'connector' || !source.externalRef || !UUID.test(source.externalRef))
      return null;
    const row = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.byUuid(tx, orgId, source.externalRef!),
    );
    const recipe = row ? readRecipe(row.recipe) : null;
    if (!row || !recipe || recipe.connector.type !== 'pull' || !row.connection) return null;
    const c = recipe.connector;
    return {
      sync: true,
      backfill: Boolean(c.window),
      minIntervalSeconds: c.limits.minIntervalSeconds,
      maxBackfillSeconds: PullBackfillService.reachSeconds(c.window),
    };
  }

  async pull(req: LeadPullRequest): Promise<LeadPullResult> {
    const installationUuid = req.source.externalRef;
    if (!installationUuid || !UUID.test(installationUuid)) {
      return { status: 'failed', error: 'not_supported', progress: NONE };
    }

    if (req.mode === 'backfill') {
      if (!req.from || !req.to) return { status: 'failed', error: 'range_invalid', progress: NONE };
      const out = await this.backfill.run(req.orgId, installationUuid, req.from, req.to, (c) =>
        req.progress(c),
      );
      return { status: out.status, error: out.error, progress: out.counts };
    }

    const row = await this.db.txAs({ orgId: req.orgId, userId: null }, (tx) =>
      this.repo.byUuid(tx, req.orgId, installationUuid),
    );
    if (!row?.connection) return { status: 'failed', error: 'not_supported', progress: NONE };
    const out = await this.poll.run(req.orgId, row.connection.id);
    const progress: LeadPullProgress = {
      fetched: out.accepted + out.duplicates + out.failed,
      accepted: out.accepted,
      duplicates: out.duplicates,
      failed: out.failed,
      windowsDone: out.status === 'skipped' ? 0 : 1,
      windowsTotal: 1,
    };
    await req.progress(progress);
    switch (out.status) {
      case 'ok':
        return { status: 'ok', progress };
      // The poller asks again by itself (leads not all in, a window narrowed): what it fetched is in, the rest follows.
      case 'retry':
        return { status: 'partial', error: 'incomplete', progress };
      // Too soon for this portal's minimum interval, or the connection is paused or switched off: nothing was asked.
      case 'skipped':
        return { status: 'throttled', error: 'not_now', progress };
      case 'failed':
        return { status: 'failed', error: 'provider_error', progress };
    }
  }
}

/**
 * Puts the provider in the lead pipeline's registry once the application is up. The registry is looked up by its token in the whole
 * application, like the lead pipeline's other ports, so neither module imports the other; when the lead pipeline is not part of the
 * build there is nothing to register with and the marketplace works as before.
 */
@Injectable()
export class MarketplaceLeadPullBinding implements OnApplicationBootstrap {
  private readonly logger = new Logger(MarketplaceLeadPullBinding.name);

  constructor(
    private readonly modules: ModuleRef,
    private readonly provider: MarketplaceLeadPullProvider,
  ) {}

  onApplicationBootstrap(): void {
    try {
      this.modules
        .get<LeadPullRegistryPort>(LEAD_PULL_REGISTRY, { strict: false })
        .register(this.provider);
    } catch {
      this.logger.debug(
        'no lead pull registry in this build; connector sources cannot be pulled from the inbox',
      );
    }
  }
}
