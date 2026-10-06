import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  firstRunInstant,
  occurrenceAt,
  recurrenceRuleSchema,
  wizardLaunchIssues,
  type WizardLaunchRequest,
  type WizardLaunchResult,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PacingRuntime } from '../../broadcasts';
import { CampaignJobs } from '../campaign-jobs';
import { CampaignsService } from '../campaigns.service';
import { WizardDraftsService, draftOf } from './wizard-drafts.service';
import { WizardRunService } from './wizard-run.service';
import { templateSlots } from './wizard-rules';
import { WizardRepository } from './wizard.repository';

const MESSAGE = {
  now: 'Broadcast launched.',
  scheduled: 'Broadcast scheduled.',
  recurring: 'Recurring broadcast started.',
} as const;

/**
 * Launching the wizard's draft (step 4): every step is checked again on the server (the web's checks are a courtesy), the template and
 * the sender are gated like a classic campaign, the wallet must cover it, and then, in ONE transaction, the draft becomes a running
 * campaign ("now"), a scheduled one, or the series of a recurring broadcast. The run is queued after the commit.
 */
@Injectable()
export class WizardLaunchService {
  private readonly logger = new Logger(WizardLaunchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly drafts: WizardDraftsService,
    private readonly runs: WizardRunService,
    private readonly campaigns: CampaignsService,
    private readonly jobs: CampaignJobs,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly runtime: PacingRuntime,
  ) {}

  async launch(uuid: string, input: WizardLaunchRequest): Promise<WizardLaunchResult> {
    const ctx = RequestContextStore.require();
    const { orgId } = ctx;
    const now = this.runtime.now();

    const out = await this.db.tx(async (tx) => {
      const row = await this.repo.lockCampaign(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Broadcast draft', uuid);
      if (row.status !== 'draft') {
        throw new AppError(
          ERROR_CODES.CAMP_WIZARD_LAUNCHED,
          'This broadcast was already launched.',
          HttpStatus.CONFLICT,
        );
      }
      if (row.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Broadcast draft');

      const draft = draftOf(row);
      const template = draft.templateId
        ? await this.repo.templateByUuid(tx, orgId, draft.templateId)
        : undefined;
      const slots = template
        ? templateSlots({
            templateBody: template.body,
            header: template.header,
            variableMap: template.variableMap,
            buttons: template.buttons,
          }).map((s) => s.slot)
        : [];
      const issues = wizardLaunchIssues(draft, { slots, now });
      if (
        template === undefined &&
        draft.templateId &&
        !issues.some((i) => i.code === 'template_required')
      ) {
        issues.push({ path: 'templateId', code: 'template_required' });
      }
      if (issues.length > 0 || !template) {
        throw new AppError(
          ERROR_CODES.CAMP_WIZARD_INCOMPLETE,
          'The broadcast is not complete.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          issues.map((i) => ({ path: i.path, message: i.code })),
        );
      }

      // The classic gates: an approved, sendable template, and groups and segments that exist in this workspace.
      const via = await this.runs.sender(tx, orgId, template);
      await this.campaigns.assertTemplateUsable(tx, orgId, template.uuid, via.provider);
      await this.drafts.assertSources(tx, orgId, draft.audience);

      const schedule = draft.schedule;
      const base = {
        draft,
        template,
        name: draft.name.trim(),
        series: null,
        createdBy: ctx.userId,
        launch: { mode: schedule.mode, launchedAt: now.toISOString() },
      };

      if (schedule.mode === 'recurring') {
        const rule = recurrenceRuleSchema.parse(schedule.rule);
        const first = occurrenceAt(rule, 0);
        if (!first) {
          throw new AppError(
            ERROR_CODES.CAMP_WIZARD_INCOMPLETE,
            'The recurrence has no run.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'schedule.rule', message: 'recurrence_invalid' }],
          );
        }
        const { sender, count } = await this.runs.preflight(tx, orgId, draft, template);
        const seriesId = await this.repo.insertSeries(tx, orgId, {
          name: draft.name.trim(),
          rule,
          blueprint: draft,
          templateId: template.id,
          provider: sender.provider,
          deviceId: sender.deviceId,
          nextRunAt: first.at,
          createdBy: ctx.userId,
        });
        const series = await this.repo.seriesById(tx, orgId, seriesId);
        await this.repo.deleteCampaignOnly(tx, orgId, row.id);
        await this.audit.record(tx, {
          module: 'camp_series',
          recordId: seriesId,
          action: 'insert',
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'campaigns',
          aggregateId: seriesId,
          eventType: 'campaign.series_created',
          payload: {
            uuid: series!.uuid,
            name: draft.name.trim(),
            nextRunAt: first.at.toISOString(),
          },
        });
        return {
          result: {
            mode: 'recurring',
            id: series!.uuid,
            kind: 'series',
            status: 'active',
            firstRunAt: first.at.toISOString(),
            recipients: count.recipients,
            message: MESSAGE.recurring,
          } satisfies WizardLaunchResult,
          enqueue: null,
        };
      }

      const runAt = schedule.mode === 'scheduled' ? firstRunInstant(schedule) : null;
      const made = await this.runs.createRun(tx, orgId, {
        ...base,
        existingId: row.id,
        status: schedule.mode === 'now' ? 'running' : 'scheduled',
        scheduleType: schedule.mode === 'now' ? 'now' : 'scheduled',
        sendDate: schedule.mode === 'scheduled' ? schedule.date : null,
        sendTime: schedule.mode === 'scheduled' ? schedule.time : null,
        timezone:
          schedule.mode === 'scheduled' ? schedule.timezone : (draft.retries.timezone ?? 'UTC'),
        runAt,
      });
      return {
        result: {
          mode: schedule.mode,
          id: uuid,
          kind: 'campaign',
          status: schedule.mode === 'now' ? 'running' : 'scheduled',
          firstRunAt: runAt ? runAt.toISOString() : null,
          recipients: made.recipients,
          message: MESSAGE[schedule.mode],
        } satisfies WizardLaunchResult,
        enqueue: schedule.mode === 'now' ? { id: made.id, uuid: made.uuid } : null,
      };
    });

    // After the commit, so a job never runs before the status it needs is visible.
    if (out.enqueue) await this.jobs.enqueue(orgId, out.enqueue.id, out.enqueue.uuid);
    this.logger.log(
      { orgId, broadcast: out.result.id, mode: out.result.mode },
      'wizard broadcast launched',
    );
    return out.result;
  }
}
