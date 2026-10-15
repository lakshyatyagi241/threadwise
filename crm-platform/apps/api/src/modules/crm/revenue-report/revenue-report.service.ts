import { Injectable } from '@nestjs/common';
import {
  minorToMajor,
  REVENUE_ROW_LIMIT,
  type DealTotals,
  type RecordScope,
  type RevenueGroup,
  type RevenueMetrics,
  type RevenueReportQuery,
  type RevenueReportResponse,
  type RevenueRow,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { bucketFor, bucketStarts } from '../crm-dashboard/crm-dashboard-rules';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import {
  addTo,
  convertMinor,
  rateTableOf,
  totalsOf,
  type CurrencySums,
  type RateTable,
} from '../deals/deal-money';
import { DealsRepository } from '../deals/deals.repository';
import { invoiceScopeCondition } from '../invoicing/invoices.repository';
import { PaymentsRepository, paymentScopeCondition } from '../invoicing/payments.repository';
import {
  compareRows,
  resolveRevenuePeriod,
  revenuePeriodOf,
  type FrozenPeriod,
  type RevenuePeriod,
} from './revenue-report-rules';
import {
  RevenueReportRepository,
  type CashRow,
  type CohortRow,
  type RevenueFilter,
  type RevenueScopes,
} from './revenue-report.repository';

/** Who is asking and for what. The HTTP request and the export worker both reach `build` through this. */
export interface RevenueBuildInput {
  orgId: number;
  userId: number | null;
  /** The record scope of the caller's `record.payments.read` grant. */
  scope: RecordScope;
  query: RevenueReportQuery;
  /** A zone fixed when the report was asked for (an export); else the viewer's own. */
  timezone?: string;
  /** The dates an export fixed when it was asked for; the query's range and comparison are then not read. */
  frozen?: FrozenPeriod;
  now?: Date;
}

export interface RevenueResolved {
  filter: RevenueFilter;
  scopes: RevenueScopes;
  tz: string;
  period: RevenuePeriod;
}

const METRICS = [
  'invoiced',
  'credited',
  'paid',
  'outstanding',
  'overdue',
  'collected',
  'refunded',
] as const;
type Metric = (typeof METRICS)[number];
type Win = 'cur' | 'prev';

type MetricSums = Record<Metric, Record<Win, CurrencySums>>;
const newSums = (): MetricSums =>
  Object.fromEntries(
    METRICS.map((m) => [m, { cur: new Map(), prev: new Map() }]),
  ) as unknown as MetricSums;

interface Acc {
  key: string;
  label: string | null;
  id: string | null;
  sums: MetricSums;
  invoices: { cur: number; prev: number };
}

/**
 * The revenue report (`/crm/revenue`): the period against its comparison, the table by group, the trend and the aging, cut to the
 * caller's `record.payments.read` scope. Every figure is a grouped query; money stays exact per currency.
 */
@Injectable()
export class RevenueReportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RevenueReportRepository,
    private readonly deals: DealsRepository,
    private readonly payments: PaymentsRepository,
  ) {}

  async report(query: RevenueReportQuery, scope: RecordScope): Promise<RevenueReportResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) =>
      this.build(tx, { orgId: ctx.orgId, userId: ctx.userId, scope, query }),
    );
  }

  /** Turns the query into ids, scopes and the period. Shared by the report, the PDF and the ledger CSV. */
  async resolve(tx: Tx, input: RevenueBuildInput): Promise<RevenueResolved> {
    const { orgId, userId, scope, query } = input;
    const org = await this.deals.orgSettings(tx, orgId);
    const tz = resolveTimezone(
      input.timezone ?? (await this.repo.profileZone(tx, orgId, userId)) ?? org.timezone,
    );
    const today = todayIn(tz, input.now ?? new Date());
    const period = input.frozen
      ? revenuePeriodOf(input.frozen, tz, today)
      : resolveRevenuePeriod(query.range, query.compare, tz, today, {
          from: query.from,
          to: query.to,
        });

    const filter: RevenueFilter = { orgId };
    if (query.ownerId) {
      const id = await this.repo.userId(tx, orgId, query.ownerId);
      if (id === undefined) throw AppError.notFound('User', query.ownerId);
      filter.ownerId = id;
    }
    if (query.teamId) {
      const id = await this.repo.teamId(tx, orgId, query.teamId);
      if (id === undefined) throw AppError.notFound('Team', query.teamId);
      filter.teamId = id;
    }
    if (query.currency) filter.currency = query.currency;

    return {
      filter,
      tz,
      period,
      scopes: {
        invoices: invoiceScopeCondition(orgId, scope, userId),
        payments: paymentScopeCondition(orgId, scope, userId),
      },
    };
  }

  async build(tx: Tx, input: RevenueBuildInput): Promise<RevenueReportResponse> {
    const { query } = input;
    const { filter, scopes, tz, period } = await this.resolve(tx, input);
    const convertTo = query.convertTo ?? null;
    const rates: RateTable = convertTo ? rateTableOf(await this.deals.rates(tx)) : new Map();
    const totals = (sums: CurrencySums): DealTotals => totalsOf(sums, convertTo, rates);
    const compare = period.compare !== null;

    const dateCur = { from: period.fromDate, to: period.toDate };
    const datePrev = period.compare
      ? { from: period.compare.fromDate, to: period.compare.toDate }
      : null;
    const spanCur = { from: period.from, to: period.toExclusive };
    const spanPrev = period.compare
      ? { from: period.compare.from, to: period.compare.toExclusive }
      : null;

    // ---- the totals --------------------------------------------------------------------------------------------------
    const cohortAll = await this.repo.cohort(
      tx,
      filter,
      scopes.invoices,
      'none',
      dateCur,
      datePrev,
      period.today,
    );
    const cashAll = await this.repo.cash(tx, filter, scopes.payments, 'none', spanCur, spanPrev);
    const total = newSums();
    const issued = { cur: 0, prev: 0 };
    for (const r of cohortAll) {
      addCohort(total, r);
      issued[r.win] += r.invoices;
    }
    for (const r of cashAll) addCash(total, r);

    const paidFull = await this.repo.paidInFull(tx, filter, scopes.invoices, spanCur, spanPrev);
    const tax: Record<Win, CurrencySums> = { cur: new Map(), prev: new Map() };
    const fullyPaid = { cur: 0, prev: 0 };
    for (const r of paidFull) {
      addTo(tax[r.win], r.currency, r.tax);
      fullyPaid[r.win] += r.invoices;
    }

    // ---- the table ---------------------------------------------------------------------------------------------------
    const groupBy: RevenueGroup = query.groupBy;
    const cohortRows = await this.repo.cohort(
      tx,
      filter,
      scopes.invoices,
      groupBy,
      dateCur,
      datePrev,
      period.today,
    );
    const cashRows = await this.repo.cash(tx, filter, scopes.payments, groupBy, spanCur, spanPrev);
    const groups = new Map<string, Acc>();
    const slot = (r: { key: string | null; label: string | null; id: string | null }): Acc => {
      const key = r.key ?? '';
      let acc = groups.get(key);
      if (!acc) {
        acc = {
          key,
          label: r.label,
          id: r.id,
          sums: newSums(),
          invoices: { cur: 0, prev: 0 },
        };
        groups.set(key, acc);
      }
      return acc;
    };
    for (const r of cohortRows) {
      const acc = slot(r);
      addCohort(acc.sums, r);
      acc.invoices[r.win] += r.invoices;
    }
    for (const r of cashRows) addCash(slot(r).sums, r);

    const rank = (s: CurrencySums): bigint => {
      if (convertTo) {
        let t = 0n;
        for (const [c, v] of s) t += convertMinor(v, c, convertTo, rates) ?? 0n;
        return t;
      }
      const first = [...s.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
      return first ? first[1] : 0n;
    };
    const ranked = [...groups.values()]
      .map((acc) => ({
        acc,
        rank: rank(acc.sums.invoiced.cur),
        collected: rank(acc.sums.collected.cur),
        row: { key: acc.key, label: acc.label },
      }))
      // A group with nothing in the period (it only exists for the comparison window) is not a row of this period.
      .filter((g) => g.acc.invoices.cur > 0 || METRICS.some((m) => g.acc.sums[m].cur.size > 0))
      .sort(compareRows);
    const items: RevenueRow[] = ranked.slice(0, REVENUE_ROW_LIMIT).map(({ acc }) => ({
      key: acc.key,
      label: acc.label,
      id: acc.id,
      invoices: {
        current: acc.invoices.cur,
        previous: compare ? acc.invoices.prev : null,
      },
      metrics: metricsOf(acc.sums, compare, totals),
    }));

    // ---- the trend ---------------------------------------------------------------------------------------------------
    const bucket = bucketFor(period.days);
    const invoicedTrend = await this.repo.invoicedTrend(
      tx,
      filter,
      scopes.invoices,
      dateCur,
      bucket,
    );
    const collectedTrend = await this.repo.collectedTrend(
      tx,
      filter,
      scopes.payments,
      spanCur,
      tz,
      bucket,
    );
    const points = bucketStarts(period.fromDate, period.toDate, bucket).map((start) => {
      const inv: CurrencySums = new Map();
      const col: CurrencySums = new Map();
      for (const r of invoicedTrend) if (r.start === start) addTo(inv, r.currency, r.total);
      for (const r of collectedTrend) if (r.start === start) addTo(col, r.currency, r.total);
      return { start, invoiced: totals(inv), collected: totals(col) };
    });

    // ---- the rest ----------------------------------------------------------------------------------------------------
    const allTime: CurrencySums = new Map();
    for (const r of await this.repo.collectedAllTime(tx, filter, scopes.payments))
      addTo(allTime, r.currency, r.total);
    const open = await this.repo.receivables(tx, filter, scopes.invoices, period.today);
    const owedNow: CurrencySums = new Map();
    const overdueNow: CurrencySums = new Map();
    for (const r of open) {
      addTo(owedNow, r.currency, r.outstanding);
      addTo(overdueNow, r.currency, r.overdue);
    }
    const currencies = await this.repo.currencies(tx, filter, scopes);

    const agingRows = await this.payments.aging(
      tx,
      filter.orgId,
      {},
      this.repo.invoiceWhere(filter, scopes.invoices),
      tz,
    );

    return {
      period: {
        range: period.range,
        timezone: tz,
        fromDate: period.fromDate,
        toDate: period.toDate,
        days: period.days,
        today: period.today,
      },
      comparison: period.compare
        ? {
            mode: period.compare.mode,
            fromDate: period.compare.fromDate,
            toDate: period.compare.toDate,
          }
        : null,
      convertedTo: convertTo,
      currencies,
      mixedCurrency: currencies.length > 1 && !convertTo && !query.currency,
      summary: {
        metrics: metricsOf(total, compare, totals),
        taxCollected: {
          current: totals(tax.cur),
          previous: compare ? totals(tax.prev) : null,
        },
        invoices: {
          issued: { current: issued.cur, previous: compare ? issued.prev : null },
          paidInFull: { current: fullyPaid.cur, previous: compare ? fullyPaid.prev : null },
        },
        receivables: {
          outstanding: totals(owedNow),
          overdue: totals(overdueNow),
          invoices: open.reduce((a, r) => a + r.invoices, 0),
        },
        collectedAllTime: totals(allTime),
      },
      rows: { groupBy, items, truncated: ranked.length > REVENUE_ROW_LIMIT },
      trend: { bucket, points },
      aging: { asOf: period.today, currencies: agingBlocks(agingRows) },
    };
  }
}

