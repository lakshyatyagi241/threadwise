import type {
  AdminAnalytics,
  AdminOverview,
  AnalyticsResponse,
  DashSummaryResponse,
  DashWidgets,
  ReportScope,
  ReportWindow,
} from '@crm/contracts';
import { REPORT_LIVE_METRICS, type ReportLiveMetric } from '@crm/contracts';
import { FIGURE_LIMITS, type Figures } from './report-figures';
import type { ReportDocumentRow } from './report-documents.repository';
import { readChunk, UNTRUSTED_NOTICE, wrapDocumentText } from './report-rules';

/**
 * What the assistant's tools hand back to the model. Each is a deliberate subset of the service result: the numbers a report needs and
 * nothing that identifies a customer (no phone numbers, message previews, owners' names or e-mail addresses), because this text goes to
 * a third-party model vendor. Every result carries a `source` label the model quotes in the report's `sources`.
 */

const WINDOW_LABEL: Record<ReportWindow, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
};

// --- documents ---------------------------------------------------------------------------------------------------------------------------

export function listDocumentsOutput(scope: ReportScope, rows: readonly ReportDocumentRow[]) {
  return {
    library: scope === 'workspace' ? 'workspace documents' : 'platform documents',
    count: rows.length,
    documents: rows.map((r) => ({
      documentId: r.uuid,
      name: r.name,
      type: r.extension,
      characters: r.charCount,
      cutAtUpload: r.truncated,
      addedAt: r.createdAt.toISOString(),
    })),
    next:
      rows.length === 0
        ? 'There are no documents; build the report from the live numbers alone and say so.'
        : 'Call read_document for each document that may matter; keep calling with nextOffset until it is null.',
  };
}

export function readDocumentOutput(
  doc: { uuid: string; name: string; extractedText: string; truncated: boolean },
  offset: number,
) {
  const chunk = readChunk(doc.extractedText, offset);
  return {
    documentId: doc.uuid,
    name: doc.name,
    offset: chunk.offset,
    nextOffset: chunk.nextOffset,
    totalChars: chunk.totalChars,
    cutAtUpload: doc.truncated,
    source: `document "${doc.name}"`,
    notice: UNTRUSTED_NOTICE,
    content: wrapDocumentText(doc.name, chunk.text),
  };
}

export function figuresOutput(
  doc: { uuid: string; name: string; truncated: boolean },
  figures: Figures,
) {
  return {
    documentId: doc.uuid,
    name: doc.name,
    source: `document "${doc.name}"`,
    notice: `${UNTRUSTED_NOTICE} Labels, headers and cell texts below are copied from the document.`,
    cutAtUpload: doc.truncated,
    howToRead:
      'Each number has its exact `text` from the document and the `value` read from it; use them as given, never round or rescale. A `sum` is computed over the listed rows and includes any total row. `line`/`startOffset` locate the source: read_document with that offset shows it.',
    tables: figures.tables,
    lines: figures.lines,
    tablesFound: figures.tablesFound,
    linesFound: figures.linesFound,
    cut: figures.cut,
    limits: figures.cut
      ? `Cut at ${FIGURE_LIMITS.tables} tables, ${FIGURE_LIMITS.rowsPerTable} rows each and ${FIGURE_LIMITS.pairs} lines; read_document for the rest.`
      : undefined,
    next:
      figures.tables.length === 0 && figures.lines.length === 0
        ? 'No tables or "label: number" lines were found. Numbers written in sentences are not extracted: read_document, and say "not found in the documents" for anything you cannot quote.'
        : undefined,
  };
}

// --- live bindings --------------------------------------------------------------------------------------------------------------------

/** The metrics of one tool result with their binding keys: a KPI may carry `live: <key>` only for a key listed here. */
export function liveMetrics(
  scope: 'workspace' | 'platform',
  values: Record<string, number | string | null | undefined>,
) {
  const catalogue: readonly ReportLiveMetric[] = REPORT_LIVE_METRICS[scope];
  return catalogue
    .filter((m) => values[m.key] !== undefined && values[m.key] !== null)
    .map((m) => ({ key: m.key, label: m.label, unit: m.unit, value: values[m.key] }));
}

// --- the workspace dashboard -------------------------------------------------------------------------------------------------------------

export function summaryOutput(s: DashSummaryResponse, window: ReportWindow) {
  return {
    source: `Dashboard summary, ${WINDOW_LABEL[window]}`,
    window: { from: s.window.from, to: s.window.to, timezone: s.window.timezone },
    current: s.current,
    previousPeriod: s.previous,
    sentChangePct: s.sentDeltaPct,
    readRateChangePoints: s.readRateDeltaPp,
    funnel: s.funnel,
    liveMetrics: liveMetrics('workspace', {
      'messages.sent': s.current.sent,
      'messages.delivered': s.current.delivered,
      'messages.read': s.current.read,
      'messages.failed': s.current.failed,
      'messages.queued': s.current.queued,
      'messages.replies': s.current.replies,
      'messages.deliverability': s.current.deliverability,
      'messages.readRate': s.current.readRate,
      'messages.replyRate': s.current.replyRate,
    }),
  };
}

