import {
  majorToMinor,
  type BoardResponse,
  type DealActivityResponse,
  type DealReportsResponse,
  type DealResponse,
  type DealSettingsResponse,
  type DealTotals,
  type LostReasonResponse,
  type PipelineResponse,
  type PipelineStageResponse,
} from '@crm/contracts';
import type {
  Activity,
  Board,
  Deal,
  DealSettings,
  LostReason,
  Pipeline,
  Report,
  Stage,
} from './schemas';

/** Wire money is a decimal string; the screens count in integer minor units. A malformed string reads as 0. */
export function toMinorUnits(value: string, currency: string): number {
  const m = majorToMinor(value, currency);
  return m === null ? 0 : Number(m);
}

/**
 * One total in one currency. With `convertTo` the server sends the converted sum; without it (or when a rate is missing)
 * the entry in the wanted currency is used, and other currencies are left out rather than guessed at.
 */
export function pickTotal(totals: DealTotals | undefined, currency: string): number {
  if (!totals) return 0;
  if (totals.converted) return toMinorUnits(totals.converted.amount, totals.converted.currency);
  const same = totals.byCurrency.find((t) => t.currency === currency);
  return same ? toMinorUnits(same.amount, currency) : 0;
}

export function mapStage(s: PipelineStageResponse): Stage {
  return {
    id: s.id,
    pipelineId: s.pipelineId,
    name: s.name,
    color: s.color,
    probability: s.probability,
    kind: s.kind,
    sortOrder: s.sortOrder,
    dealCount: s.dealCount,
    rowVersion: s.rowVersion,
  };
}

export function mapPipeline(p: PipelineResponse): Pipeline {
  return {
    id: p.id,
    name: p.name,
    currency: p.currency,
    isDefault: p.isDefault,
    sortOrder: p.sortOrder,
    stages: [...p.stages].sort((a, b) => a.sortOrder - b.sortOrder).map(mapStage),
    dealCount: p.dealCount,
    rowVersion: p.rowVersion,
  };
}

export function mapDeal(d: DealResponse, pipelineCurrency?: string): Deal {
  const valueMinor = toMinorUnits(d.value, d.currency);
  return {
    id: d.id,
    title: d.title,
    pipelineId: d.pipeline.id,
    stageId: d.stage.id,
    status: d.status,
    valueMinor,
    currency: d.currency,
    boardValueMinor: pipelineCurrency === undefined || d.currency === pipelineCurrency ? valueMinor : 0,
    contact: d.contact ? { id: d.contact.id, name: d.contact.name, phone: d.contact.phone } : null,
    company: d.company,
    owner: d.owner,
    source: d.source,
    expectedCloseDate: d.expectedCloseDate,
    lostReason: d.lostReason,
    notes: d.notes,
    wonAt: d.wonAt,
    lostAt: d.lostAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    rowVersion: d.rowVersion,
  };
}

export function mapBoard(b: BoardResponse): Board {
  const currency = b.pipeline.currency;
  const unconverted = new Set<string>();
  const columns = b.stages.map((col) => {
    for (const c of col.total.unconverted ?? []) unconverted.add(c);
    return {
      stageId: col.stage.id,
      summary: {
        stageId: col.stage.id,
        count: col.count,
        valueMinor: pickTotal(col.total, currency),
        weightedMinor: pickTotal(col.weighted, currency),
      },
      deals: col.deals.map((d) => mapDeal(d, currency)),
      nextCursor: col.page.nextCursor,
      hasMore: col.page.hasMore,
    };
  });
  return {
    pipelineId: b.pipeline.id,
    currency,
    columns,
    kpis: {
      openCount: b.kpis.openCount,
      openValueMinor: pickTotal(b.kpis.openValue, currency),
      forecastMinor: pickTotal(b.kpis.forecast, currency),
      wonThisMonthCount: b.kpis.wonThisMonthCount,
      wonThisMonthValueMinor: pickTotal(b.kpis.wonThisMonthValue, currency),
      winRate: b.kpis.winRate,
    },
    unconverted: [...unconverted],
  };
}

export function mapActivity(a: DealActivityResponse): Activity {
  return {
    id: a.id,
    type: a.type,
    body: a.body,
    stageChange: a.stageChange
      ? { from: a.stageChange.from?.name ?? null, to: a.stageChange.to.name }
      : null,
    userName: a.author?.name ?? null,
    assigneeName: a.assignee?.name ?? null,
    dueAt: a.dueAt,
    doneAt: a.doneAt,
    done: a.done,
    createdAt: a.createdAt,
  };
}

export function mapReport(r: DealReportsResponse, currency: string): Report {
  const unconverted = new Set<string>();
  const note = (t: DealTotals) => {
    for (const c of t.unconverted ?? []) unconverted.add(c);
  };
  for (const t of [r.open.value, r.open.forecast, r.won.value, r.won.thisMonth.value, r.lost.value]) note(t);
  for (const s of r.byStage) note(s.value);
  const pick = (t: DealTotals) => pickTotal(t, currency);
  return {
    currency,
    timezone: r.timezone,
    unconverted: [...unconverted],
    openCount: r.open.count,
    openValueMinor: pick(r.open.value),
    forecastMinor: pick(r.open.forecast),
    wonCount: r.won.count,
    wonValueMinor: pick(r.won.value),
    wonThisMonthCount: r.won.thisMonth.count,
    wonThisMonthValueMinor: pick(r.won.thisMonth.value),
    avgDaysToClose: r.won.avgDaysToClose,
    lostCount: r.lost.count,
    winRate: r.winRate,
    byStage: r.byStage.map((s) => ({
      stageId: s.stageId,
      name: s.name,
      color: s.color,
      kind: s.kind,
      count: s.count,
      valueMinor: pick(s.value),
      weightedMinor: pick(s.weighted),
    })),
    months: r.months.map((m) => ({ month: m.month, won: m.wonCount, lost: m.lostCount })),
    leaders: r.leaders.map((l) => ({
      userId: l.owner.id,
      name: l.owner.name,
      won: l.wonCount,
      valueMinor: pick(l.value),
    })),
    lostReasons: r.lostReasons,
  };
}

export const mapLostReason = (r: LostReasonResponse): LostReason => ({
  id: r.id,
  name: r.name,
  sortOrder: r.sortOrder,
  isActive: r.isActive,
  dealCount: r.dealCount,
  rowVersion: r.rowVersion,
});

export const mapSettings = (s: DealSettingsResponse): DealSettings => ({
  lostReasonRequired: s.lostReasonRequired,
  rowVersion: s.rowVersion,
});
