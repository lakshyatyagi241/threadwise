import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  recurrenceRuleSchema,
  wizardDraftSchema,
  type ListWizardBroadcastsQuery,
  type WizardBroadcast,
  type WizardBroadcastDetail,
  type WizardBroadcastList,
  type WizardControlResponse,
  type WizardDraft,
  type WizardRetrySummary,
  type WizardRun,
  type CampaignStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PacingRuntime, WALLET_GATE, type WalletGate } from '../../broadcasts';
import { CampaignEvents } from '../campaign-events';
import { CampaignJobs } from '../campaign-jobs';
import { CampaignsRepository } from '../campaigns.repository';
import { draftOf } from './wizard-drafts.service';
import { WizardRepository, type SeriesRow, type WizardCampaignRow } from './wizard.repository';

const notControllable = (what: string, status: string) =>
  new AppError(
    ERROR_CODES.CAMP_BROADCAST_NOT_CONTROLLABLE,
    `A ${what} that is ${status} cannot be changed that way.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

const encodeCursor = (at: string, uuid: string) =>
  Buffer.from(`${at}|${uuid}`).toString('base64url');
function decodeCursor(raw: string | undefined): { at: string; uuid: string } | null {
  if (!raw) return null;
  const [at, uuid] = Buffer.from(raw, 'base64url').toString().split('|');
  return at && uuid ? { at, uuid } : null;
}

/** The list, the detail and the controls (pause, resume, cancel) of the broadcasts the wizard launched: one-off campaigns and series. */
@Injectable()
export class WizardBroadcastsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly campaigns: CampaignsRepository,
    private readonly events: CampaignEvents,
    private readonly jobs: CampaignJobs,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly runtime: PacingRuntime,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
  ) {}

  // ------------------------------------------------------------------------------------------ reads

  async list(query: ListWizardBroadcastsQuery): Promise<WizardBroadcastList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.listPage(tx, orgId, {
        limit: query.limit,
        cursor: decodeCursor(query.cursor),
        status: query.status ?? null,
      });
      const page = rows.slice(0, query.limit);
      const data: WizardBroadcast[] = [];
      for (const r of page) {
        const b = await this.load(tx, orgId, r.kind, r.uuid);
        if (b) data.push(b);
      }
      const last = page[page.length - 1];
      return {
        data,
        page: {
          nextCursor:
            rows.length > query.limit && last ? encodeCursor(last.createdAtIso, last.uuid) : null,
          hasMore: rows.length > query.limit,
          limit: query.limit,
        },
      };
    });
  }

  async get(uuid: string): Promise<WizardBroadcastDetail> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const series = await this.repo.seriesByUuid(tx, orgId, uuid);
      if (series) {
        const children = await this.repo.seriesChildren(tx, orgId, series.id);
        return {
          ...(await this.seriesView(tx, orgId, series, children)),
          draft: wizardDraftSchema.parse(series.blueprint),
          runList: await Promise.all(children.map((c) => this.runView(tx, orgId, c))),
        };
      }
      const c = await this.repo.campaignByUuid(tx, orgId, uuid);
      if (!c || c.status === 'draft') throw AppError.notFound('Broadcast', uuid);
      return {
        ...(await this.campaignView(tx, orgId, c)),
        draft: draftOf(c),
        runList: [await this.runView(tx, orgId, c)],
      };
    });
  }

  private async load(
    tx: Tx,
    orgId: number,
    kind: 'campaign' | 'series',
    uuid: string,
  ): Promise<WizardBroadcast | null> {
    if (kind === 'series') {
      const s = await this.repo.seriesByUuid(tx, orgId, uuid);
      return s
        ? this.seriesView(tx, orgId, s, await this.repo.seriesChildren(tx, orgId, s.id))
        : null;
    }
    const c = await this.repo.campaignByUuid(tx, orgId, uuid);
    return c && c.status !== 'draft' ? this.campaignView(tx, orgId, c) : null;
  }

  private retries(
    draft: WizardDraft,
    totals: Awaited<ReturnType<WizardRepository['retryTotals']>>,
  ): WizardRetrySummary {
    return {
      enabled: draft.retries.enabled,
      endDate: draft.retries.enabled ? (draft.retries.endDate ?? null) : null,
      pending: totals.pending,
      nextRetryAt: totals.nextRetryAt ? totals.nextRetryAt.toISOString() : null,
      recovered: totals.recovered,
      exhausted: totals.exhausted,
    };
  }

  private async runView(tx: Tx, orgId: number, c: WizardCampaignRow): Promise<WizardRun> {
    const draft = draftOf(c);
    return {
      id: c.uuid,
      occurrence: (c.occurrenceNo ?? 0) + 1,
      runAt: c.runAt ? c.runAt.toISOString() : null,
      status: c.status as CampaignStatus,
      counts: await this.repo.runCounts(tx, orgId, c.id),
      retries: this.retries(draft, await this.repo.retryTotals(tx, orgId, [c.id])),
    };
  }

  private async campaignView(
    tx: Tx,
    orgId: number,
    c: WizardCampaignRow,
  ): Promise<WizardBroadcast> {
    const draft = draftOf(c);
    return {
      id: c.uuid,
      kind: 'campaign',
      name: c.name,
      status: c.status,
      mode: draft.schedule.mode,
      templateId: c.templateUuid,
      templateName: c.templateName,
      nextRunAt: c.status === 'scheduled' && c.runAt ? c.runAt.toISOString() : null,
      lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
      runs: c.status === 'scheduled' || c.status === 'paused' ? 0 : 1,
      recipients: c.totalRecipients,
      retries: this.retries(draft, await this.repo.retryTotals(tx, orgId, [c.id])),
      schedule: draft.schedule,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      rowVersion: c.rowVersion,
    };
  }

  private async seriesView(
    tx: Tx,
    orgId: number,
    s: SeriesRow,
    children: WizardCampaignRow[],
  ): Promise<WizardBroadcast> {
    const draft = wizardDraftSchema.parse(s.blueprint);
    const rule = recurrenceRuleSchema.parse(s.rule);
    return {
      id: s.uuid,
      kind: 'series',
      name: s.name,
      status: s.status,
      mode: 'recurring',
      templateId: s.templateUuid,
      templateName: s.templateName,
      nextRunAt: s.status === 'active' && s.nextRunAt ? s.nextRunAt.toISOString() : null,
      lastRunAt: s.lastOccurrenceAt ? s.lastOccurrenceAt.toISOString() : null,
      runs: s.occurrencesCreated,
      recipients: children.reduce((n, c) => n + c.totalRecipients, 0),
      retries: this.retries(
        draft,
        await this.repo.retryTotals(
          tx,
          orgId,
          children.map((c) => c.id),
        ),
      ),
      schedule: { mode: 'recurring', rule },
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      rowVersion: s.rowVersion,
    };
  }

  // ------------------------------------------------------------------------------------------ controls

  async pause(uuid: string): Promise<WizardControlResponse> {
    return this.control(uuid, 'pause');
  }
  async resume(uuid: string): Promise<WizardControlResponse> {
    return this.control(uuid, 'resume');
  }
  async cancel(uuid: string): Promise<WizardControlResponse> {
    return this.control(uuid, 'cancel');
  }

  private async control(
    uuid: string,
    action: 'pause' | 'resume' | 'cancel',
  ): Promise<WizardControlResponse> {
    const { orgId } = RequestContextStore.require();
    const after: { enqueue?: { id: number; uuid: string } } = {};
    const out = await this.db.tx(async (tx) => {
      const series = await this.repo.seriesByUuid(tx, orgId, uuid);
      if (series) return this.controlSeries(tx, orgId, series, action);
      const c = await this.repo.lockCampaign(tx, orgId, uuid);
      if (!c || c.status === 'draft') throw AppError.notFound('Broadcast', uuid);
      const res = await this.controlCampaign(tx, orgId, c, action);
      if (res.resumedRunning) after.enqueue = { id: c.id, uuid: c.uuid };
      return res.out;
    });
    if (after.enqueue) await this.jobs.enqueue(orgId, after.enqueue.id, after.enqueue.uuid);
    return out;
  }

  private async controlSeries(
    tx: Tx,
    orgId: number,
    s0: SeriesRow,
    action: 'pause' | 'resume' | 'cancel',
  ): Promise<WizardControlResponse> {
    const s = (await this.repo.lockSeries(tx, orgId, s0.id)) ?? s0;
    const allowed: Record<typeof action, string[]> = {
      pause: ['active'],
      resume: ['paused'],
      cancel: ['active', 'paused'],
    };
    if (!allowed[action].includes(s.status)) throw notControllable('recurring broadcast', s.status);
    const next = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
    await this.repo.setSeriesStatus(tx, orgId, s.id, next);
    if (action === 'cancel') {
      // A cancelled series stops what it started too: its running and waiting runs end.
      for (const c of await this.repo.seriesChildren(tx, orgId, s.id)) {
        if (['running', 'scheduled', 'paused'].includes(c.status)) {
          await this.campaigns.setStatus(tx, orgId, c.id, 'cancelled');
          await this.events.statusChanged(tx, orgId, c.id, c.status);
        }
      }
    }
    await this.audit.record(tx, {
      module: 'camp_series',
      recordId: s.id,
      action: 'update',
      delta: { status: { old: s.status, new: next } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'campaigns',
      aggregateId: s.id,
      eventType: 'campaign.series_status_changed',
      payload: { uuid: s.uuid, previous: s.status, status: next },
    });
    return {
      id: s.uuid,
      kind: 'series',
      status: next,
      message: {
        pause: 'Recurring broadcast paused.',
        resume: 'Recurring broadcast resumed.',
        cancel: 'Recurring broadcast cancelled.',
      }[action],
    };
  }

  private async controlCampaign(
    tx: Tx,
    orgId: number,
    c: WizardCampaignRow,
    action: 'pause' | 'resume' | 'cancel',
  ): Promise<{ out: WizardControlResponse; resumedRunning: boolean }> {
    const allowed: Record<typeof action, string[]> = {
      pause: ['scheduled', 'running'],
      resume: ['paused'],
      cancel: ['scheduled', 'running', 'paused'],
    };
    if (!allowed[action].includes(c.status)) throw notControllable('broadcast', c.status);

    let next: CampaignStatus;
    let running = false;
    if (action === 'pause') next = 'paused';
    else if (action === 'cancel') next = 'cancelled';
    else {
      const draft = draftOf(c);
      const stillAhead =
        draft.schedule.mode === 'scheduled' &&
        c.runAt &&
        c.runAt.getTime() > this.runtime.now().getTime();
      if (!stillAhead) {
        // It starts again: the wallet must cover what is left, as it must for any run (TW-WALLET-013).
        const counts = await this.repo.runCounts(tx, orgId, c.id);
        await this.wallet.precheck(orgId, Math.max(0, c.totalRecipients - counts.sent), {
          source: 'campaign',
        });
      }
      next = stillAhead ? 'scheduled' : 'running';
      running = next === 'running';
    }
    await this.campaigns.setStatus(tx, orgId, c.id, next, running ? { reopen: true } : {});
    await this.audit.record(tx, {
      module: 'campaigns',
      recordId: c.id,
      action: 'update',
      delta: { status: { old: c.status, new: next } },
    });
    await this.events.statusChanged(tx, orgId, c.id, c.status);
    return {
      out: {
        id: c.uuid,
        kind: 'campaign',
        status: next,
        message: {
          pause: 'Broadcast paused.',
          resume: 'Broadcast resumed.',
          cancel: 'Broadcast cancelled.',
        }[action],
      },
      resumedRunning: running,
    };
  }
}
