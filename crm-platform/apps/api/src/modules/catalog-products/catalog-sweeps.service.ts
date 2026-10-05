import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { readCatalogEnv } from '../../config/domains/catalog-products.env';
import { DatabaseService } from '../../infra/db/database.service';
import { CatalogSyncService } from './catalog-sync.service';
import { CatalogsRepository } from './catalogs.repository';
import { InventoryService } from './inventory.service';

export interface ResyncSummary {
  catalogs: number;
  pushed: number;
  synced: number;
  failed: number;
  errors: number;
}

/**
 * The catalog resync sweep (WD-CAT-013): the backstop for missed auto-pushes and bulk imports. For every organization with a
 * connected catalog it pushes the dirty products in one batch of up to 1000, then settles the pending batches. WaDesk had the
 * command (`catalog:resync`) but never scheduled it, so nothing ran it; here it runs every hour (`CAT_RESYNC_INTERVAL_MS`).
 *
 * It spans organizations, so the list of them is read privileged; the work of each one runs under its own tenant context, and
 * one organization failing never stops the others. Imported by the worker module only.
 */
@Injectable()
export class CatalogResyncSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogResyncSweepService.name);
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogs: CatalogsRepository,
    private readonly sync: CatalogSyncService,
  ) {}

  onModuleInit(): void {
    const every = readCatalogEnv().CAT_RESYNC_INTERVAL_MS;
    this.timer = setInterval(() => void this.run(), every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const s = await this.sweep();
      if (s.catalogs > 0) this.logger.log(s, 'catalog resync sweep');
    } catch (err) {
      this.logger.error({ err }, 'catalog resync sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass over every connected catalog; `orgId` narrows it to one (the `--workspace` of the command). */
  async sweep(opts: { orgId?: number; pollOnly?: boolean } = {}): Promise<ResyncSummary> {
    const orgs = opts.orgId
      ? [opts.orgId]
      : await this.db.privileged((tx) => this.catalogs.orgsWithCatalog(tx));
    const out: ResyncSummary = { catalogs: 0, pushed: 0, synced: 0, failed: 0, errors: 0 };
    for (const orgId of orgs) {
      try {
        const r = await this.sync.resyncOrg(orgId, { pollOnly: opts.pollOnly });
        if (r.skipped) continue;
        out.catalogs++;
        out.pushed += r.pushed;
        out.synced += r.synced;
        out.failed += r.failed;
        if ('error' in r && r.error) {
          out.errors++;
          this.logger.warn({ orgId, error: r.error }, 'resync push failed');
        }
      } catch (err) {
        out.errors++;
        this.logger.warn(
          { orgId, err: err instanceof Error ? err.message : 'failed' },
          'resync failed',
        );
      }
    }
    return out;
  }
}

/**
 * The expired stock-hold sweep (WD-CAT-025): gives back the stock of holds nobody confirmed, so an abandoned cart does not pin
 * units forever. Runs every minute, like WaDesk's heartbeat. Imported by the worker module only.
 */
@Injectable()
export class StockHoldSweepService {
  private readonly logger = new Logger(StockHoldSweepService.name);
  private running = false;

  constructor(private readonly inventory: InventoryService) {}

  @Interval(60_000)
  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const n = await this.inventory.sweepExpired();
      if (n > 0) this.logger.log({ released: n }, 'stock hold sweep');
      return n;
    } catch (err) {
      this.logger.error({ err }, 'stock hold sweep failed');
      return 0;
    } finally {
      this.running = false;
    }
  }
}
