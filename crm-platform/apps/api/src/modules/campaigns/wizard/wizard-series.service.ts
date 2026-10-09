import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  firstDueFrom,
  occurrenceAt,
  recurrenceRuleSchema,
  wizardDraftSchema,
  type RecurrenceRule,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { PacingRuntime } from '../../broadcasts';
import { asSystem } from '../campaign-events';
import { CampaignJobs } from '../campaign-jobs';
import { CampaignsRepository } from '../campaigns.repository';
import { blankCampaignFor, campaignColumnsOf } from './wizard-blank';
import { WizardRunService } from './wizard-run.service';
import { WizardRepository, type SeriesRow } from './wizard.repository';

/** Most series planned in one pass. */
const MAX_PER_PASS = 25;
/**
 * A run that is this much past its time when the planner finds it is not sent: a long outage must not turn a daily broadcast into
 * five messages in a minute. It is stepped over (counted as skipped), and the series goes on from the next occurrence.
 */
export const MISFIRE_GRACE_MS = 6 * 3_600_000;

/** Why a run could not be made, kept on the failed run so the person sees it. */
const REFUSALS = new Set<string>([
  ERROR_CODES.WALLET_EMPTY,
  ERROR_CODES.CAMP_NO_RECIPIENTS,
  ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
  ERROR_CODES.VALIDATION_FAILED,
]);

/**
 * Plans the runs of recurring broadcasts, in the worker. A series holds the rule and the blueprint; the planner creates the child
 * campaign whose time has come, resolving the audience as it is NOW, and moves the series to the next occurrence of the rule (or ends
 * it when the rule has ended). Idempotent: the series row is locked while it is planned and a (series, occurrence) pair is unique, so a
 * second worker, a retried job or a repeated tick cannot make a run twice.
 */
@Injectable()
export class WizardSeriesService {
  private readonly logger = new Logger(WizardSeriesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly campaigns: CampaignsRepository,
    private readonly runs: WizardRunService,
    private readonly jobs: CampaignJobs,
    private readonly runtime: PacingRuntime,
  ) {}

  /** One pass over every tenant's due series. Returns how many runs were created. Public for tests and the worker's interval. */
  async tick(): Promise<number> {
    const due = await this.db.privileged((tx) =>
      this.repo.dueSeries(tx, this.runtime.now(), MAX_PER_PASS),
    );
    let created = 0;
    for (const s of due) {
      try {
        if (await this.planOne(s.orgId, s.id)) created++;
      } catch (err) {
        this.logger.error({ series: s.id, err }, '[CAMP] planning a recurring broadcast failed');
      }
    }
    return created;
  }

  /** Plans one series. True when a run was created. */
  async planOne(orgId: number, seriesId: number): Promise<boolean> {
    const now = this.runtime.now();
    // The worker has no request: the audit and the outbox take their tenant from the context, so the plan runs as the system for it.
    const made = await asSystem(orgId, () =>
      this.db.txAs({ orgId }, async (tx) => {
        const s = await this.repo.lockSeries(tx, orgId, seriesId);
        if (!s || s.status !== 'active' || !s.nextRunAt || s.nextRunAt.getTime() > now.getTime()) {
          return null;
        }
        const rule = recurrenceRuleSchema.parse(s.rule);
        const { next, skipped } = firstDueFrom(
          rule,
          s.nextIndex,
          new Date(now.getTime() - MISFIRE_GRACE_MS),
        );
        if (!next) {
          // Every remaining occurrence was stale and the rule has ended.
          await this.repo.planSeries(tx, orgId, s.id, {
            nextIndex: s.nextIndex + skipped,
            nextRunAt: null,
            created: 0,
            skipped,
            lastOccurrenceAt: null,
            status: 'ended',
          });
          return null;
        }
        if (next.at.getTime() > now.getTime()) {
          // The stale ones are stepped over; the next is still ahead.
          await this.repo.planSeries(tx, orgId, s.id, {
            nextIndex: next.index,
            nextRunAt: next.at,
            created: 0,
            skipped,
            lastOccurrenceAt: null,
          });
          return null;
        }

        const run = await this.makeRun(tx, orgId, s, rule, next.index, next.at);
        const after = occurrenceAt(rule, next.index + 1);
        await this.repo.planSeries(tx, orgId, s.id, {
          nextIndex: next.index + 1,
          nextRunAt: after ? after.at : null,
          created: 1,
          skipped,
          lastOccurrenceAt: next.at,
          ...(after ? {} : { status: 'ended' }),
        });
        return run;
      }),
    );
    // After the commit: a job must never run before the status it needs is visible.
    if (made?.enqueue) await this.jobs.enqueue(orgId, made.id, made.uuid);
    return made !== null;
  }

