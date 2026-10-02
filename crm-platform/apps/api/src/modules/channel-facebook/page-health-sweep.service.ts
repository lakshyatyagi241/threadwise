import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { PagesRepository } from './pages.repository';
import { PagesService } from './pages.service';

/**
 * Hourly token health of every connected Page (TW-FB-005). Reference ran this inline, once an hour per workspace, when the Channels page
 * loaded; with no page load to hang it on, a worker does it for every organization that has a Page. Registered only in the worker
 * process. One organization failing never stops the others.
 */
@Injectable()
export class PageHealthSweepService {
  private readonly logger = new Logger(PageHealthSweepService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PagesRepository,
    private readonly pages: PagesService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<number> {
    const orgs = await this.db.privileged((tx) => this.repo.orgsWithPagesToCheck(tx));
    let checked = 0;
    for (const orgId of orgs) {
      try {
        checked += await this.pages.checkHealth(orgId);
      } catch (err) {
        this.logger.error({ err, orgId }, 'facebook page health check failed');
      }
    }
    return checked;
  }
}
