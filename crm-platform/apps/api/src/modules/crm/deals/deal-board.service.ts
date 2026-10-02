import { Injectable } from '@nestjs/common';
import {
  type BoardQuery,
  type BoardResponse,
  type BoardStagePageResponse,
  type BoardStageQuery,
  type RecordScope,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { PipelinesRepository } from '../pipelines/pipelines.repository';
import {
  addTo,
  rateTableOf,
  totalsOf,
  weightedMinor,
  type CurrencySums,
  type RateTable,
} from './deal-money';
import { DealReportsService } from './deal-reports.service';
import { winRatePercent } from './deal-rules';
import { toDealResponse } from './deals.mapper';
import {
  DealsRepository,
  dealScopeCondition,
  decodeStageCursor,
  encodeStageCursor,
  type DealRow,
} from './deals.repository';
import { DealsService } from './deals.service';

/**
 * The Kanban board (WD-DEAL-003..007). WaDesk rendered every deal of every stage of the pipeline in one page load, all-time won
 * and lost included, and recomputed totals in the browser. Here each column is its own keyset-paged read (25 cards by default)
 * and its count and totals are SQL aggregates over the filtered set, so a column of 50,000 deals costs what a column of 5 does.
 *
 * Order inside a column is the persisted manual order (`sort_order`, newest first until a card is moved), which is what makes
 * dragging within a column stick. The KPI strip ignores the filters, as in WaDesk, and its forecast counts OPEN deals only.
 */
@Injectable()
export class DealBoardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DealsRepository,
    private readonly pipelines: PipelinesRepository,
    private readonly deals: DealsService,
    private readonly reports: DealReportsService,
  ) {}

  async board(query: BoardQuery, scope: RecordScope): Promise<BoardResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const pipeline = query.pipelineId
        ? await this.pipelines.pipelineByUuid(tx, ctx.orgId, query.pipelineId)
        : await this.pipelines.defaultPipeline(tx, ctx.orgId);
      if (!pipeline) throw AppError.notFound('Pipeline', query.pipelineId);

      const stages = await this.pipelines.stagesOf(tx, ctx.orgId, [pipeline.id]);
      const filter = await this.deals.resolveFilter(tx, ctx.orgId, query);
      const scopeSql = dealScopeCondition(ctx.orgId, scope, ctx.userId);
      const convertTo = query.convertTo ?? null;
      const rates: RateTable = convertTo ? rateTableOf(await this.repo.rates(tx)) : new Map();

      // A filter naming something that is not in the workspace matches nothing: empty columns, not an error.
      const totalsRows = filter
        ? await this.repo.stageTotals(tx, ctx.orgId, {
            pipelineId: pipeline.id,
            filter,
            scope: scopeSql,
          })
        : [];

      const columns = [];
      for (const stage of stages) {
        const sums: CurrencySums = new Map();
        const weighted: CurrencySums = new Map();
        let count = 0;
        for (const r of totalsRows.filter((t) => t.stageId === stage.id)) {
          count += r.count;
          addTo(sums, r.currency, r.sumMinor);
          if (stage.kind === 'open')
            addTo(weighted, r.currency, weightedMinor(r.sumMinor, stage.probability));
        }
        const rows = filter
          ? await this.repo.stagePage(tx, ctx.orgId, {
              stageId: stage.id,
              filter,
              scope: scopeSql,
              limit: query.limit,
            })
          : [];
        const { items, nextCursor } = pageOf(rows, query.limit);
        columns.push({
          stage: {
            id: stage.uuid,
            name: stage.name,
            color: stage.color,
            probability: stage.probability,
            kind: stage.kind,
            sortOrder: stage.sortOrder,
          },
          count,
          total: totalsOf(sums, convertTo, rates),
          weighted: totalsOf(weighted, convertTo, rates),
          deals: items.map(toDealResponse),
          page: { nextCursor, hasMore: nextCursor !== null, limit: query.limit },
        });
      }

      const kpi = await this.reports.kpis(tx, ctx.orgId, pipeline.id, scope, ctx.userId);
      return {
        pipeline: {
          id: pipeline.uuid,
          name: pipeline.name,
          currency: pipeline.currency,
          isDefault: pipeline.isDefault,
        },
        stages: columns,
        kpis: {
          openCount: kpi.openCount,
          openValue: totalsOf(kpi.open, convertTo, rates),
          forecast: totalsOf(kpi.forecast, convertTo, rates),
          wonThisMonthCount: kpi.wonThisMonthCount,
          wonThisMonthValue: totalsOf(kpi.wonThisMonth, convertTo, rates),
          winRate: winRatePercent(kpi.wonCount, kpi.lostCount),
        },
      };
    });
  }

  /** The next page of one column ("load more"), with the same filters the board was loaded with. */
  async stagePage(
    stageUuid: string,
    query: BoardStageQuery,
    scope: RecordScope,
  ): Promise<BoardStagePageResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const stage = await this.pipelines.stageByUuid(tx, ctx.orgId, stageUuid);
      if (!stage) throw AppError.notFound('Stage', stageUuid);
      const filter = await this.deals.resolveFilter(tx, ctx.orgId, query);
      if (!filter)
        return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      if (query.cursor) decodeStageCursor(query.cursor); // 400 on a malformed cursor before any query
      const rows = await this.repo.stagePage(tx, ctx.orgId, {
        stageId: stage.id,
        filter,
        scope: dealScopeCondition(ctx.orgId, scope, ctx.userId),
        cursor: query.cursor,
        limit: query.limit,
      });
      const { items, nextCursor } = pageOf(rows, query.limit);
      return {
        data: items.map(toDealResponse),
        page: { nextCursor, hasMore: nextCursor !== null, limit: query.limit },
      };
    });
  }
}

function pageOf(rows: DealRow[], limit: number): { items: DealRow[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeStageCursor(last.sortOrder, last.id) : null };
}
