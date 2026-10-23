import {
  expenseGroupBySchema,
  expenseStatusFilterSchema,
  walletUsageKindSchema,
  type ExpenseGroupBy,
  type ExpenseStatusFilter,
  type WalletUsageKind,
} from '@crm/contracts';

export interface ExpenseFilters {
  status: ExpenseStatusFilter;
  from: string;
  to: string;
  template: string;
  source: string;
  category: string;
  /** What was billed (a message, an SMS, a call, an AI request...); empty = everything. */
  kind: WalletUsageKind | '';
  groupBy: ExpenseGroupBy;
}

export const EMPTY_EXPENSE_FILTERS: ExpenseFilters = {
  status: 'all',
  from: '',
  to: '',
  template: '',
  source: '',
  category: '',
  kind: '',
  groupBy: 'template',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface ParamReader {
  get(name: string): string | null;
}

/** The filters and the grouping in the page address. Anything unreadable is ignored, as the statement ignores an invalid date. */
export function parseExpenseFilters(params: ParamReader): ExpenseFilters {
  const status = expenseStatusFilterSchema.safeParse(params.get('status'));
  const groupBy = expenseGroupBySchema.safeParse(params.get('groupBy'));
  const kind = walletUsageKindSchema.safeParse(params.get('kind'));
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return {
    status: status.success ? status.data : 'all',
    from: DAY.test(from) ? from : '',
    to: DAY.test(to) ? to : '',
    template: (params.get('template') ?? '').trim().slice(0, 512),
    source: (params.get('source') ?? '').trim().slice(0, 24),
    category: (params.get('category') ?? '').trim().slice(0, 24),
    kind: kind.success ? kind.data : '',
    groupBy: groupBy.success ? groupBy.data : 'template',
  };
}

/** The filters the log and the summary take: only what is set. The grouping is not a filter, so it is not here. */
export function toExpenseApiQuery(f: ExpenseFilters): Record<string, string | undefined> {
  return {
    status: f.status === 'all' ? undefined : f.status,
    from: f.from || undefined,
    to: f.to || undefined,
    template: f.template.trim() || undefined,
    source: f.source.trim() || undefined,
    category: f.category.trim() || undefined,
    kind: f.kind || undefined,
  };
}

/** The address query string for the page, grouping included when it is not the default ("?status=free&groupBy=category"). */
export function toExpenseSearch(f: ExpenseFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(toExpenseApiQuery(f))) if (v) p.set(k, v);
  if (f.groupBy !== 'template') p.set('groupBy', f.groupBy);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** A range that ends before it starts matches nothing: the form says so instead of sending it. */
export const expenseRangeInverted = (f: ExpenseFilters): boolean =>
  Boolean(f.from && f.to && f.from > f.to);
