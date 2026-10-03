import type {
  AutomationInput,
  DashboardLog,
  DashboardSender,
  DashboardTemplate,
  StoreDashboard,
} from '@crm/contracts';

/** Small pure rules of the store screens (WD-ECOM-004, 009, 023): tabs, labels, automation catalogue, template narrowing. */

export type Kind = 'shopify' | 'woocommerce';

/** The tabs, in WaDesk's order. Invoices is left out until the invoicing domain exports its panel (WD-ECOM-035). */
export const TABS = [
  'overview',
  'orders',
  'products',
  'offers',
  'customers',
  'events',
  'analytics',
  'logs',
  'settings',
] as const;
export type Tab = (typeof TABS)[number];

/** The tab named in the address, or the overview for anything else. */
export const parseTab = (raw: string | null): Tab =>
  (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';

/** The count shown next to a tab in the rail, or null for tabs with none. */
export function tabBadge(tab: Tab, d: StoreDashboard): number | null {
  switch (tab) {
    case 'orders':
      return d.counts.orders;
    case 'products':
      return d.counts.products;
    case 'customers':
      return d.counts.customers;
    case 'events':
      return d.activeEvents;
    case 'logs':
      return d.logTotal;
    default:
      return null;
  }
}

export type Tone = 'good' | 'bad' | 'muted' | 'warn';

/** How a log or order status reads: processed and sent are good, failed is bad, skipped is quiet, anything else a warning. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'processed':
    case 'sent':
      return 'good';
    case 'failed':
      return 'bad';
    case 'skipped':
      return 'muted';
    default:
      return 'warn';
  }
}

const DAY_MS = 86_400_000;

/** The webhooks count as healthy when the newest delivery is less than a day old. */
export function isHealthy(recent: readonly DashboardLog[], nowMs: number): boolean {
  const last = recent[0];
  return last !== undefined && nowMs - new Date(last.createdAt).getTime() < DAY_MS;
}

/** `USD 1,234.50`. */
export const money = (amount: number, currency: string, digits = 2): string =>
  `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`.trim();

/** A string safe to use inside a translation key: `order.on-hold` and `cart/step2` become `order_on_hold` and `cart_step2`. */
export const autoKey = (topic: string): string => topic.replace(/[^a-zA-Z0-9]+/g, '_');

export interface AutomationGroup {
  /** Translation key under `ecom.autoGroups`. */
  key: 'lifecycle' | 'recovery' | 'marketing';
  topics: readonly string[];
}

/** The automations shown, grouped as WaDesk groups them. The API supports a few more topics that WaDesk does not show. */
export const AUTOMATION_GROUPS: Record<Kind, readonly AutomationGroup[]> = {
  shopify: [
    {
      key: 'lifecycle',
      topics: [
        'orders/create',
        'orders/paid',
        'orders/fulfilled',
        'order/delivered',
        'orders/cancelled',
        'refunds/create',
        'orders/updated',
      ],
    },
    {
      key: 'recovery',
      topics: [
        'checkouts/create',
        'cart/step2',
        'cart/step3',
        'cod/confirm',
        'cod/prepaid',
        'stock/back',
      ],
    },
    { key: 'marketing', topics: ['customers/create', 'customers/update', 'products/update'] },
  ],
  woocommerce: [
    {
      key: 'lifecycle',
      topics: [
        'order.created',
        'order.processing',
        'order.completed',
        'order.on-hold',
        'order.cancelled',
        'order.refunded',
      ],
    },
    {
      key: 'recovery',
      topics: [
        'cod/confirm',
        'cod/prepaid',
        'checkout.created',
        'cart/step2',
        'cart/step3',
        'stock/back',
        'subscription.payment_failed',
      ],
    },
    { key: 'marketing', topics: ['customer.created', 'review/reward'] },
  ],
};

/** The order fields a template's numbered variables can be filled from (Shopify's picker, as WaDesk). */
export const VAR_FIELDS = [
  'name',
  'first_name',
  'order_name',
  'order_number',
  'total',
  'total_price',
  'currency',
  'email',
  'store_name',
  'financial_status',
  'fulfillment_status',
] as const;

/** Delay choices in seconds, as each WaDesk screen offers them. Only the cart steps wait; the rest send at once. */
export const DELAYS: Record<Kind, readonly number[]> = {
  shopify: [0, 60, 300, 900, 3600, 86400],
  woocommerce: [0, 1800, 3600, 10800, 86400, 172800],
};

/** The templates the chosen sender can use: a Cloud API number its own account's templates, other engines their own, "auto" all. */
export function templatesFor(
  templates: readonly DashboardTemplate[],
  sender: DashboardSender | undefined,
): DashboardTemplate[] {
  if (!sender) return [...templates];
  if (sender.engine === 'waba') {
    const account = sender.key.slice('waba:'.length);
    return templates.filter((t) => t.engine === 'waba' && t.senderAccount === account);
  }
  if (sender.engine === 'baileys' || sender.engine === 'twilio')
    return templates.filter((t) => t.engine === sender.engine);
  return [...templates];
}

/** One automation as the form holds it. `varMap` is the comma-separated advanced field (WooCommerce) or the picked fields (Shopify). */
export interface AutomationDraft {
  eventType: string;
  isActive: boolean;
  templateUuid: string;
  varMap: string[];
  sendTo: 'customer' | 'admin' | 'both';
  adminNumber: string;
  delaySeconds: number;
}

/** The field list typed in the WooCommerce "advanced" box: comma separated, blanks dropped. */
export const parseVarCsv = (csv: string): string[] =>
  csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** The request body for one automation. A blank template is none; the admin number only travels when the admin is a recipient. */
export function toInput(d: AutomationDraft): AutomationInput {
  return {
    eventType: d.eventType,
    isActive: d.isActive,
    templateUuid: d.templateUuid === '' ? null : d.templateUuid,
    varMap: d.varMap.filter((v) => v !== ''),
    sendTo: d.sendTo,
    adminNumber:
      d.sendTo === 'customer' || d.adminNumber.trim() === '' ? null : d.adminNumber.trim(),
    delaySeconds: d.delaySeconds,
  };
}

/** What the page can tell before sending: an automation that is on needs a template. */
export const missingTemplate = (drafts: readonly AutomationDraft[]): string[] =>
  drafts.filter((d) => d.isActive && d.templateUuid === '').map((d) => d.eventType);

/** Bars for the revenue trend: 3 to 100 percent of the tallest day. */
export const barHeight = (value: number, max: number): number =>
  Math.min(100, Math.max(3, Math.round((value / Math.max(1, max)) * 100)));
