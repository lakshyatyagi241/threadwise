import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ERROR_CODES, type MarketSyncResult } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { InstallationsRepository } from './installations.repository';
import { readRecipe } from './marketplace.mapper';
import { PullStateRepository } from './pull-state.repository';
import type { PullJob } from './pull.worker';

const AUDIT_MODULE = 'marketplace';

/**
 * "Sync now" for a pull connection: the next poll is brought forward, never faster than the portal allows (IndiaMART: one request every
 * five minutes, a key blocked for fifteen if it goes past five a minute), and a connection that had stopped on an error (the portal
 * refused the key, or it failed too many times) is started again. The poll itself runs in the worker, like every other; this only moves
 * the schedule and, when it can run at once, queues the job so the answer does not wait for the next sweep.
 *
 * `PullRunService` keeps the portal's minimum interval again before it makes the request, so two clicks, or a click racing the sweep, can
 * never put two requests inside the portal's limit.
 */
@Injectable()
export class PullSyncService {
  private readonly logger = new Logger(PullSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InstallationsRepository,
    private readonly state: PullStateRepository,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.MKT_PULL) private readonly queue: Queue<PullJob>,
  ) {}

  async syncNow(uuid: string): Promise<MarketSyncResult> {
    const ctx = RequestContextStore.require();
    const out = await this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, uuid, true);
      if (!row)
        throw new AppError(
          ERROR_CODES.MKT_NOT_INSTALLED,
          'This app is not installed in your workspace.',
          HttpStatus.NOT_FOUND,
        );
      if (row.status === 'killed' || row.app.status === 'killed')
        throw new AppError(
          ERROR_CODES.MKT_INSTALLATION_KILLED,
          'This app has been switched off by the platform. It can only be uninstalled.',
          HttpStatus.CONFLICT,
        );
      const recipe = readRecipe(row.recipe);
      if (!recipe || recipe.connector.type !== 'pull' || !row.connection)
        throw new AppError(
          ERROR_CODES.MKT_NO_CONNECTION,
          'This installation has nothing to sync: its leads arrive by themselves.',
          HttpStatus.CONFLICT,
        );
      if (row.status !== 'active' || row.connection.status === 'paused')
        throw new AppError(
          ERROR_CODES.MKT_INSTALLATION_DISABLED,
          'The installation is paused. Switch it on to sync.',
          HttpStatus.CONFLICT,
        );
      const min = recipe.connector.limits.minIntervalSeconds;
      const runAt = await this.state.requestSync(tx, ctx.orgId, row.connection.id, min);
      await this.audit.record(tx, {
        module: AUDIT_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { changed: { old: null, new: ['sync-requested'] } },
      });
      return { runAt, min, connectionId: row.connection.id };
    });
    // Due now: queue the poll instead of waiting for the sweep. A failure here is harmless, the sweep finds the connection within 30 seconds.
    if (out.runAt.getTime() <= Date.now() + 1000) {
      try {
        const job: PullJob = { orgId: ctx.orgId, connectionId: out.connectionId };
        await this.queue.add('pull', job, {
          jobId: `mkt-pull-${out.connectionId}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        });
      } catch (err) {
        this.logger.warn({ err }, 'sync-now poll not queued; the sweep will take it');
      }
    }
    return { status: 'scheduled', runAt: out.runAt.toISOString(), minIntervalSeconds: out.min };
  }
}
