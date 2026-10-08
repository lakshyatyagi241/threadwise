import {
  REPORT_LIVE_METRICS,
  isReportLiveMetric,
  type AdminAnalytics,
  type AdminOverview,
  type DashSummaryResponse,
  type DashWidgets,
  type ReportScope,
  type ReportWindow,
} from '@crm/contracts';

/**
 * Live figures a report block may be bound to. The list of valid keys is the contract's (`REPORT_LIVE_METRICS`, the same list the
 * assistant is given); this file says where each key's current value is read on the page, from the hooks the Dashboard and the
 * operator overview already use. A key the contract does not list for the scope is ignored and the figure the model wrote is shown.
 */

/** Which response a metric is read from. */
export type LiveSource = 'summary' | 'widgets' | 'overview' | 'analytics';

export interface LiveData {
  summary?: DashSummaryResponse | undefined;
  widgets?: DashWidgets | undefined;
  overview?: AdminOverview | undefined;
  analytics?: AdminAnalytics | undefined;
}

type Reader = (d: Required<LiveData>) => number | string | null | undefined;
interface Binding {
  from: LiveSource;
  read: Reader;
}

const b = (from: LiveSource, read: Reader): Binding => ({ from, read });

const BINDINGS: Record<string, Binding> = {
  // workspace: the dashboard summary, for the window the person chose
  'messages.sent': b('summary', (d) => d.summary.current.sent),
  'messages.delivered': b('summary', (d) => d.summary.current.delivered),
  'messages.read': b('summary', (d) => d.summary.current.read),
  'messages.failed': b('summary', (d) => d.summary.current.failed),
  'messages.queued': b('summary', (d) => d.summary.current.queued),
  'messages.replies': b('summary', (d) => d.summary.current.replies),
  'messages.deliverability': b('summary', (d) => d.summary.current.deliverability),
  'messages.readRate': b('summary', (d) => d.summary.current.readRate),
  'messages.replyRate': b('summary', (d) => d.summary.current.replyRate),
  // workspace: the dashboard cards, as of now
  'contacts.total': b('widgets', (d) => d.widgets.contacts.total),
  'contacts.subscribed': b('widgets', (d) => d.widgets.contacts.subscribed),
  'contacts.blocked': b('widgets', (d) => d.widgets.contacts.blocked),
  'campaigns.running': b('widgets', (d) => d.widgets.campaigns.running),
  'campaigns.scheduled': b('widgets', (d) => d.widgets.campaigns.scheduled),
  'campaigns.paused': b('widgets', (d) => d.widgets.campaigns.paused),
  'campaigns.total': b('widgets', (d) => d.widgets.campaigns.total),
  'devices.total': b('widgets', (d) => d.widgets.devices.total),
  'devices.online': b('widgets', (d) => d.widgets.devices.online),
  'templates.count': b('widgets', (d) => d.widgets.templates.count),
  'inbox.unread': b('widgets', (d) => d.widgets.inbox.unread),
  'pipeline.openDeals': b('widgets', (d) => d.widgets.pipeline?.openDeals),
  'pipeline.winRatePct': b('widgets', (d) => d.widgets.pipeline?.winRatePct),
  'flows.total': b('widgets', (d) => d.widgets.flows.total),
  'flows.active': b('widgets', (d) => d.widgets.flows.active),
  'flows.subscribers': b('widgets', (d) => d.widgets.flows.subscribers),
  // platform: the operator overview (for the window) and the platform analytics (for the same number of days)
  'platform.income': b('overview', (d) => d.overview.kpis.income.value),
  'platform.views': b('overview', (d) => d.overview.kpis.views.value),
  'platform.conversion': b('overview', (d) => d.overview.kpis.conversion.value),
  'users.total': b('overview', (d) => d.overview.users.total),
  'users.premium': b('overview', (d) => d.overview.users.premium),
  'users.basic': b('overview', (d) => d.overview.users.basic),
  'alerts.open': b('overview', (d) => d.overview.alerts.open),
  'platform.revenue': b('analytics', (d) => d.analytics.kpis.revenue),
  'platform.workspaces': b('analytics', (d) => d.analytics.kpis.workspaces),
  'platform.newWorkspaces': b('analytics', (d) => d.analytics.kpis.newWorkspaces),
  'platform.newUsers': b('analytics', (d) => d.analytics.kpis.newUsers),
  'platform.messages': b('analytics', (d) => d.analytics.kpis.messages),
  'platform.devicesOnline': b('analytics', (d) => d.analytics.kpis.devicesOnline),
  'platform.devicesTotal': b('analytics', (d) => d.analytics.kpis.devicesTotal),
  'platform.openTickets': b('analytics', (d) => d.analytics.kpis.openTickets),
};

/** A key the screen can show live for this scope: listed by the contract for it, and readable here. */
export const isLiveKey = (scope: ReportScope, key: string | undefined): key is string =>
  !!key && isReportLiveMetric(scope, key) && key in BINDINGS;

/** The response a key is read from, or null for a key that is not live-bindable. */
export function liveSourceOf(scope: ReportScope, key: string | undefined): LiveSource | null {
  return isLiveKey(scope, key) ? BINDINGS[key]!.from : null;
}

/** The kind of number a key is (count, percent or money), for showing it with the right unit. */
export function liveUnitOf(scope: ReportScope, key: string): 'count' | 'percent' | 'money' | null {
  return REPORT_LIVE_METRICS[scope].find((m) => m.key === key)?.unit ?? null;
}

/**
 * The dashboard range a report window maps to, or null when the dashboard has no matching range (it has no 90-day one): the
 * message figures then keep what the model wrote rather than showing a different period's number.
 */
export function dashRangeFor(win: ReportWindow): '7d' | '30d' | null {
  return win === '7d' || win === '30d' ? win : null;
}

/** The number of days the platform analytics cover for a report window. */
export const analyticsDaysFor = (win: ReportWindow): number =>
  ({ '7d': 7, '30d': 30, '90d': 90 })[win];

/**
 * The current value of a key from the responses loaded so far, or null when its response is not there yet, the field is missing
 * (a plan without a pipeline), or the value is not a finite number. Money arrives as a string and is read as a number.
 */
export function readLive(
  scope: ReportScope,
  key: string | undefined,
  data: LiveData,
): number | null {
  if (!isLiveKey(scope, key)) return null;
  const binding = BINDINGS[key]!;
  if (!data[binding.from]) return null;
  const raw = binding.read(data as Required<LiveData>);
  const n = typeof raw === 'string' ? (raw.trim() === '' ? Number.NaN : Number(raw)) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
