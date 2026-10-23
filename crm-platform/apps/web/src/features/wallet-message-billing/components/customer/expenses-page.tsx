'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState, type FormEvent } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  expenseGroupBySchema,
  expenseStatusFilterSchema,
  type ExpenseDayGroup,
  walletUsageKindSchema,
  type ExpenseEvent,
  type ExpenseGroup,
  type ExpenseGroupBy,
  type ExpenseStatusFilter,
} from '@crm/contracts';
import { Badge, Button, Card, EmptyState, Field, Input, Select, StatTile, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, customerApi } from '../../api';
import { formatAmount, formatNet } from '../../lib/money';
import {
  EMPTY_EXPENSE_FILTERS,
  expenseRangeInverted,
  expenseSingleDay,
  parseExpenseFilters,
  toExpenseSearch,
  type ExpenseFilters,
} from '../../lib/expense-filters';
import { ErrorState, LoadingBlock, PermissionDenied } from '../state';
import { formatWhen } from './activity-table';
import { CATEGORIES, CHANNELS } from './statement-page';
import { PagerBar } from './pager-bar';
import { usePager } from './use-pager';

const EXPENSE_PAGE = 25;
/** The kinds whose count of units is worth a second line: segments of an SMS, minutes of a call. */
const UNIT_KINDS: ReadonlySet<ExpenseEvent['kind']> = new Set([
  'sms',
  'whatsapp_call',
  'voice_call',
]);
const DAY_PAGE = 14;
const STATUS_LABEL = {
  all: 'filters.statusAll',
  charged: 'filters.statusCharged',
  free: 'filters.statusFree',
  refunded: 'filters.statusRefunded',
} as const satisfies Record<ExpenseStatusFilter, string>;
type Channel = (typeof CHANNELS)[number];
type Category = (typeof CATEGORIES)[number];

/**
 * Where a charge that is not a campaign or chat message came from: an AI feature, a call, a reminder. Each has its own words in
 * `expenses.sources`; a source this list does not know is shown as it is stored.
 */
const EXTRA_SOURCES = [
  'lead_first',
  'lead',
  'test',
  'appointment',
  'lead_scoring',
  'lead_digest',
  'pql_search',
  'growth_assistant',
  'ai_copilot',
  'help_agent',
  'company_brief',
  'inbox_ai',
  'template_ai',
  'campaign_ai',
  'campaign_ai_image',
  'kb_embedding',
  'flow_ai',
  'widget_ai',
  'growth',
  'telephony',
  'translation',
] as const;
type ExtraSource = (typeof EXTRA_SOURCES)[number];
const extraSourceKey = (source: string): ExtraSource | null =>
  (EXTRA_SOURCES as readonly string[]).includes(source) ? (source as ExtraSource) : null;

/** The channel key a row carries, mapped to the label the statement already uses. The team inbox's own sends are "chat" to the customer. */
const channelKey = (source: string): Channel | null => {
  if (source === 'inbox') return 'chat';
  return (CHANNELS as readonly string[]).includes(source) ? (source as Channel) : null;
};

/** A charge's channel as the statement labels it; `notRecorded` when the charge has none. */
const channelLabel = (
  source: string | null,
  notRecorded: string,
  tch: (key: Channel) => string,
  tsrc: (key: ExtraSource) => string,
): string => {
  if (source === null) return notRecorded;
  const c = channelKey(source);
  if (c) return tch(c);
  const x = extraSourceKey(source);
  return x ? tsrc(x) : source;
};

/** A charge's pricing category as the statement labels it; `notRecorded` when the charge has none. */
const categoryLabel = (
  category: string | null,
  notRecorded: string,
  tcat: (key: Category) => string,
): string => {
  if (category === null) return notRecorded;
  return (CATEGORIES as readonly string[]).includes(category)
    ? tcat(category as Category)
    : category;
};

/** The badge tone of a message's status: a charge reads as a cost, a free message as good news. */
const statusTone = (status: ExpenseEvent['status']): 'danger' | 'success' | 'neutral' =>
  status === 'charged' ? 'danger' : status === 'free' ? 'success' : 'neutral';

