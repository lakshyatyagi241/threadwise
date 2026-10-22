'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  statementTypeSchema,
  type StatementDetailColumn,
  type StatementResponse,
  type StatementRow,
} from '@crm/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  StatTile,
  ToastProvider,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, customerApi, downloadStatementCsv } from '../../api';
import { humanizeSource } from '../../lib/billing-variant';
import { saveBlob } from '../../lib/download';
import { errorKind } from '../../lib/errors';
import { formatAmount, formatNet } from '../../lib/money';
import {
  EMPTY_FILTERS,
  hasFilters,
  parseFilters,
  rangeInverted,
  toSearch,
  type StatementFilters,
} from '../../lib/statement-filters';
import { ErrorState, LoadingBlock, PermissionDenied } from '../state';
import { formatWhen } from './activity-table';
import { PagerBar } from './pager-bar';
import { TypePill } from './type-pill';
import { usePager } from './use-pager';

const STATEMENT_PAGE = 25;
const CHANNELS = ['campaign', 'broadcast', 'flow', 'scheduled', 'auto_reply', 'chat', 'api'];
const ENGINES = ['waba', 'baileys', 'twilio'];
const CATEGORIES = ['marketing', 'utility', 'authentication', 'service'];

/** The full ledger: totals over the whole filtered set, filters kept in the address, per-message detail, CSV export. */
export function StatementPage() {
  const t = useTranslations('wallet-message-billing.statement');
  const tc = useTranslations('wallet-message-billing.common');
  return (
    <ToastProvider dismissLabel={tc('dismiss')}>
      <div className="space-y-6">
        <nav aria-label={t('breadcrumbLabel')} className="text-sm text-muted-foreground">
          <Link href="/billing/wallet" className="hover:underline">
            {t('breadcrumbWallet')}
          </Link>
          <span aria-hidden="true"> / </span>
          <span>{t('breadcrumbStatement')}</span>
        </nav>
        <StatementBody />
      </div>
    </ToastProvider>
  );
}

function StatementBody() {
  const t = useTranslations('wallet-message-billing.statement');
  const router = useRouter();
  const params = useSearchParams();
  const canRead = useCan('wallet.statement.read');
  const applied = parseFilters(params);

  const go = (f: StatementFilters) => router.push(`/billing/wallet/statement${toSearch(f)}`);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/billing/wallet">
            <Button variant="secondary" size="sm">
              {t('back')}
            </Button>
          </Link>
          <ExportButton filters={applied} />
        </div>
      </header>
      {!canRead ? (
        <PermissionDenied permission="wallet.statement.read" />
      ) : (
        <>
          <FilterBar applied={applied} onApply={go} onReset={() => go(EMPTY_FILTERS)} />
          <StatementList filters={applied} />
        </>
      )}
    </>
  );
}

function ExportButton({ filters }: { filters: StatementFilters }) {
  const t = useTranslations('wallet-message-billing.statement');
  const te = useTranslations('wallet-message-billing.errors');
  const toast = useToast();
  const canExport = useCan('wallet.statement.export');
  const exporter = useMutation({
    mutationFn: () => downloadStatementCsv(filters),
    onSuccess: ({ blob, fileName }) => {
      saveBlob(blob, fileName);
      toast.toast(t('exported', { fileName }), 'success');
    },
    onError: (err) => toast.toast(te(errorKind(err)), 'danger'),
  });
  if (!canExport) return null;
  return (
    <Button size="sm" onClick={() => exporter.mutate()} disabled={exporter.isPending}>
      {exporter.isPending && <Spinner label={t('exporting')} />}
      {t('export')}
    </Button>
  );
}

