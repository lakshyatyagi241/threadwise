import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  minorToMajor,
  type CrmDashboardQuery,
  type CrmDashboardResponse,
  type DealTotals,
  type RecordScope,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { PlanEntitlementService, resolveFeature } from '../../plans-subscriptions-trials';
import { addDays, zonedMidnight } from '../../dashboards-analytics-charts';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import {
  addTo,
  convertMinor,
  moneyList,
  rateTableOf,
  totalsOf,
  weightedMinor,
  type CurrencySums,
  type RateTable,
} from '../deals/deal-money';
import { DealsRepository, dealScopeCondition } from '../deals/deals.repository';
import { invoiceScopeCondition } from '../invoicing/invoices.repository';
import { PaymentsRepository, paymentScopeCondition } from '../invoicing/payments.repository';
import { PipelinesRepository } from '../pipelines/pipelines.repository';
import { taskScopeCondition } from '../tasks/tasks.repository';
import {
  bucketFor,
  bucketStarts,
  funnelConversions,
  percent,
  resolvePeriod,
  winRate,
} from './crm-dashboard-rules';
import {
  CrmDashboardRepository,
  ownerScope,
  type DashFilter,
  type DashScopes,
  type MoneyCount,
} from './crm-dashboard.repository';

const LIST = 10;
const SOURCES = 12;
const ASSIGNEES = 12;
const UPCOMING = 6;
const PAYMENTS = 8;
const FEED = 10;

/** Keys the sections hang on. The deals key is the route's own; the rest switch their section on or off. */
const PERM = {
  contacts: 'record.contacts.read',
  tasks: 'record.tasks.read',
  payments: 'record.payments.read',
  deals: 'record.deals.read',
} as const;

const sumsOf = (rows: MoneyCount[]): CurrencySums => {
  const m: CurrencySums = new Map();
  for (const r of rows) addTo(m, r.currency, r.total);
  return m;
};

/**
 * Mean per deal: per currency total / count of that currency, half up; with a target currency the converted figure is the
 * converted total over all the deals (null when a currency has no rate, as everywhere else).
 */
function averages(rows: MoneyCount[], convertTo: string | null, rates: RateTable): DealTotals {
  const per: CurrencySums = new Map();
  for (const r of rows) if (r.n > 0) addTo(per, r.currency, (2n * r.total + BigInt(r.n)) / (2n * BigInt(r.n)));
  const byCurrency = moneyList(per);
  if (!convertTo) return { byCurrency };
  const count = rows.reduce((a, r) => a + r.n, 0);
  let converted = 0n;
  const unconverted: string[] = [];
  for (const r of rows) {
    const c = convertMinor(r.total, r.currency, convertTo, rates);
    if (c === null) unconverted.push(r.currency);
    else converted += c;
  }
  unconverted.sort();
  if (unconverted.length > 0 || count === 0) return { byCurrency, converted: null, unconverted };
  const avg = (2n * converted + BigInt(count)) / (2n * BigInt(count));
  return { byCurrency, converted: { currency: convertTo, amount: minorToMajor(avg, convertTo) }, unconverted };
}

/**
 * The CRM dashboard (`/crm`): deals, funnel, trend, lead sources, leaderboard, tasks, receivables and recent activity for one period.
 * Every number is a grouped query inside the caller's record scopes; a section the caller may not read is null.
 */