export function widgetsOutput(w: DashWidgets, window: ReportWindow) {
  return {
    source: `Dashboard cards, ${WINDOW_LABEL[window]} where a card has a window`,
    contacts: w.contacts,
    campaigns: {
      running: w.campaigns.running,
      scheduled: w.campaigns.scheduled,
      paused: w.campaigns.paused,
      total: w.campaigns.total,
      recent: w.campaigns.recent.slice(0, 5).map((c) => ({
        name: c.name,
        status: c.status,
        done: c.done,
        total: c.total,
        pct: c.pct,
      })),
    },
    devices: { total: w.devices.total, online: w.devices.online },
    templates: {
      count: w.templates.count,
      top: [...w.templates.rows]
        .sort((a, b) => b.sent - a.sent)
        .slice(0, 5)
        .map((t) => ({
          name: t.name,
          status: t.status,
          sent: t.sent,
          delivered: t.delivered,
          read: t.read,
          readRatePct: t.readRatePct,
        })),
    },
    inbox: { unread: w.inbox.unread, oldestUnreadAt: w.inbox.oldestUnreadAt },
    pipeline: w.pipeline,
    flows: { total: w.flows.total, active: w.flows.active, subscribers: w.flows.subscribers },
    liveMetrics: liveMetrics('workspace', {
      'contacts.total': w.contacts.total,
      'contacts.subscribed': w.contacts.subscribed,
      'contacts.blocked': w.contacts.blocked,
      'campaigns.running': w.campaigns.running,
      'campaigns.scheduled': w.campaigns.scheduled,
      'campaigns.paused': w.campaigns.paused,
      'campaigns.total': w.campaigns.total,
      'devices.total': w.devices.total,
      'devices.online': w.devices.online,
      'templates.count': w.templates.count,
      'inbox.unread': w.inbox.unread,
      'pipeline.openDeals': w.pipeline?.openDeals,
      'pipeline.winRatePct': w.pipeline?.winRatePct,
      'flows.total': w.flows.total,
      'flows.active': w.flows.active,
      'flows.subscribers': w.flows.subscribers,
    }),
  };
}

export function analyticsOutput(a: AnalyticsResponse, window: ReportWindow) {
  return {
    source: `Analytics overview, ${WINDOW_LABEL[window]}`,
    window: {
      fromDate: a.window.fromDate,
      toDate: a.window.toDate,
      days: a.window.days,
      timezone: a.window.timezone,
    },
    current: a.current,
    previousPeriod: a.previous,
    trends: a.trends,
    daily: a.daily,
    funnel: { stages: a.funnel.stages, endToEnd: a.funnel.endToEnd, replyRate: a.funnel.replyRate },
    messageTypes: a.types,
  };
}

// --- the platform overview ----------------------------------------------------------------------------------------------------------------

export function platformOverviewOutput(o: AdminOverview, window: ReportWindow) {
  return {
    source: `Platform overview, ${WINDOW_LABEL[window]}`,
    window: { from: o.from, to: o.to },
    currency: o.currency,
    kpis: o.kpis,
    revenue: {
      total: o.revenue.total,
      totalTarget: o.revenue.totalTarget,
      labels: o.revenue.labels,
      series: o.revenue.series,
    },
    gateways: o.gateways,
    users: o.users,
    countries: o.countries.slice(0, 10),
    workspaces: o.workspaces.slice(0, 10).map((w) => ({
      name: w.name,
      plan: w.plan,
      messages: w.messages,
      health: w.health,
      mrr: w.mrr,
    })),
    alerts: o.alerts,
    liveMetrics: liveMetrics('platform', {
      'platform.income': o.kpis.income.value,
      'platform.views': o.kpis.views.value,
      'platform.conversion': o.kpis.conversion.value,
      'users.total': o.users.total,
      'users.premium': o.users.premium,
      'users.basic': o.users.basic,
      'alerts.open': o.alerts.open,
    }),
  };
}

export function platformAnalyticsOutput(a: AdminAnalytics, window: ReportWindow) {
  return {
    source: `Platform analytics, ${WINDOW_LABEL[window]}`,
    days: a.days,
    since: a.since,
    currency: a.currency,
    kpis: a.kpis,
    signups: a.signups,
    planMix: a.planMix,
    deviceSends24h: a.deviceSends24h,
    leaderboard: a.leaderboard.slice(0, 10).map((l) => ({
      name: l.name,
      orders: l.orders,
      amount: l.amount,
    })),
    tickets: a.tickets,
    liveMetrics: liveMetrics('platform', {
      'platform.revenue': a.kpis.revenue,
      'platform.workspaces': a.kpis.workspaces,
      'platform.newWorkspaces': a.kpis.newWorkspaces,
      'platform.newUsers': a.kpis.newUsers,
      'platform.messages': a.kpis.messages,
      'platform.devicesOnline': a.kpis.devicesOnline,
      'platform.devicesTotal': a.kpis.devicesTotal,
      'platform.openTickets': a.kpis.openTickets,
    }),
  };
}