  /** The child campaign of one occurrence: running, or failed with the reason when it could not be made (the series goes on). */
  private async makeRun(
    tx: Tx,
    orgId: number,
    s: SeriesRow,
    rule: RecurrenceRule,
    index: number,
    at: Date,
  ): Promise<{ id: number; uuid: string; enqueue: boolean }> {
    const draft = wizardDraftSchema.parse(s.blueprint);
    const name = `${s.name} #${index + 1}`;
    const date = at.toISOString();
    const zoneDate = rule.timeOfDay;
    const occurrenceDate = require_date(rule, index);
    const template = draft.templateId
      ? await this.repo.templateByUuid(tx, orgId, draft.templateId)
      : undefined;
    const common = {
      draft,
      name,
      existingId: null,
      series: { id: s.id, occurrenceNo: index },
      createdBy: s.createdBy,
      runAt: at,
      launch: { mode: 'recurring', occurrence: index + 1, plannedFor: date },
    };
    if (template) {
      try {
        // A nested transaction scope: a refusal rolls back only what the attempt wrote, and the series carries on.
        const made = await tx.transaction((sp) =>
          this.runs.createRun(sp, orgId, {
            ...common,
            template,
            status: 'running',
            scheduleType: 'scheduled',
            sendDate: occurrenceDate,
            sendTime: zoneDate,
            timezone: rule.timezone,
          }),
        );
        return { id: made.id, uuid: made.uuid, enqueue: true };
      } catch (err) {
        if (!(err instanceof AppError) || !REFUSALS.has(err.code)) throw err;
        return this.failedRun(tx, orgId, s, common, index, rule, err.code);
      }
    }
    return this.failedRun(tx, orgId, s, common, index, rule, 'template_missing');
  }

  private async failedRun(
    tx: Tx,
    orgId: number,
    s: SeriesRow,
    common: {
      draft: ReturnType<typeof wizardDraftSchema.parse>;
      name: string;
      runAt: Date;
      launch: Record<string, unknown>;
      createdBy: number | null;
    },
    index: number,
    rule: RecurrenceRule,
    reason: string,
  ): Promise<{ id: number; uuid: string; enqueue: boolean }> {
    const id = await this.campaigns.insert(
      tx,
      orgId,
      blankCampaignFor({
        name: common.name,
        provider: s.provider,
        deviceId: s.deviceId,
        templateId: s.templateId,
        createdBy: common.createdBy,
      }),
    );
    await this.repo.setLaunch(tx, orgId, id, {
      wizard: { draft: common.draft, launch: { ...common.launch, error: reason, recipients: 0 } },
      provider: s.provider,
      deviceId: s.deviceId,
      scheduleType: 'scheduled',
      sendDate: require_date(rule, index),
      sendTime: rule.timeOfDay,
      timezone: rule.timezone,
      status: 'failed',
      total: 0,
      runAt: common.runAt,
      seriesId: s.id,
      occurrenceNo: index,
      retryEnabled: false,
      retryUntil: null,
      options: campaignColumnsOf(common.draft, null),
    });
    const row = await this.campaigns.findById(tx, orgId, id);
    this.logger.warn(
      { series: s.uuid, occurrence: index + 1, reason },
      '[CAMP] a recurring run could not be made',
    );
    return { id, uuid: row!.uuid, enqueue: false };
  }
}

function require_date(rule: RecurrenceRule, index: number): string {
  const o = occurrenceAt(rule, index);
  if (!o) throw new Error('occurrence beyond the rule');
  return o.date;
}
