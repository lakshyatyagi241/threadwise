import type { ReportScope } from './documents';

/**
 * The live figures a report block may be bound to. A KPI item carries `live: '<key>'` and the screen shows the CURRENT value of that
 * metric (from the same data the dashboard uses) instead of a number the model typed. Only these keys are valid; the assistant is told
 * the list, and the tools that return the numbers label each with its key so the model reads the key and the value side by side.
 *
 * `unit`: `count` is a whole number, `percent` a percentage (0-100), `money` an amount in the platform's currency.
 * The workspace keys come from the dashboard summary (`messages.*`, for the selected window) and the dashboard cards (the rest, as of
 * now). The platform keys come from the operator overview (for the selected window) and the platform analytics.
 */
export interface ReportLiveMetric {
  key: string;
  label: string;
  unit: 'count' | 'percent' | 'money';
}

const m = (
  key: string,
  label: string,
  unit: ReportLiveMetric['unit'] = 'count',
): ReportLiveMetric => ({
  key,
  label,
  unit,
});

export const REPORT_LIVE_METRICS = {
  workspace: [
    m('messages.sent', 'Messages sent'),
    m('messages.delivered', 'Messages delivered'),
    m('messages.read', 'Messages read'),
    m('messages.failed', 'Messages failed'),
    m('messages.queued', 'Messages queued'),
    m('messages.replies', 'Replies received'),
    m('messages.deliverability', 'Delivery rate', 'percent'),
    m('messages.readRate', 'Read rate', 'percent'),
    m('messages.replyRate', 'Reply rate', 'percent'),
    m('contacts.total', 'Contacts'),
    m('contacts.subscribed', 'Subscribed contacts'),
    m('contacts.blocked', 'Blocked contacts'),
    m('campaigns.running', 'Campaigns running'),
    m('campaigns.scheduled', 'Campaigns scheduled'),
    m('campaigns.paused', 'Campaigns paused'),
    m('campaigns.total', 'Campaigns'),
    m('devices.total', 'Devices'),
    m('devices.online', 'Devices online'),
    m('templates.count', 'Templates'),
    m('inbox.unread', 'Unread conversations'),
    m('pipeline.openDeals', 'Open deals'),
    m('pipeline.winRatePct', 'Deal win rate', 'percent'),
    m('flows.total', 'Flows'),
    m('flows.active', 'Active flows'),
    m('flows.subscribers', 'Flow subscribers'),
  ],
  platform: [
    m('platform.income', 'Income', 'money'),
    m('platform.views', 'Messages sent'),
    m('platform.conversion', 'Signup-to-paid conversion', 'percent'),
    m('users.total', 'Registered users'),
    m('users.premium', 'Premium users'),
    m('users.basic', 'Basic users'),
    m('alerts.open', 'Open alerts'),
    m('platform.revenue', 'Revenue', 'money'),
    m('platform.workspaces', 'Workspaces'),
    m('platform.newWorkspaces', 'New workspaces'),
    m('platform.newUsers', 'New users'),
    m('platform.messages', 'Messages'),
    m('platform.devicesOnline', 'Devices online'),
    m('platform.devicesTotal', 'Devices'),
    m('platform.openTickets', 'Open support tickets'),
  ],
} as const satisfies Record<ReportScope, readonly ReportLiveMetric[]>;

export const reportLiveMetricKeys = (scope: ReportScope): string[] =>
  REPORT_LIVE_METRICS[scope].map((x) => x.key);

export const isReportLiveMetric = (scope: ReportScope, key: string): boolean =>
  reportLiveMetricKeys(scope).includes(key);
