import { Injectable } from '@nestjs/common';
import type { DealReportsQuery, DealReportsResponse, RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { PipelinesRepository } from '../pipelines/pipelines.repository';
import { monthStart, monthWindow, resolveTimezone, todayIn } from './deal-calendar';
import {
  addTo,
  rateTableOf,
  sortKey,
  totalsOf,
  weightedMinor,
  type CurrencySums,
} from './deal-money';
import { winRatePercent } from './deal-rules';
import { closedBetween, DealReportsRepository, type ReportBase } from './deal-reports.repository';
import { DealsRepository, dealScopeCondition } from './deals.repository';

/** The numbers the board's KPI strip shows, over one pipeline; shared with the board so both read from one place. */
export interface KpiSet {
  openCount: number;
  open: CurrencySums;
  forecast: CurrencySums;
  wonThisMonthCount: number;
  wonThisMonth: CurrencySums;
  wonCount: number;
  lostCount: number;
}

/**
 * Reports (WD-DEAL-005, 019, 020, 040). Everything is computed by grouped SQL and combined here with exact integer arithmetic.
 *
 * Fixed from WaDesk: sums are per currency (and converted only with an explicit target and known rates); the forecast counts
 * OPEN deals only; "won this month" is this month in the workspace's time zone; the pipeline and owner can be chosen;
 * a date window applies to the closed-deal metrics; money never wears a symbol that does not belong to it.
 */
@Injectable()
export class DealReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DealReportsRepository,
    private readonly dealsRepo: DealsRepository,
    private readonly pipelines: PipelinesRepository,
  ) {}

  async reports(query: DealReportsQuery, scope: RecordScope): Promise<DealReportsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = resolveTimezone((await this.dealsRepo.orgSettings(tx, ctx.orgId)).timezone);
      const base: ReportBase = {
        orgId: ctx.orgId,
        scope: dealScopeCondition(ctx.orgId, scope, ctx.userId),
      };
      if (query.pipelineId) {
        const p = await this.pipelines.pipelineByUuid(tx, ctx.orgId, query.pipelineId);
        if (!p) throw AppError.notFound('Pipeline', query.pipelineId);
        base.pipelineId = p.id;
      }
      if (query.ownerId) {
        const id = await this.dealsRepo.resolveUserId(tx, ctx.orgId, query.ownerId);
        if (id === undefined) throw AppError.notFound('User', query.ownerId);
        base.ownerId = id;
      }
      const convertTo = query.convertTo ?? null;
      const rates = convertTo ? rateTableOf(await this.dealsRepo.rates(tx)) : new Map();
      const totals = (sums: CurrencySums) => totalsOf(sums, convertTo, rates);

      const window = {
        won: closedBetween('won_at', tz, query.from, query.to),
        lost: closedBetween('lost_at', tz, query.from, query.to),
      };
      const today = todayIn(tz);
      const monthsAnchor = query.to && query.to < today ? query.to : today;
      const trend = monthWindow(monthsAnchor);

      const stages = await this.pipelines.stagesOf(
        tx,
        ctx.orgId,
        base.pipelineId !== undefined
          ? [base.pipelineId]
          : (await this.pipelines.listPipelines(tx, ctx.orgId)).map((p) => p.id),
      );
      // One connection serves the whole transaction, so these run one after another.
      const openRows = await this.repo.openByStage(tx, base);
      const wonRows = await this.repo.closed(tx, base, 'won', window.won);
      const lostRows = await this.repo.closed(tx, base, 'lost', window.lost);
      const wonMonthRows = await this.repo.closed(
        tx,
        base,
        'won',
        closedBetween('won_at', tz, monthStart(today)),
      );
      const monthRows = await this.repo.byMonth(tx, base, tz, trend.firstDay, trend.endExclusive);
      const leaderRows = await this.repo.leaders(tx, base, window.won);
      const reasonRows = await this.repo.lostReasons(tx, base, window.lost);

      // open: per stage (count, value, weighted) and overall
      const openAll: CurrencySums = new Map();
      const forecastAll: CurrencySums = new Map();
      let openCount = 0;
      const byStage = stages.map((s) => {
        const value: CurrencySums = new Map();
        const weighted: CurrencySums = new Map();
        let count = 0;
        for (const r of openRows.filter((o) => o.stageId === s.id)) {
          count += r.n;
          addTo(value, r.currency, r.total);
          addTo(weighted, r.currency, weightedMinor(r.total, s.probability));
        }
        for (const [c, v] of value) addTo(openAll, c, v);
        for (const [c, v] of weighted) addTo(forecastAll, c, v);
        openCount += count;
        return {
          stageId: s.uuid,
          pipelineId: s.pipelineUuid,
          name: s.name,
          color: s.color,
          kind: s.kind,
          probability: s.probability,
          count,
          value: totals(value),
          weighted: totals(weighted),
        };
      });

      const wonSums: CurrencySums = new Map();
      let wonCount = 0;
      let daysSum = 0;
      for (const r of wonRows) {
        wonCount += r.n;
        daysSum += r.daysSum;
        addTo(wonSums, r.currency, r.total);
      }
      const lostSums: CurrencySums = new Map();
      let lostCount = 0;
      for (const r of lostRows) {
        lostCount += r.n;
        addTo(lostSums, r.currency, r.total);
      }
      const monthSums: CurrencySums = new Map();
      let monthCount = 0;
      for (const r of wonMonthRows) {
        monthCount += r.n;
        addTo(monthSums, r.currency, r.total);
      }

      const months = trend.months.map((m) => {
        const won: CurrencySums = new Map();
        let wonN = 0;
        let lostN = 0;
        for (const r of monthRows.filter((x) => x.month === m)) {
          if (r.kind === 'won') {
            wonN += r.n;
            addTo(won, r.currency, r.total);
          } else {
            lostN += r.n;
          }
        }
        return { month: m, wonCount: wonN, wonValue: totals(won), lostCount: lostN };
      });

      const leaderMap = new Map<string, { name: string; count: number; sums: CurrencySums }>();
      for (const r of leaderRows) {
        const entry = leaderMap.get(r.ownerUuid) ?? {
          name: r.ownerName,
          count: 0,
          sums: new Map(),
        };
        entry.count += r.n;
        addTo(entry.sums, r.currency, r.total);
        leaderMap.set(r.ownerUuid, entry);
      }
      const leaders = [...leaderMap.entries()]
        .map(([id, e]) => ({ id, ...e, key: sortKey(e.sums, convertTo, rates) }))
        .sort((a, b) => (b.key > a.key ? 1 : b.key < a.key ? -1 : b.count - a.count))
        .slice(0, 10)
        .map((e) => ({
          owner: { id: e.id, name: e.name },
          wonCount: e.count,
          value: totals(e.sums),
        }));

      return {
        timezone: tz,
        convertedTo: convertTo,
        open: { count: openCount, value: totals(openAll), forecast: totals(forecastAll) },
        won: {
          count: wonCount,
          value: totals(wonSums),
          thisMonth: { count: monthCount, value: totals(monthSums) },
          avgDaysToClose: wonCount > 0 ? Math.round((daysSum / wonCount) * 10) / 10 : null,
        },
        lost: { count: lostCount, value: totals(lostSums) },
        winRate: winRatePercent(wonCount, lostCount),
        byStage,
        months,
        leaders,
        lostReasons: reasonRows.map((r) => ({ reason: r.reason, count: r.n })),
      };
    });
  }

  /**
   * The board's KPI strip for one pipeline: open count and value, the open-only forecast, won this month and the win rate.
   * Workspace-wide for the pipeline (inside the caller's record scope) and independent of the board's filters.
   */
  async kpis(
    tx: Tx,
    orgId: number,
    pipelineId: number,
    scope: RecordScope,
    actorUserId: number | null,
  ): Promise<KpiSet> {
    const org = await this.dealsRepo.orgSettings(tx, orgId);
    const tz = resolveTimezone(org.timezone);
    const base: ReportBase = {
      orgId,
      pipelineId,
      scope: dealScopeCondition(orgId, scope, actorUserId),
    };
    const stages = await this.pipelines.stagesOf(tx, orgId, [pipelineId]);
    const openRows = await this.repo.openByStage(tx, base);
    const wonRows = await this.repo.closed(tx, base, 'won', []);
    const lostRows = await this.repo.closed(tx, base, 'lost', []);
    const monthRows = await this.repo.closed(
      tx,
      base,
      'won',
      closedBetween('won_at', tz, monthStart(todayIn(tz))),
    );
    const probabilityOf = new Map(stages.map((s) => [s.id, s.probability]));
    const open: CurrencySums = new Map();
    const forecast: CurrencySums = new Map();
    let openCount = 0;
    for (const r of openRows) {
      openCount += r.n;
      addTo(open, r.currency, r.total);
      addTo(forecast, r.currency, weightedMinor(r.total, probabilityOf.get(r.stageId) ?? 0));
    }
    const wonThisMonth: CurrencySums = new Map();
    let wonThisMonthCount = 0;
    for (const r of monthRows) {
      wonThisMonthCount += r.n;
      addTo(wonThisMonth, r.currency, r.total);
    }
    return {
      openCount,
      open,
      forecast,
      wonThisMonthCount,
      wonThisMonth,
      wonCount: wonRows.reduce((a, r) => a + r.n, 0),
      lostCount: lostRows.reduce((a, r) => a + r.n, 0),
    };
  }
}