/** A calendar day (`YYYY-MM-DD`) as the viewer's locale shows it. It is already the viewer's own day, so it is formatted in UTC, which cannot shift it. */
const formatDay = (day: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${day}T00:00:00Z`));

/** The customer's message expense log: what each message cost, with its template, and the cost of each group. */
export function ExpensesPage() {
  const t = useTranslations('wallet-message-billing.expenses');
  return (
    <div className="space-y-6">
      <nav aria-label={t('breadcrumbLabel')} className="text-sm text-muted-foreground">
        <Link href="/billing/wallet" className="hover:underline">
          {t('breadcrumbWallet')}
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{t('breadcrumbExpenses')}</span>
      </nav>
      <ExpensesBody />
    </div>
  );
}

function ExpensesBody() {
  const t = useTranslations('wallet-message-billing.expenses');
  const router = useRouter();
  const params = useSearchParams();
  const canRead = useCan('wallet.statement.read');
  const applied = parseExpenseFilters(params);

  const go = (f: ExpenseFilters) => router.push(`/billing/wallet/expenses${toExpenseSearch(f)}`);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/billing/wallet/statement">
            <Button variant="secondary" size="sm">
              {t('fullStatement')}
            </Button>
          </Link>
          <Link href="/billing/wallet">
            <Button variant="secondary" size="sm">
              {t('back')}
            </Button>
          </Link>
        </div>
      </header>
      {!canRead ? (
        <PermissionDenied permission="wallet.statement.read" />
      ) : (
        <>
          <FilterBar applied={applied} onApply={go} onReset={() => go(EMPTY_EXPENSE_FILTERS)} />
          <ExpenseSummary filters={applied} onGroupBy={(groupBy) => go({ ...applied, groupBy })} />
          <ExpenseDayLog
            filters={applied}
            onViewDay={(day) => go({ ...applied, from: day, to: day })}
          />
          <ExpenseLog
            filters={applied}
            onShowAllDays={() => go({ ...applied, from: '', to: '' })}
          />
        </>
      )}
    </>
  );
}

function FilterBar({
  applied,
  onApply,
  onReset,
}: {
  applied: ExpenseFilters;
  onApply: (f: ExpenseFilters) => void;
  onReset: () => void;
}) {
  const t = useTranslations('wallet-message-billing.expenses.filters');
  const tt = useTranslations('wallet-message-billing.expenses');
  const tk = useTranslations('wallet-message-billing.kinds');
  const tch = useTranslations('wallet-message-billing.statement.channels');
  const tcat = useTranslations('wallet-message-billing.categories');
  const [draft, setDraft] = useState<ExpenseFilters>(applied);
  // The address changed (Apply, Reset, back/forward): the form follows it in place, as the statement's filter bar does.
  const appliedKey = toExpenseSearch(applied);
  const [seenKey, setSeenKey] = useState(appliedKey);
  if (seenKey !== appliedKey) {
    setSeenKey(appliedKey);
    setDraft(applied);
  }
  const inverted = expenseRangeInverted(draft);
  const set = <K extends keyof ExpenseFilters>(k: K, v: ExpenseFilters[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!inverted) onApply({ ...draft, template: draft.template.trim() });
  };

  return (
    <Card>
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
        role="search"
      >
        <Field label={t('status')} htmlFor="ex-status">
          <Select
            id="ex-status"
            value={draft.status}
            onChange={(e) => {
              const v = expenseStatusFilterSchema.safeParse(e.target.value);
              if (v.success) set('status', v.data);
            }}
          >
            {expenseStatusFilterSchema.options.map((s) => (
              <option key={s} value={s}>
                {tt(STATUS_LABEL[s])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('kind')} htmlFor="ex-kind">
          <Select
            id="ex-kind"
            value={draft.kind}
            onChange={(e) => {
              const v = walletUsageKindSchema.safeParse(e.target.value);
              set('kind', v.success ? v.data : '');
            }}
          >
            <option value="">{t('allKinds')}</option>
            {walletUsageKindSchema.options.map((k) => (
              <option key={k} value={k}>
                {tk(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('channel')} htmlFor="ex-channel">
          <Select
            id="ex-channel"
            value={draft.source}
            onChange={(e) => set('source', e.target.value)}
          >
            <option value="">{t('allChannels')}</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {tch(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('category')} htmlFor="ex-category">
          <Select
            id="ex-category"
            value={draft.category}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">{t('allCategories')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tcat(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('template')} htmlFor="ex-template">
          <Input
            id="ex-template"
            type="search"
            maxLength={512}
            placeholder={t('templatePlaceholder')}
            value={draft.template}
            onChange={(e) => set('template', e.target.value)}
          />
        </Field>
        <Field label={t('from')} htmlFor="ex-from">
          <Input
            id="ex-from"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => set('from', e.target.value)}
          />
        </Field>
        <Field label={t('to')} htmlFor="ex-to" error={inverted ? t('rangeInverted') : undefined}>
          <Input
            id="ex-to"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            invalid={inverted}
            onChange={(e) => set('to', e.target.value)}
          />
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6 lg:justify-end">
          <Button type="submit" disabled={inverted}>
            {t('apply')}
          </Button>
          <Button variant="secondary" onClick={onReset}>
            {t('reset')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ExpenseSummary({
  filters,
  onGroupBy,
}: {
  filters: ExpenseFilters;
  onGroupBy: (groupBy: ExpenseGroupBy) => void;
}) {
  const t = useTranslations('wallet-message-billing.expenses');
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const q = useQuery({
    queryKey: KEYS.expenseSummary(filters, timeZone),
    queryFn: ({ signal }) => customerApi.expenseSummary(filters, timeZone, signal),
    placeholderData: keepPreviousData,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const { totals } = d;
  const money = (minor: number, exact?: string) => formatAmount(minor, exact, d.currency, locale);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label={t('summary.messages')} value={String(totals.messages)} />
        <StatTile
          label={t('summary.charged')}
          value={money(totals.chargedMinor, totals.chargedExact)}
        />
        <StatTile
          label={t('summary.refunded')}
          value={money(totals.refundedMinor, totals.refundedExact)}
        />
        <StatTile
          label={t('summary.net')}
          value={formatNet(totals.netMinor, d.currency, locale, totals.netExact)}
          tone="accent"
        />
        <StatTile label={t('summary.notBilled')} value={String(totals.free)} />
      </div>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t('breakdown.title')}</h2>
          <GroupByToggle value={d.groupBy} onChange={onGroupBy} />
        </div>
        <GroupTable groups={d.groups} groupBy={d.groupBy} currency={d.currency} />
        {d.truncated && (
          <p className="text-xs text-muted-foreground">
            {t('breakdown.truncated', { count: d.groups.length })}
          </p>
        )}
      </Card>
    </>
  );
}

const GROUP_BY_OPTIONS = expenseGroupBySchema.options;

function GroupByToggle({
  value,
  onChange,
}: {
  value: ExpenseGroupBy;
  onChange: (groupBy: ExpenseGroupBy) => void;
}) {
  const t = useTranslations('wallet-message-billing.expenses.breakdown.groupBy');
  return (
    <div role="group" className="flex flex-wrap gap-1">
      {GROUP_BY_OPTIONS.map((g) => (
        <Button
          key={g}
          size="sm"
          variant={g === value ? 'primary' : 'secondary'}
          aria-pressed={g === value}
          onClick={() => onChange(g)}
        >
          {t(g)}
        </Button>
      ))}
    </div>
  );
}

export function GroupTable({
  groups,
  groupBy,
  currency,
}: {
  groups: readonly ExpenseGroup[];
  groupBy: ExpenseGroupBy;
  currency: string;
}) {
  const t = useTranslations('wallet-message-billing.expenses');
  const locale = useLocale();
  const tch = useTranslations('wallet-message-billing.statement.channels');
  const tcat = useTranslations('wallet-message-billing.categories');
  const tk = useTranslations('wallet-message-billing.kinds');
  const tsrc = useTranslations('wallet-message-billing.expenses.sources');
  const money = (minor: number, exact?: string) => formatAmount(minor, exact, currency, locale);
  const label = (key: string | null): string => {
    if (groupBy === 'kind') {
      if (key === null) return t('breakdown.notRecorded');
      const k = walletUsageKindSchema.safeParse(key);
      return k.success ? tk(k.data) : key;
    }
    if (groupBy === 'source') return channelLabel(key, t('breakdown.notRecorded'), tch, tsrc);
    if (groupBy === 'category') return categoryLabel(key, t('breakdown.notRecorded'), tcat);
    return key ?? t('breakdown.notRecorded');
  };
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('breakdown.empty')}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm" aria-label={t('breakdown.title')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('breakdown.group')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('columns.messages')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('columns.charged')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('columns.refunded')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('columns.net')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('columns.notBilled')}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={g.key ?? `none-${i}`} className="border-b border-border/60 last:border-0">
              <td className={cn('px-2 py-2 align-top', g.key === null && 'text-muted-foreground')}>
                {label(g.key)}
              </td>
              <td className="px-2 py-2 text-end tabular-nums">{g.messages}</td>
              <td className="px-2 py-2 text-end tabular-nums">
                {money(g.chargedMinor, g.chargedExact)}
              </td>
              <td className="px-2 py-2 text-end tabular-nums">
                {money(g.refundedMinor, g.refundedExact)}
              </td>
              <td className="px-2 py-2 text-end tabular-nums">
                {formatNet(g.netMinor, currency, locale, g.netExact)}
              </td>
              <td className="px-2 py-2 text-end tabular-nums">{g.free}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseLog({
  filters,
  onShowAllDays,
}: {
  filters: ExpenseFilters;
  onShowAllDays: () => void;
}) {
  const t = useTranslations('wallet-message-billing.expenses');
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const pager = usePager();
  // A new filter set starts again at the first page.
  const filtersKey = toExpenseSearch(filters);
  const [seenFilters, setSeenFilters] = useState(filtersKey);
  if (seenFilters !== filtersKey) {
    setSeenFilters(filtersKey);
    pager.reset();
  }
  const q = useQuery({
    queryKey: KEYS.expenses(filters, timeZone, pager.cursor),
    queryFn: ({ signal }) =>
      customerApi.expenses(filters, timeZone, pager.cursor, EXPENSE_PAGE, signal),
    placeholderData: keepPreviousData,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (d.data.length === 0 && !pager.hasPrev) {
    return (
      <EmptyState
        title={t('emptyTitle')}
        message={toExpenseSearch(filters) ? t('emptyFiltered') : t('emptyBody')}
      />
    );
  }
  const day = expenseSingleDay(filters);
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {day ? t('log.forDay', { date: formatDay(day, locale) }) : t('log.title')}
        </h2>
        {day && (
          <Button size="sm" variant="secondary" onClick={onShowAllDays}>
            {t('log.showAllDays')}
          </Button>
        )}
      </div>
      <ExpenseTable rows={d.data} currency={d.currency} />
      {(pager.hasPrev || d.page.hasMore) && (
        <PagerBar
          page={pager.page}
          hasPrev={pager.hasPrev}
          hasNext={d.page.hasMore && d.page.nextCursor !== null}
          busy={q.isPlaceholderData}
          onPrev={pager.prev}
          onNext={() => d.page.nextCursor && pager.next(d.page.nextCursor)}
        />
      )}
    </Card>
  );
}

/**
 * The day log: one line per day, type, status, channel and category, so a day of repeated messages reads as a few lines. "View details"
 * opens that day's messages in the log below. Pages by day, so a day's lines are never split across two pages.
 */
function ExpenseDayLog({
  filters,
  onViewDay,
}: {
  filters: ExpenseFilters;
  onViewDay: (day: string) => void;
}) {
  const t = useTranslations('wallet-message-billing.expenses');
  const timeZone = useTimeZone() ?? 'UTC';
  const pager = usePager();
  // A new filter set starts again at the newest day.
  const filtersKey = toExpenseSearch(filters);
  const [seenFilters, setSeenFilters] = useState(filtersKey);
  if (seenFilters !== filtersKey) {
    setSeenFilters(filtersKey);
    pager.reset();
  }
  const q = useQuery({
    queryKey: KEYS.expenseDays(filters, timeZone, pager.cursor),
    queryFn: ({ signal }) =>
      customerApi.expenseDays(filters, timeZone, pager.cursor, DAY_PAGE, signal),
    placeholderData: keepPreviousData,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  // Nothing to group: the message log below shows the empty state and why.
  if (d.data.length === 0 && !pager.hasPrev) return null;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('days.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('days.subtitle')}</p>
      </div>
      <DayTable groups={d.data} currency={d.currency} onViewDay={onViewDay} />
      {(pager.hasPrev || d.page.hasMore) && (
        <PagerBar
          page={pager.page}
          hasPrev={pager.hasPrev}
          hasNext={d.page.hasMore && d.page.nextCursor !== null}
          busy={q.isPlaceholderData}
          onPrev={pager.prev}
          onNext={() => d.page.nextCursor && pager.next(d.page.nextCursor)}
        />
      )}
    </Card>
  );
}

export function DayTable({
  groups,
  currency,
  onViewDay,
}: {
  groups: readonly ExpenseDayGroup[];
  currency: string;
  onViewDay: (day: string) => void;
}) {
  const t = useTranslations('wallet-message-billing.expenses');
  const locale = useLocale();
  const tch = useTranslations('wallet-message-billing.statement.channels');
  const tsrc = useTranslations('wallet-message-billing.expenses.sources');
  const tcat = useTranslations('wallet-message-billing.categories');
  const tk = useTranslations('wallet-message-billing.kinds');
  const tstatus = useTranslations('wallet-message-billing.expenses.status');
  const money = (minor: number, exact?: string) => formatAmount(minor, exact, currency, locale);
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('days.empty')}</p>;
  }
  // The API sends each day's lines together, newest day first; a Map keeps that order.
  const byDay = new Map<string, ExpenseDayGroup[]>();
  for (const g of groups) byDay.set(g.day, [...(byDay.get(g.day) ?? []), g]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] text-sm" aria-label={t('days.title')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {(
              [
                ['date', 'text-start'],
                ['type', 'text-start'],
                ['status', 'text-start'],
                ['channel', 'text-start'],
                ['category', 'text-start'],
                ['messages', 'text-end'],
                ['charged', 'text-end'],
                ['refunded', 'text-end'],
                ['net', 'text-end'],
              ] as const
            ).map(([c, align]) => (
              <th key={c} scope="col" className={cn('px-2 py-2 font-medium', align)}>
                {t(`columns.${c}`)}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-end font-medium">
              <span className="sr-only">{t('days.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...byDay].map(([day, rows]) => (
            <Fragment key={day}>
              <tr className="border-b border-border bg-muted/40">
                <th
                  scope="rowgroup"
                  className="whitespace-nowrap px-2 py-2 text-start font-semibold"
                >
                  {formatDay(day, locale)}
                </th>
                <td colSpan={8} className="px-2 py-2 text-muted-foreground">
                  {t('days.messagesOnDay', { count: rows.reduce((n, r) => n + r.messages, 0) })}
                </td>
                <td className="px-2 py-2 text-end">
                  <Button size="sm" variant="secondary" onClick={() => onViewDay(day)}>
                    {t('days.viewDetails')}
                  </Button>
                </td>
              </tr>
              {rows.map((r) => (
                <tr
                  key={`${r.kind}-${r.status}-${r.source ?? ''}-${r.category ?? ''}`}
                  className="border-b border-border/60 align-top last:border-0"
                >
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2">{tk(r.kind)}</td>
                  <td className="px-2 py-2">
                    <Badge tone={statusTone(r.status)}>{tstatus(r.status)}</Badge>
                  </td>
                  <td className={cn('px-2 py-2', r.source === null && 'text-muted-foreground')}>
                    {channelLabel(r.source, t('breakdown.notRecorded'), tch, tsrc)}
                  </td>
                  <td className={cn('px-2 py-2', r.category === null && 'text-muted-foreground')}>
                    {categoryLabel(r.category, t('breakdown.notRecorded'), tcat)}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">{r.messages}</td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {money(r.chargedMinor, r.chargedExact)}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {money(r.refundedMinor, r.refundedExact)}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {formatNet(r.netMinor, currency, locale, r.netExact)}
                  </td>
                  <td className="px-2 py-2" />
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExpenseTable({
  rows,
  currency,
}: {
  rows: readonly ExpenseEvent[];
  currency: string;
}) {
  const t = useTranslations('wallet-message-billing.expenses');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const tch = useTranslations('wallet-message-billing.statement.channels');
  const tcat = useTranslations('wallet-message-billing.categories');
  const tstatus = useTranslations('wallet-message-billing.expenses.status');
  const tfree = useTranslations('wallet-message-billing.expenses.freeReason');
  const tk = useTranslations('wallet-message-billing.kinds');
  const tu = useTranslations('wallet-message-billing.expenses.units');
  const tsrc = useTranslations('wallet-message-billing.expenses.sources');
  const money = (minor: number, exact?: string) => formatAmount(minor, exact, currency, locale);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[66rem] text-sm" aria-label={t('title')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {(
              [
                ['date', 'text-start'],
                ['type', 'text-start'],
                ['template', 'text-start'],
                ['campaign', 'text-start'],
                ['channel', 'text-start'],
                ['category', 'text-start'],
                ['country', 'text-start'],
                ['status', 'text-start'],
                ['charged', 'text-end'],
                ['refunded', 'text-end'],
                ['net', 'text-end'],
              ] as const
            ).map(([c, align]) => (
              <th key={c} scope="col" className={cn('px-2 py-2 font-medium', align)}>
                {t(`columns.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            return (
              <tr key={r.id} className="border-b border-border/60 align-top last:border-0">
                <td className="px-2 py-2 whitespace-nowrap">
                  {formatWhen(r.createdAt, locale, timeZone)}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col">
                    <span>{tk(r.kind)}</span>
                    {UNIT_KINDS.has(r.kind) && (
                      <span className="text-xs text-muted-foreground">
                        {tu(r.kind, { count: r.units })}
                      </span>
                    )}
                  </div>
                </td>
                <td className={cn('px-2 py-2', r.template === null && 'text-muted-foreground')}>
                  {r.template ?? t('breakdown.notRecorded')}
                </td>
                <td className={cn('px-2 py-2', r.subjectName === null && 'text-muted-foreground')}>
                  {r.subjectName ?? t('breakdown.notRecorded')}
                </td>
                <td className="px-2 py-2">
                  {channelLabel(r.source, t('breakdown.notRecorded'), tch, tsrc)}
                </td>
                <td className="px-2 py-2">
                  {categoryLabel(r.category, t('breakdown.notRecorded'), tcat)}
                </td>
                <td className="px-2 py-2">{r.country ?? t('breakdown.notRecorded')}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1">
                    <Badge tone={statusTone(r.status)}>{tstatus(r.status)}</Badge>
                    {r.status === 'free' && r.freeReason && (
                      <span className="text-xs text-muted-foreground">{tfree(r.freeReason)}</span>
                    )}
                    {r.status === 'refunded' && r.refundedAt && (
                      <span className="text-xs text-muted-foreground">
                        {tstatus('refundedOn', {
                          date: formatWhen(r.refundedAt, locale, timeZone),
                        })}
                      </span>
                    )}
                    {r.uncollectedMinor > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t('uncollected', { amount: money(r.uncollectedMinor) })}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-2 text-end tabular-nums">
                  {money(r.chargedMinor, r.chargedExact)}
                </td>
                <td className="px-2 py-2 text-end tabular-nums">
                  {money(r.refundedMinor, r.refundedExact)}
                </td>
                <td className="px-2 py-2 text-end tabular-nums">
                  {formatNet(r.netMinor, currency, locale, r.netExact)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