function FilterBar({
  applied,
  onApply,
  onReset,
}: {
  applied: StatementFilters;
  onApply: (f: StatementFilters) => void;
  onReset: () => void;
}) {
  const t = useTranslations('wallet-message-billing.statement.filters');
  const tt = useTranslations('wallet-message-billing.statement.typeFilter');
  const [draft, setDraft] = useState<StatementFilters>(applied);
  // The address changed (Apply, Reset, back/forward): the form follows it in place. It is never remounted, so there is one form.
  const appliedKey = toSearch(applied);
  const [seenKey, setSeenKey] = useState(appliedKey);
  if (seenKey !== appliedKey) {
    setSeenKey(appliedKey);
    setDraft(applied);
  }
  const inverted = rangeInverted(draft);
  const set = <K extends keyof StatementFilters>(k: K, v: StatementFilters[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!inverted) onApply({ ...draft, q: draft.q.trim() });
  };

  return (
    <Card>
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
        role="search"
      >
        <Field label={t('type')} htmlFor="st-type">
          <Select
            id="st-type"
            value={draft.type}
            onChange={(e) => {
              const v = statementTypeSchema.safeParse(e.target.value);
              if (v.success) set('type', v.data);
            }}
          >
            {statementTypeSchema.options.map((o) => (
              <option key={o} value={o}>
                {tt(o)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('from')} htmlFor="st-from">
          <Input
            id="st-from"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => set('from', e.target.value)}
          />
        </Field>
        <Field label={t('to')} htmlFor="st-to" error={inverted ? t('rangeInverted') : undefined}>
          <Input
            id="st-to"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            invalid={inverted}
            onChange={(e) => set('to', e.target.value)}
          />
        </Field>
        <Field label={t('search')} htmlFor="st-q">
          <Input
            id="st-q"
            type="search"
            maxLength={120}
            placeholder={t('searchPlaceholder')}
            value={draft.q}
            onChange={(e) => set('q', e.target.value)}
          />
        </Field>
        <div className="flex items-end gap-2">
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

function StatementList({ filters }: { filters: StatementFilters }) {
  const t = useTranslations('wallet-message-billing.statement');
  const pager = usePager();
  // A new filter set starts again at the first page.
  const filtersKey = toSearch(filters);
  const [seenFilters, setSeenFilters] = useState(filtersKey);
  if (seenFilters !== filtersKey) {
    setSeenFilters(filtersKey);
    pager.reset();
  }
  const q = useQuery({
    queryKey: KEYS.statement(filters, pager.cursor),
    queryFn: ({ signal }) => customerApi.statement(filters, pager.cursor, STATEMENT_PAGE, signal),
    placeholderData: keepPreviousData,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <>
      <SummaryCards data={d} />
      {d.data.length === 0 && !pager.hasPrev ? (
        <EmptyState
          title={t('emptyTitle')}
          message={hasFilters(filters) ? t('emptyFiltered') : t('emptyNone')}
        />
      ) : (
        <Card className="space-y-2">
          <StatementTable rows={d.data} currency={d.currency} detailColumns={d.detailColumns} />
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
      )}
    </>
  );
}

export function SummaryCards({ data }: { data: Pick<StatementResponse, 'summary' | 'currency'> }) {
  const t = useTranslations('wallet-message-billing.statement.summary');
  const locale = useLocale();
  const { summary, currency } = data;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label={t('balance')}
        value={formatAmount(
          summary.currentBalanceMinor,
          summary.currentBalanceExact,
          currency,
          locale,
        )}
        tone="accent"
      />
      <StatTile
        label={t('in')}
        value={formatAmount(summary.moneyInMinor, summary.moneyInExact, currency, locale)}
      />
      <StatTile
        label={t('out')}
        value={formatAmount(summary.moneyOutMinor, summary.moneyOutExact, currency, locale)}
      />
      <StatTile
        label={t('net')}
        value={formatNet(summary.netMinor, currency, locale, summary.netExact)}
        hint={t('count', { count: summary.count })}
      />
    </div>
  );
}

/** A column holds money when the exact figure has a non-zero digit (a charge under one cent still counts). */
const hasMoney = (minor: number, exact: string | undefined): boolean =>
  exact ? /[1-9]/.test(exact) : minor > 0;

/**
 * The statement's columns are the CSV's columns, in the CSV's order. An optional column (channel, recipient, template, country,
 * category, engine) is here only when some row of the filtered set has a value in it: `detailColumns` comes from the server.
 */
export function StatementTable({
  rows,
  currency,
  detailColumns,
}: {
  rows: readonly StatementRow[];
  currency: string;
  detailColumns: readonly StatementDetailColumn[];
}) {
  const t = useTranslations('wallet-message-billing.statement.columns');
  const tctx = useTranslations('wallet-message-billing.statement.context');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const money = (minor: number, exact?: string) => formatAmount(minor, exact, currency, locale);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm" aria-label={t('label')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('date')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('type')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('description')}
            </th>
            {detailColumns.map((c) => (
              <th key={c} scope="col" className="px-2 py-2 text-start font-medium">
                {t(c)}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('in')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('out')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('balance')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border align-top last:border-0">
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {formatWhen(r.createdAt, locale, timeZone)}
              </td>
              <td className="px-2 py-2">
                <TypePill type={r.type} />
              </td>
              <td className="px-2 py-2">
                <div>{r.description || humanizeSource(r.source)}</div>
                {r.note && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {tctx('reason')}: {r.note}
                  </div>
                )}
              </td>
              {detailColumns.map((c) => (
                <td key={c} className="px-2 py-2">
                  <DetailCell column={c} row={r} />
                </td>
              ))}
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2 text-end tabular-nums',
                  hasMoney(r.moneyInMinor, r.moneyInExact) && 'font-medium text-success',
                )}
              >
                {hasMoney(r.moneyInMinor, r.moneyInExact) ? (
                  money(r.moneyInMinor, r.moneyInExact)
                ) : (
                  <span aria-label={t('none')}>-</span>
                )}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2 text-end tabular-nums',
                  hasMoney(r.moneyOutMinor, r.moneyOutExact) && 'font-medium text-danger',
                )}
              >
                {hasMoney(r.moneyOutMinor, r.moneyOutExact) ? (
                  money(r.moneyOutMinor, r.moneyOutExact)
                ) : (
                  <span aria-label={t('none')}>-</span>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                {money(r.balanceAfterMinor, r.balanceAfterExact)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One optional column of a row, with the values the CSV writes. A blank cell reads as none, as the money columns do. */
function DetailCell({ column, row }: { column: StatementDetailColumn; row: StatementRow }) {
  const t = useTranslations('wallet-message-billing.statement.columns');
  const tch = useTranslations('wallet-message-billing.statement.channels');
  const te = useTranslations('wallet-message-billing.statement.engines');
  const tcat = useTranslations('wallet-message-billing.categories');
  const c = row.context;
  const none = <span aria-label={t('none')}>-</span>;
  if (!c) return none;
  if (column === 'channel') {
    if (!c.channel && !c.campaignName) return none;
    return (
      <div className="space-y-1">
        {c.channel && <Badge>{CHANNELS.includes(c.channel) ? tch(c.channel) : c.channel}</Badge>}
        {c.campaignName && <div className="text-xs text-muted-foreground">{c.campaignName}</div>}
      </div>
    );
  }
  if (column === 'recipient') return c.recipient ? <span>{c.recipient}</span> : none;
  if (column === 'template') return c.template ? <span>{c.template}</span> : none;
  if (column === 'country') return c.country ? <Badge>{c.country}</Badge> : none;
  if (column === 'category') {
    if (!c.category) return none;
    return <Badge>{CATEGORIES.includes(c.category) ? tcat(c.category) : c.category}</Badge>;
  }
  if (!c.engine) return none;
  return <Badge>{ENGINES.includes(c.engine) ? te(c.engine) : c.engine}</Badge>;
}
