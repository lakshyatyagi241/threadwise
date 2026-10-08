import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  PinnacleError,
  PinnaclePartnerClient,
} from '../../infra/providers/whatsapp-cloud-api-waba/pinnacle-partner.client';
import { WabaRegistryRoutes } from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { QUEUES } from '../../infra/queue/queues';
import { pinnacleRouteOf, type PinnacleCreditLineJob } from './pinnacle-onboarding.service';
import { WabaConnectionsRepository } from './waba-connections.repository';

/** Shares the Meta credit line with a Pinnacle client's WABA, a few minutes after onboarding. Worker process only (WabaWorkerModule). */
@Processor(QUEUES.PINNACLE_CREDIT_LINE, { concurrency: 4 })
export class PinnacleCreditLineProcessor extends WorkerHost {
  private readonly logger = new Logger(PinnacleCreditLineProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WabaConnectionsRepository,
    private readonly routes: WabaRegistryRoutes,
    private readonly pinnacle: PinnaclePartnerClient,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {
    super();
  }

  async process(job: Job<PinnacleCreditLineJob>): Promise<{ shared: boolean }> {
    const { orgId, rowId, providerKey, wabaId, businessId } = job.data;
    const registry = this.routes.get(providerKey);
    const route = registry ? pinnacleRouteOf(registry, this.env.PINNACLE_PARTNER_API_URL) : null;
    if (!route) {
      // The provider is gone or lost its partner key: retrying cannot help until an operator fixes it.
      await this.record(orgId, rowId, { credit_line_error: 'Pinnacle provider is not available' });
      throw new UnrecoverableError('pinnacle provider unavailable');
    }
    try {
      await this.pinnacle.shareCreditLine(route, { businessId, wabaId });
    } catch (e) {
      if (e instanceof PinnacleError) {
        if (!e.transient) {
          await this.record(orgId, rowId, { credit_line_error: e.message });
          throw new UnrecoverableError(e.message);
        }
        this.logger.warn(
          { wabaId, attempt: job.attemptsMade + 1 },
          'pinnacle credit-line share will retry',
        );
      }
      throw e;
    }
    await this.record(orgId, rowId, {
      credit_line_assigned: true,
      credit_line_error: null,
      credit_line_at: new Date().toISOString(),
    });
    return { shared: true };
  }

  private async record(
    orgId: number,
    rowId: number,
    metaPatch: Record<string, unknown>,
  ): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.update(tx, orgId, rowId, { metaPatch }),
    );
  }
}