@Injectable()
export class CrmDashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CrmDashboardRepository,
    private readonly deals: DealsRepository,
    private readonly pipelines: PipelinesRepository,
    private readonly payments: PaymentsRepository,
    private readonly entitlements: PlanEntitlementService,
    private readonly rbac: RbacService,
  ) {}

  async dashboard(
    query: CrmDashboardQuery,
    dealsScope: RecordScope,
    now: Date = new Date(),
  ): Promise<CrmDashboardResponse> {
    const ctx = RequestContextStore.require();
    const grants = ctx.grants;
    const can = (key: string) => (grants ? this.rbac.can(grants, key) : { allowed: false, scope: 'own' as RecordScope });
    const contactsCan = can(PERM.contacts);
    const tasksCan = can(PERM.tasks);
    const paymentsCan = can(PERM.payments);
    const entitlements = await this.entitlements.forOrg(ctx.orgId);
    const invoicingOn = entitlements ? resolveFeature(entitlements, 'invoicing') : false;

    return this.db.tx(async (tx) => {
      const org = await this.deals.orgSettings(tx, ctx.orgId);
      const tz = resolveTimezone((await this.repo.profileZone(tx, ctx.orgId, ctx.userId)) ?? org.timezone);
      const today = todayIn(tz, now);
      const period = resolvePeriod(query.range, tz, today, { from: query.from, to: query.to });
      const cur = { from: period.from, to: period.toExclusive };
      const prev = { from: period.prevFrom, to: period.prevToExclusive };

      const filter: DashFilter = { orgId: ctx.orgId };
      if (query.pipelineId) {
        const p = await this.pipelines.pipelineByUuid(tx, ctx.orgId, query.pipelineId);
        if (!p) throw AppError.notFound('Pipeline', query.pipelineId);
        filter.pipelineId = p.id;
      }
      if (query.ownerId) {
        const id = await this.deals.resolveUserId(tx, ctx.orgId, query.ownerId);
        if (id === undefined) throw AppError.notFound('User', query.ownerId);
        filter.ownerId = id;
      }
      if (query.teamId) {
        const id = await this.repo.teamId(tx, ctx.orgId, query.teamId);
        if (id === undefined) throw AppError.notFound('Team', query.teamId);
        filter.teamId = id;
      }

      const convertTo = query.convertTo ?? null;
      const rates = convertTo ? rateTableOf(await this.deals.rates(tx)) : new Map();
      const totals = (sums: CurrencySums) => totalsOf(sums, convertTo, rates);

      const scopes: DashScopes = {
        deals: dealScopeCondition(ctx.orgId, dealsScope, ctx.userId),
        contacts: ownerScope(sql`c.owner_id`, ctx.orgId, contactsCan.scope, ctx.userId),
        tasks: taskScopeCondition(ctx.orgId, tasksCan.scope, ctx.userId),
        invoices: invoiceScopeCondition(ctx.orgId, paymentsCan.scope, ctx.userId),
        payments: paymentScopeCondition(ctx.orgId, paymentsCan.scope, ctx.userId),
      };

      // ---- deals ----------------------------------------------------------------------------------------------------------
      const stageRows = await this.pipelines.stagesOf(
        tx,
        ctx.orgId,
        filter.pipelineId !== undefined
          ? [filter.pipelineId]
          : (await this.pipelines.listPipelines(tx, ctx.orgId)).map((p) => p.id),
      );
      const probabilityOf = new Map(stageRows.map((s) => [s.id, s.probability]));
      const open = await this.repo.openByStage(tx, filter, scopes.deals, today);
      const openAll: CurrencySums = new Map();
      const forecast: CurrencySums = new Map();
      let openCount = 0;
      let late = 0;
      for (const r of open) {
        openCount += r.n;
        late += r.late;
        addTo(openAll, r.currency, r.total);
        addTo(forecast, r.currency, weightedMinor(r.total, probabilityOf.get(r.stageId) ?? 0));
      }

      const closed = await this.repo.closed(tx, filter, scopes.deals, cur, prev);
      const pick = (kind: 'won' | 'lost', win: 'cur' | 'prev') =>
        closed.filter((r) => r.kind === kind && r.win === win);
      const count = (rows: MoneyCount[]) => rows.reduce((a, r) => a + r.n, 0);
      const wonCur = pick('won', 'cur');
      const wonPrev = pick('won', 'prev');
      const lostCur = pick('lost', 'cur');
      const lostPrev = pick('lost', 'prev');
      const wonN = count(wonCur);
      const lostN = count(lostCur);
      const daysSum = wonCur.reduce((a, r) => a + r.days, 0);

      // funnel: the chosen pipeline, else the default one
      const allPipelines = await this.pipelines.listPipelines(tx, ctx.orgId);
      const funnelPipeline =
        allPipelines.find((p) => p.id === filter.pipelineId) ??
        allPipelines.find((p) => p.isDefault) ??
        allPipelines[0] ??
        null;
      let funnel: NonNullable<CrmDashboardResponse['deals']>['funnel'] = {
        pipeline: null,
        cohortSize: 0,
        stages: [],
      };
      if (funnelPipeline) {
        const fStages = (
          filter.pipelineId === funnelPipeline.id
            ? stageRows
            : await this.pipelines.stagesOf(tx, ctx.orgId, [funnelPipeline.id])
        ).filter((s) => s.kind !== 'lost');
        const funnelFilter = { ...filter, pipelineId: funnelPipeline.id };
        const f = await this.repo.funnel(tx, funnelFilter, scopes.deals, cur);
        // The live snapshot of the funnel's pipeline (the main one when the pipeline filter is off).
        const live =
          filter.pipelineId === funnelPipeline.id
            ? open
            : await this.repo.openByStage(tx, funnelFilter, scopes.deals, today);
        const reached = fStages.map((s) => f.rows.filter((r) => r.stageId === s.id).reduce((a, r) => a + r.n, 0));
        // Reached never rises from one stage to the next (guard; the query already counts a skipped stage as reached).
        for (let i = 1; i < reached.length; i++) reached[i] = Math.min(reached[i]!, reached[i - 1]!);
        const conversions = funnelConversions(reached);
        funnel = {
          pipeline: { id: funnelPipeline.uuid, name: funnelPipeline.name, currency: funnelPipeline.currency },
          cohortSize: f.cohort,
          stages: fStages.map((s, i) => {
            const mine = live.filter((r) => r.stageId === s.id);
            return {
              id: s.uuid,
              name: s.name,
              color: s.color,
              kind: s.kind,
              probability: s.probability,
              reached: reached[i]!,
              reachedValue: totals(sumsOf(f.rows.filter((r) => r.stageId === s.id))),
              conversionFromPrevious: conversions[i] ?? null,
              openCount: count(mine),
              openValue: totals(sumsOf(mine)),
            };
          }),
        };
      }

      const bucket = bucketFor(period.days);
      const trendRows = await this.repo.trend(tx, filter, scopes.deals, cur, tz, bucket);
      const points = bucketStarts(period.fromDate, period.toDate, bucket).map((start) => {
        const mine = trendRows.filter((r) => r.start === start);
        const won = mine.filter((r) => r.kind === 'won');
        return {
          start,
          wonCount: count(won),
          wonValue: totals(sumsOf(won)),
          lostCount: count(mine.filter((r) => r.kind === 'lost')),
        };
      });

      const leaderRows = await this.repo.leaders(tx, filter, scopes.deals, cur);
      const activityBy = await this.repo.activityCounts(tx, filter, scopes, cur, contactsCan.allowed);
      const byOwner = new Map<
        string,
        { name: string | null; won: CurrencySums; wonN: number; lostN: number; openN: number }
      >();
      for (const r of leaderRows) {
        const key = r.ownerUuid ?? '';
        const e = byOwner.get(key) ?? { name: r.ownerName, won: new Map(), wonN: 0, lostN: 0, openN: 0 };
        e.wonN += r.wonN;
        e.lostN += r.lostN;
        e.openN += r.openN;
        addTo(e.won, r.currency, r.wonTotal);
        byOwner.set(key, e);
      }
      const rank = (e: { won: CurrencySums }) => {
        if (convertTo) {
          let t = 0n;
          for (const [c, v] of e.won) t += convertMinor(v, c, convertTo, rates) ?? 0n;
          return t;
        }
        const first = [...e.won.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
        return first ? first[1] : 0n;
      };
      const leaderboard = [...byOwner.entries()]
        .map(([uuid, e]) => ({ uuid, e, key: rank(e) }))
        .sort((a, b) =>
          b.key > a.key ? 1 : b.key < a.key ? -1 : b.e.wonN - a.e.wonN || b.e.openN - a.e.openN,
        )
        .slice(0, LIST)
        .map(({ uuid, e }) => ({
          owner: uuid ? { id: uuid, name: e.name ?? '' } : null,
          wonCount: e.wonN,
          wonValue: totals(e.won),
          lostCount: e.lostN,
          openCount: e.openN,
          activities: uuid ? (activityBy.get(uuid) ?? 0) : 0,
        }));

      const dealsSection: CrmDashboardResponse['deals'] = {
        open: { count: openCount, value: totals(openAll), forecast: totals(forecast) },
        won: {
          count: wonN,
          value: totals(sumsOf(wonCur)),
          previousCount: count(wonPrev),
          previousValue: totals(sumsOf(wonPrev)),
          averageSize: averages(wonCur, convertTo, rates),
          averageCycleDays: wonN > 0 ? Math.round((daysSum / wonN) * 10) / 10 : null,
        },
        lost: { count: lostN, previousCount: count(lostPrev) },
        winRate: winRate(wonN, lostN),
        previousWinRate: winRate(count(wonPrev), count(lostPrev)),
        overdueCloseCount: late,
        funnel,
        trend: { bucket, points },
        leaderboard,
      };

      // ---- contacts and lead sources --------------------------------------------------------------------------------------
      let contactsSection: CrmDashboardResponse['contacts'] = null;
      if (contactsCan.allowed) {
        const n = await this.repo.newContacts(tx, filter, scopes.contacts, cur, prev);
        const src = await this.repo.sources(tx, filter, scopes, cur, SOURCES);
        const won = await this.repo.sourceWonValue(
          tx,
          filter,
          scopes,
          cur,
          src.map((s) => s.source),
        );
        contactsSection = {
          newContacts: { current: n.cur, previous: n.prev },
          newLeads: { current: n.curLeads, previous: n.prevLeads },
          sources: src.map((s) => ({
            source: s.source,
            leads: s.leads,
            withDeal: s.withDeal,
            withWonDeal: s.withWon,
            dealRate: percent(s.withDeal, s.leads),
            wonRate: percent(s.withWon, s.leads),
            wonValue: totals(
              sumsOf(
                won
                  .filter((w) => w.source === s.source)
                  .map((w) => ({ currency: w.currency, n: 0, total: w.total })),
              ),
            ),
          })),
        };
      }

      // ---- tasks ----------------------------------------------------------------------------------------------------------
      let tasksSection: CrmDashboardResponse['tasks'] = null;
      if (tasksCan.allowed) {
        const dayEnd = zonedMidnight(addDays(today, 1), tz);
        const sum = await this.repo.taskTotals(tx, filter, scopes.tasks, dayEnd);
        const rows = await this.repo.tasksByAssignee(tx, filter, scopes.tasks, dayEnd, ASSIGNEES);
        const upcoming = await this.repo.upcomingTasks(tx, filter, scopes.tasks, UPCOMING);
        tasksSection = {
          ...sum,
          byAssignee: rows.map((r) => ({
            assignee: r.assigneeUuid ? { id: r.assigneeUuid, name: r.assigneeName ?? '' } : null,
            open: r.open,
            overdue: r.overdue,
            dueToday: r.dueToday,
          })),
          upcoming: upcoming.map((t) => ({
            id: t.uuid,
            title: t.title,
            dueAt: t.dueAt.toISOString(),
            overdue: t.overdue,
            assignee: t.assigneeUuid ? { id: t.assigneeUuid, name: t.assigneeName ?? '' } : null,
          })),
        };
      }

      // ---- invoices and payments ------------------------------------------------------------------------------------------
      let invoicesSection: CrmDashboardResponse['invoices'] = null;
      if (paymentsCan.allowed && invoicingOn) {
        const bal = await this.repo.openBalances(tx, filter, scopes.invoices, today);
        const coll = await this.repo.collected(tx, filter, scopes.payments, cur, prev);
        const paid = await this.repo.paidInvoices(tx, filter, scopes.invoices, cur);
        const recent = await this.repo.recentPayments(tx, filter, scopes.payments, PAYMENTS);
        const agingRows = await this.payments.aging(
          tx,
          ctx.orgId,
          {},
          this.repo.invoiceWhere(filter, scopes.invoices),
          tz,
        );
        const byCurrency = new Map<string, typeof agingRows>();
        for (const r of agingRows) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r]);
        const sumOf = (rows: Array<{ currency: string; total: bigint }>) => {
          const m: CurrencySums = new Map();
          for (const r of rows) addTo(m, r.currency, r.total);
          return totals(m);
        };
        invoicesSection = {
          outstanding: sumOf(bal.map((b) => ({ currency: b.currency, total: b.outstanding }))),
          overdue: sumOf(bal.map((b) => ({ currency: b.currency, total: b.overdue }))),
          openInvoices: bal.reduce((a, b) => a + b.invoices, 0),
          collected: sumOf(coll.filter((c) => c.win === 'cur')),
          previousCollected: sumOf(coll.filter((c) => c.win === 'prev')),
          paidInvoices: paid,
          aging: [...byCurrency.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([currency, list]) => ({
              currency,
              total: minorToMajor(list.reduce((a, r) => a + r.amount, 0n), currency),
              invoices: list.reduce((a, r) => a + r.invoices, 0),
              buckets: (['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const).map((bucket) => {
                const r = list.find((x) => x.bucket === bucket);
                return {
                  bucket,
                  amount: minorToMajor(r?.amount ?? 0n, currency),
                  invoices: r?.invoices ?? 0,
                };
              }),
            })),
          recentPayments: recent.map((p) => ({
            id: p.uuid,
            amount: minorToMajor(p.amount, p.currency),
            currency: p.currency,
            paidAt: p.paidAt.toISOString(),
            contact: p.contactUuid ? { id: p.contactUuid, name: p.contactName } : null,
          })),
        };
      }

      // ---- recent activity ------------------------------------------------------------------------------------------------
      const feed = await this.repo.recentActivity(tx, filter, scopes, contactsCan.allowed, FEED);

      return {
        period: {
          range: query.range,
          timezone: tz,
          fromDate: period.fromDate,
          toDate: period.toDate,
          days: period.days,
          previous: { fromDate: period.prevFromDate, toDate: period.prevToDate },
          today,
        },
        convertedTo: convertTo,
        deals: dealsSection,
        contacts: contactsSection,
        tasks: tasksSection,
        invoices: invoicesSection,
        activity: feed.map((a) => ({
          kind: a.kind,
          type: a.type,
          at: a.at.toISOString(),
          subject: a.subject,
          subjectId: a.subjectUuid,
          actor: a.actorUuid ? { id: a.actorUuid, name: a.actorName ?? '' } : null,
          stageChange: a.type === 'stage_change' ? { from: a.from, to: a.to } : null,
        })),
      };
    });
  }
}
