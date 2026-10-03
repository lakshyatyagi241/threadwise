import { Injectable } from '@nestjs/common';
import {
  type DashWidgets,
  type AnalyticsPanels,
  type AnalyticsQuery,
  type AnalyticsResponse,
  type DashRange,
  type DashSummaryResponse,
  type DashThroughputResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { deltaPp, funnelOf, percentChange, totalsOf } from './dash-metrics';
import {
  addDays,
  resolveAnalyticsWindow,
  resolveDashWindow,
  resolveTimezone,
  zonedHourStart,
  zonedMidnight,
} from './dash-window';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { DashRepository } from './dash.repository';
import { DashWidgetsRepository } from './dash-widgets.repository';
import { DashPanelsRepository } from './dash-panels.repository';
import { DashExtrasRepository } from './dash-extras.repository';

const HOUR_MS = 3_600_000;
const iso = (d: Date): string => d.toISOString();

/**
 * Dashboard and analytics numbers (TW-DASH-002..005, 012, 018, 022..025, 027, 031). Read-only: no audit, no outbox.
 * Everything is one transaction on the caller's tenant connection.
 */
@Injectable()
export class DashService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DashRepository,
    private readonly widgetsRepo: DashWidgetsRepository,
    private readonly panelsRepo: DashPanelsRepository,
    private readonly extrasRepo: DashExtrasRepository,
    private readonly plans: PlanEntitlementService,
  ) {}

  /** Reference's hard-coded slot count when the plan sets no device limit. */
  static readonly DEFAULT_SLOTS = 6;

  /** The dashboard's data cards (TW-DASH-006, 011, 013..016, 019); one transaction, one payload. */
  async widgets(range: DashRange, now: Date = new Date()): Promise<DashWidgets> {
    const { orgId } = RequestContextStore.require();
    const pipelineOn = await this.plans.featureEnabled(orgId, 'sales_pipeline');
    const deviceCap = await this.plans.limit(orgId, 'devices');
    return this.db.tx(async (tx) => {
      const tz = resolveTimezone(await this.repo.orgTimezone(tx, orgId));
      const w = resolveDashWindow(range, tz, now);
      const devices = await this.widgetsRepo.devices(tx, orgId);
      return {
        contacts: await this.widgetsRepo.contacts(tx, orgId, w.from),
        campaigns: await this.widgetsRepo.campaigns(tx, orgId),
        devices: {
          ...devices,
          slotCap: Math.max(devices.total, deviceCap > 0 ? deviceCap : DashService.DEFAULT_SLOTS),
        },
        templates: await this.widgetsRepo.templates(tx, orgId, w.from, w.to),
        inbox: await this.widgetsRepo.inbox(tx, orgId),
        pipeline: pipelineOn
          ? await this.widgetsRepo.pipeline(
              tx,
              orgId,
              new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
            )
          : null,
        instagram: await this.extrasRepo.instagram(tx, orgId, now),
        flows: await this.extrasRepo.flows(tx, orgId),
        integrations: await this.extrasRepo.integrations(tx, orgId, now),
        activity: await this.widgetsRepo.activity(tx, orgId),
      };
    });
  }

  async summary(range: DashRange, now: Date = new Date()): Promise<DashSummaryResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = resolveTimezone(await this.repo.orgTimezone(tx, orgId));
      const w = resolveDashWindow(range, tz, now);
      const current = totalsOf(await this.repo.counts(tx, orgId, w.from, w.to));
      const previous = totalsOf(await this.repo.counts(tx, orgId, w.prevFrom, w.prevTo));
      const hours = await this.repo.hourlyOut(tx, orgId, now, 20);
      return {
        range,
        window: {
          from: iso(w.from),
          to: iso(w.to),
          prevFrom: iso(w.prevFrom),
          prevTo: iso(w.prevTo),
          timezone: tz,
        },
        current,
        previous,
        sentDeltaPct: percentChange(current.sent, previous.sent),
        readRateDeltaPp: deltaPp(current.readRate, previous.readRate),
        sparkline: hours.reverse(),
        funnel: funnelOf(current),
      };
    });
  }

  async throughput(range: DashRange, now: Date = new Date()): Promise<DashThroughputResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = resolveTimezone(await this.repo.orgTimezone(tx, orgId));
      const w = resolveDashWindow(range, tz, now);
      let starts: Date[];
      let found: Awaited<ReturnType<DashRepository['buckets']>>;
      if (w.bucket === 'hour') {
        // 24 whole hours ending with the current one (Reference's 24h chart).
        const first = new Date(zonedHourStart(now, tz).getTime() - 23 * HOUR_MS);
        starts = Array.from({ length: 24 }, (_, i) => new Date(first.getTime() + i * HOUR_MS));
        found = await this.repo.buckets(
          tx,
          orgId,
          first,
          new Date(first.getTime() + 24 * HOUR_MS),
          { bucket: 'hour' },
        );
      } else {
        const fromDate = w.fromDate!;
        starts = Array.from({ length: w.days! }, (_, i) => zonedMidnight(addDays(fromDate, i), tz));
        found = await this.repo.buckets(tx, orgId, w.from, w.to, { bucket: 'day', fromDate, tz });
      }
      const at = (i: number) => found.get(i) ?? { sent: 0, delivered: 0, failed: 0 };
      const hourly = await this.repo.hourlyOut(tx, orgId, now, 24);
      const top = Math.max(...hourly);
      const slot = top > 0 ? hourly.indexOf(top) : -1;
      return {
        range,
        timezone: tz,
        bucket: w.bucket,
        starts: starts.map(iso),
        sent: starts.map((_, i) => at(i).sent),
        delivered: starts.map((_, i) => at(i).delivered),
        failed: starts.map((_, i) => at(i).failed),
        peak:
          slot >= 0
            ? { start: iso(new Date(now.getTime() - (slot + 1) * HOUR_MS)), count: top }
            : null,
        avgPerHour: Math.round(hourly.reduce((a, b) => a + b, 0) / 24),
      };
    });
  }

  /** The analytics list panels (TW-DASH-026, 028, 030) for the same window rules as the overview. */
  async panels(q: AnalyticsQuery, now: Date = new Date()): Promise<AnalyticsPanels> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = resolveTimezone(await this.repo.orgTimezone(tx, orgId));
      const w = resolveAnalyticsWindow(q, tz, now);
      if (!w)
        throw AppError.validation('The range is too long', [
          { path: 'from', message: 'at most 366 days' },
        ]);
      return {
        devices: await this.panelsRepo.devices(tx, orgId),
        templates: await this.panelsRepo.templates(tx, orgId, w.from, w.to),
        contacts: await this.panelsRepo.contacts(tx, orgId, w.from, w.to),
        team: await this.panelsRepo.team(tx, orgId, w.from, w.to),
      };
    });
  }

  async analytics(q: AnalyticsQuery, now: Date = new Date()): Promise<AnalyticsResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = resolveTimezone(await this.repo.orgTimezone(tx, orgId));
      const w = resolveAnalyticsWindow(q, tz, now);
      if (!w)
        throw AppError.validation('The range is too long', [
          { path: 'from', message: 'at most 366 days' },
        ]);
      const current = totalsOf(await this.repo.counts(tx, orgId, w.from, w.to));
      const previous = totalsOf(await this.repo.counts(tx, orgId, w.prevFrom, w.prevTo));
      const days = await this.repo.buckets(tx, orgId, w.from, w.to, {
        bucket: 'day',
        fromDate: w.fromDate,
        tz,
      });
      const idx = Array.from({ length: w.days }, (_, i) => i);
      const at = (i: number) => days.get(i) ?? { sent: 0, delivered: 0, failed: 0 };
      const f = funnelOf(current);
      const pf = funnelOf(previous);
      return {
        range: q.range,
        window: {
          from: iso(w.from),
          to: iso(w.to),
          prevFrom: iso(w.prevFrom),
          prevTo: iso(w.prevTo),
          timezone: tz,
          days: w.days,
          fromDate: w.fromDate,
          toDate: w.toDate,
        },
        current,
        previous,
        trends: {
          sentPct: percentChange(current.sent, previous.sent),
          deliveredPct: percentChange(current.delivered, previous.delivered),
          failedPct: percentChange(current.failed, previous.failed),
          queuedPct: percentChange(current.queued, previous.queued),
          repliesPct: percentChange(current.replies, previous.replies),
          replyRatePp: deltaPp(current.replyRate, previous.replyRate),
          endToEndPp: deltaPp(f.endToEnd, pf.endToEnd),
        },
        daily: {
          dates: idx.map((i) => addDays(w.fromDate, i)),
          sent: idx.map((i) => at(i).sent),
          delivered: idx.map((i) => at(i).delivered),
          failed: idx.map((i) => at(i).failed),
          queued: idx.map((i) => Math.max(0, at(i).sent - at(i).delivered - at(i).failed)),
        },
        funnel: f,
        types: (await this.repo.types(tx, orgId, w.from, w.to))
          .map((t) => ({ key: t.key as AnalyticsResponse['types'][number]['key'], count: t.count }))
          .sort((a, b) => b.count - a.count),
        heatmap: await this.repo.heatmap(tx, orgId, w.from, w.to, tz),
      };
    });
  }

  /** The analytics window as CSV: the KPI grid, then the daily series (TW-DASH-032; Reference exported five counts). */
  async analyticsCsv(q: AnalyticsQuery, now: Date = new Date()): Promise<string> {
    const a = await this.analytics(q, now);
    const rows: string[][] = [
      ['Metric', 'Value'],
      ['Range', `${a.window.fromDate} to ${a.window.toDate}`],
      ['Sent', String(a.current.sent)],
      ['Delivered', String(a.current.delivered)],
      ['Read', String(a.current.read)],
      ['Failed', String(a.current.failed)],
      ['Queued', String(a.current.queued)],
      ['Replies', String(a.current.replies)],
      ['Deliverability %', String(a.current.deliverability)],
      ['Read rate %', String(a.current.readRate)],
      ['Reply rate %', String(a.current.replyRate)],
      [],
      ['Date', 'Sent', 'Delivered', 'Failed', 'Queued'],
      ...a.daily.dates.map((d, i) => [
        d,
        String(a.daily.sent[i]),
        String(a.daily.delivered[i]),
        String(a.daily.failed[i]),
        String(a.daily.queued[i]),
      ]),
    ];
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}

/** A CSV cell: quoted when needed, and neutralised when a spreadsheet would read it as a formula (TW-DASH-032 rule 3). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
