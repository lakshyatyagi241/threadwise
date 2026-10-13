import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { GrowthAutomationService } from './growth-automation.service';
import { GrowthGateService } from './growth-gate.service';
import { GrowthRepository } from './growth.repository';
import { GrowthService } from './growth.service';

const ACTION_TTL_DAYS = 30;
const DIGEST_KEEP_DAYS = 90;

/**
 * The pilot's schedule (worker process only). Every job loops over the pilot workspaces that have the part switched on and nothing
 * else (`GrowthGateService.pilotOrgs`), and each step re-checks its own switch. Hourly: the replies campaigns really got, the buying
 * questions nobody answered, the confident stage changes. Daily: the conversion model, the engagement stage rule, the lapsed and
 * service-due scans, the audience groups that already exist, enrichment, and the digest.
 */
@Injectable()
export class GrowthSweeper {
  private readonly logger = new Logger(GrowthSweeper.name);
  private running = { hourly: false, daily: false };

  constructor(
    private readonly db: DatabaseService,
    private readonly gate: GrowthGateService,
    private readonly growth: GrowthService,
    private readonly automation: GrowthAutomationService,
    private readonly repo: GrowthRepository,
  ) {}

  private async forOrg(orgId: number, label: string, fn: () => Promise<unknown>): Promise<void> {
    await RequestContextStore.run(
      {
        requestId: `growth-${label}-${orgId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          await fn();
        } catch (err) {
          this.logger.error({ orgId, label, err }, 'growth job failed');
        }
      },
    );
  }

  @Cron('23 * * * *')
  async hourly(): Promise<void> {
    if (this.running.hourly) return;
    this.running.hourly = true;
    try {
      for (const orgId of await this.gate.pilotOrgs('campaign_response')) {
        await this.forOrg(orgId, 'stamp', () => this.growth.stampResponsesIn(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('unanswered_watch')) {
        await this.forOrg(orgId, 'unanswered', () => this.automation.unansweredScan(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('auto_stage')) {
        await this.forOrg(orgId, 'auto-stage', () => this.automation.autoStage(orgId));
      }
    } finally {
      this.running.hourly = false;
    }
  }

  @Cron('37 2 * * *')
  async daily(): Promise<void> {
    if (this.running.daily) return;
    this.running.daily = true;
    try {
      for (const orgId of await this.gate.pilotOrgs('propensity')) {
        await this.forOrg(orgId, 'propensity', () => this.growth.recomputePropensityIn(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('engagement_stage_rules')) {
        await this.forOrg(orgId, 'stage-rule', () => this.automation.engagementStageRule(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('engagement_audiences')) {
        await this.forOrg(orgId, 'lapsed', () => this.automation.lapsedScan(orgId));
        await this.forOrg(orgId, 'audiences', () => this.growth.syncExistingAudiences(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('service_rules')) {
        await this.forOrg(orgId, 'service', () => this.automation.serviceDueScan(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('enrichment')) {
        await this.forOrg(orgId, 'enrich', () => this.growth.runEnrichment(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('auto_stage')) {
        await this.forOrg(orgId, 'auto-stage', () => this.automation.autoStage(orgId));
      }
      for (const orgId of await this.gate.pilotOrgs('daily_digest')) {
        await this.forOrg(orgId, 'digest', () => this.growth.buildDigest(orgId));
      }
      // Housekeeping touches only the pilot's own tables.
      await this.db.privileged(async (tx) => {
        const expired = await this.repo.expireOldActions(tx, ACTION_TTL_DAYS);
        const digests = await this.repo.deleteOldDigests(tx, DIGEST_KEEP_DAYS);
        if (expired + digests > 0) this.logger.log({ expired, digests }, 'growth housekeeping');
      });
    } finally {
      this.running.daily = false;
    }
  }
}