function addCohort(sums: MetricSums, r: CohortRow): void {
  addTo(sums.invoiced[r.win], r.currency, r.invoiced);
  addTo(sums.credited[r.win], r.currency, r.credited);
  addTo(sums.paid[r.win], r.currency, r.paid);
  addTo(sums.outstanding[r.win], r.currency, r.outstanding);
  addTo(sums.overdue[r.win], r.currency, r.overdue);
}

function addCash(sums: MetricSums, r: CashRow): void {
  addTo(sums.collected[r.win], r.currency, r.collected);
  addTo(sums.refunded[r.win], r.currency, r.refunded);
}

function metricsOf(
  sums: MetricSums,
  compare: boolean,
  totals: (s: CurrencySums) => DealTotals,
): RevenueMetrics {
  const pair = (m: Metric) => ({
    current: totals(sums[m].cur),
    previous: compare ? totals(sums[m].prev) : null,
  });
  return {
    invoiced: pair('invoiced'),
    credited: pair('credited'),
    paid: pair('paid'),
    outstanding: pair('outstanding'),
    overdue: pair('overdue'),
    collected: pair('collected'),
    refunded: pair('refunded'),
  };
}

const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;

/** One block per currency, the buckets in their fixed order, zero where nothing falls. */
export function agingBlocks(
  rows: Array<{ currency: string; bucket: string; amount: bigint; invoices: number }>,
): RevenueReportResponse['aging']['currencies'] {
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.currency, [...(by.get(r.currency) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => ({
      currency,
      total: minorToMajor(
        list.reduce((a, r) => a + r.amount, 0n),
        currency,
      ),
      invoices: list.reduce((a, r) => a + r.invoices, 0),
      buckets: AGING_BUCKETS.map((bucket) => {
        const r = list.find((x) => x.bucket === bucket);
        return {
          bucket,
          amount: minorToMajor(r?.amount ?? 0n, currency),
          invoices: r?.invoices ?? 0,
        };
      }),
    }));
}
