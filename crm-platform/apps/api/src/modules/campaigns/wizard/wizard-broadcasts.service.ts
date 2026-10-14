import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  recurrenceRuleSchema,
  wizardDraftSchema,
  type ListWizardBroadcastsQuery,
  type ListWizardHistoryQuery,
  type WizardHistoryList,
  type WizardBroadcast,
  type WizardBroadcastDetail,
  type WizardBroadcastList,
  type WizardDeleteResponse,
  type WizardControlResponse,
  type WizardDraft,
  type WizardRetryFailedResponse,
  type WizardRetrySummary,
  type WizardRun,
  type CampaignStatus,
} from '@crm/contracts';
import type { Readable } from 'node:stream';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PacingRuntime, WALLET_GATE, type WalletGate } from '../../broadcasts';
import { CampaignEvents } from '../campaign-events';
import { CampaignsActionsService } from '../campaigns-actions.service';
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
    private readonly actions: CampaignsActionsService,
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
        type: query.type ?? null,
        q: query.q ?? null,
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

  /** The rows of the History and Scheduled pages: one per run (a series' runs included), see `WizardRepository.historyPage`. */
  async history(query: ListWizardHistoryQuery): Promise<WizardHistoryList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const { rows, hasMore } = await this.repo.historyPage(tx, orgId, {
        scope: query.scope,
        limit: query.limit,
        cursor: decodeCursor(query.cursor),
        type: query.type ?? null,
        status: query.status ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        tz: query.tz,
        q: query.q ?? null,
      });
      const last = rows[rows.length - 1];
      return {
        data: rows.map((r) => ({
          id: r.uuid,
          source: r.isWizard ? ('wizard' as const) : ('classic' as const),
          type: r.kind,
          name: r.name,
          status: r.status as CampaignStatus,
          templateName: r.templateName,
          senderLabel: r.senderLabel,
          seriesId: r.seriesUuid,
          occurrence: r.occurrenceNo === null ? null : r.occurrenceNo + 1,
          counts: r.counts,
          runAt: r.runAt ? r.runAt.toISOString() : null,
          startedAt: r.startedAt ? r.startedAt.toISOString() : null,
          finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
        })),
        page: {
          nextCursor: hasMore && last ? encodeCursor(last.sortIso, last.uuid) : null,
          hasMore,
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

  /**
   * Retry failed: the failed recipients of a launched broadcast go back in the queue and the run starts again. Only the failed rows
   * are touched, so nobody who got the message is messaged twice. A series retries every run that ended on its own and has failed rows;
   * a run still in progress, or one that was cancelled, is left alone. Each run is its own transaction (the wallet is checked per run), so a refusal on one stops there and
   * the runs already queued stay queued.
   */
  async retryFailed(uuid: string): Promise<WizardRetryFailedResponse> {
    const { orgId } = RequestContextStore.require();
    const targets = await this.db.tx(async (tx) => {
      const series = await this.repo.seriesByUuid(tx, orgId, uuid);
      if (series) {
        const out: Array<{ uuid: string }> = [];
        for (const c of await this.repo.seriesChildren(tx, orgId, series.id)) {
          // A run the person cancelled (or that a cancelled series stopped) stays stopped: only runs that ended on their own retry.
          if (c.status !== 'completed' && c.status !== 'failed') continue;
          if ((await this.repo.runCounts(tx, orgId, c.id)).failed > 0) out.push({ uuid: c.uuid });
        }
        return { kind: 'series' as const, id: series.uuid, seriesStatus: series.status, runs: out };
      }
      const c = await this.repo.campaignByUuid(tx, orgId, uuid);
      if (!c || c.status === 'draft') throw AppError.notFound('Broadcast', uuid);
      return {
        kind: 'campaign' as const,
        id: c.uuid,
        seriesStatus: null,
        runs: [{ uuid: c.uuid }],
      };
    });
    if (targets.runs.length === 0) {
      throw new AppError(
        ERROR_CODES.CAMP_NOTHING_TO_RESEND,
        'Nothing to retry: no finished run has failed recipients.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let recipients = 0;
    let status = 'running';
    for (const run of targets.runs) {
      const res = await this.actions.resend(run.uuid, { scope: 'failed', contactIds: [] });
      recipients += res.recipients;
      status = res.status;
    }
    return {
      id: targets.id,
      kind: targets.kind,
      status: targets.seriesStatus ?? status,
      message: `Retrying ${recipients} failed recipient${recipients === 1 ? '' : 's'}.`,
      recipients,
      runs: targets.runs.length,
    };
  }

  /**
   * The recipients of a launched broadcast as one CSV (streamed): a one-off campaign exactly as its own export, a recurring series as
   * one file with a `Run` column, run by run in order. Same permission as any campaign export.
   */
  async exportBroadcast(uuid: string): Promise<{ stream: Readable; fileName: string }> {
    const { orgId } = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const series = await this.repo.seriesByUuid(tx, orgId, uuid);
      if (series) {
        const runs = (await this.repo.seriesChildren(tx, orgId, series.id))
          .map((c) => ({ id: c.id, run: (c.occurrenceNo ?? 0) + 1 }))
          .sort((a, b) => a.run - b.run);
        return { series, runs };
      }
      const c = await this.repo.campaignByUuid(tx, orgId, uuid);
      if (!c || c.status === 'draft') throw AppError.notFound('Broadcast', uuid);
      return { series: null, runs: [] };
    });
    if (!found.series) return this.actions.export(uuid);
    const zone = recurrenceRuleSchema.parse(found.series.rule).timezone;
    return this.actions.exportRuns(found.runs, zone, `broadcast-${found.series.uuid}`);
  }

  /**
   * Delete a launched broadcast. A one-off campaign goes with its recipients, as a campaign does. A recurring series goes with the runs
   * it had planned, but only while none of them has sent a message: once a run has sent, its history is kept and the series can only be
   * cancelled (409 CAMP_SERIES_HAS_HISTORY). A run that is going right now is never deleted under the worker.
   */
  async removeBroadcast(uuid: string): Promise<WizardDeleteResponse> {
    const { orgId } = RequestContextStore.require();
    const known = await this.db.tx(async (tx) => {
      const series = await this.repo.seriesByUuid(tx, orgId, uuid);
      if (series) return { kind: 'series' as const };
      const c = await this.repo.campaignByUuid(tx, orgId, uuid);
      if (!c || c.status === 'draft') throw AppError.notFound('Broadcast', uuid);
      return { kind: 'campaign' as const };
    });
    if (known.kind === 'campaign') {
      await this.actions.remove(uuid);
      return { id: uuid, kind: 'campaign', runs: 1, message: 'Broadcast deleted.' };
    }
    return this.db.tx(async (tx) => {
      const s0 = await this.repo.seriesByUuid(tx, orgId, uuid);
      if (!s0) throw AppError.notFound('Broadcast', uuid);
      const s = (await this.repo.lockSeries(tx, orgId, s0.id)) ?? s0;
      // The runs' own rows too, so a worker cannot start one between the checks below and the delete.
      await this.repo.lockSeriesRuns(tx, orgId, s.id);
      const children = await this.repo.seriesChildren(tx, orgId, s.id);
      if (children.some((c) => c.status === 'running'))
        throw notControllable('recurring broadcast', 'running');
      if (await this.repo.seriesHasSent(tx, orgId, s.id)) {
        throw new AppError(
          ERROR_CODES.CAMP_SERIES_HAS_HISTORY,
          'This recurring broadcast has already sent messages, so its history is kept. Cancel it to stop it.',
          HttpStatus.CONFLICT,
        );
      }
      for (const c of children) {
        await this.audit.record(tx, { module: 'campaigns', recordId: c.id, action: 'delete' });
        await this.outbox.emit(tx, {
          aggregateModule: 'campaigns',
          aggregateId: c.id,
          eventType: 'campaign.deleted',
          payload: { uuid: c.uuid },
        });
      }
      await this.campaigns.remove(
        tx,
        orgId,
        children.map((c) => c.id),
      );
      await this.repo.deleteSeries(tx, orgId, s.id);
      await this.audit.record(tx, { module: 'camp_series', recordId: s.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: 'campaigns',
        aggregateId: s.id,
        eventType: 'campaign.series_deleted',
        payload: { uuid: s.uuid, name: s.name, runs: children.length },
      });
      return {
        id: s.uuid,
        kind: 'series' as const,
        runs: children.length,
        message: 'Recurring broadcast deleted.',
      };
    });
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
