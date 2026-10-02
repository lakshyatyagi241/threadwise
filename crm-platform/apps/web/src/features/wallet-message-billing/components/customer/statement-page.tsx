'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { statementTypeSchema, type StatementResponse, type StatementRow } from '@crm/contracts';
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
import { formatMinor, formatNet } from '../../lib/money';
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
  const appliedKey = toSearch(applied);

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
          <FilterBar
            key={appliedKey}
            applied={applied}
            onApply={go}
            onReset={() => go(EMPTY_FILTERS)}
          />
          <StatementList key={appliedKey} filters={applied} />
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
          <StatementTable rows={d.data} currency={d.currency} />
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
        value={formatMinor(summary.currentBalanceMinor, currency, locale)}
        tone="accent"
      />
      <StatTile label={t('in')} value={formatMinor(summary.moneyInMinor, currency, locale)} />
      <StatTile label={t('out')} value={formatMinor(summary.moneyOutMinor, currency, locale)} />
      <StatTile
        label={t('net')}
        value={formatNet(summary.netMinor, currency, locale)}
        hint={t('count', { count: summary.count })}
      />
    </div>
  );
}

export function StatementTable({
  rows,
  currency,
}: {
  rows: readonly StatementRow[];
  currency: string;
}) {
  const t = useTranslations('wallet-message-billing.statement.columns');
  const locale = useLocale();
  const money = (minor: number) => formatMinor(minor, currency, locale);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm" aria-label={t('label')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('date')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('description')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('type')}
            </th>
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
                {formatWhen(r.createdAt, locale)}
              </td>
              <td className="px-2 py-2">
                <div>{r.description || humanizeSource(r.source)}</div>
                <ContextBlock row={r} />
              </td>
              <td className="px-2 py-2">
                <TypePill type={r.type} />
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2 text-end tabular-nums',
                  r.moneyInMinor > 0 && 'font-medium text-success',
                )}
              >
                {r.moneyInMinor > 0 ? money(r.moneyInMinor) : <span aria-label={t('none')}>-</span>}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2 text-end tabular-nums',
                  r.moneyOutMinor > 0 && 'font-medium text-danger',
                )}
              >
                {r.moneyOutMinor > 0 ? (
                  money(r.moneyOutMinor)
                ) : (
                  <span aria-label={t('none')}>-</span>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                {money(r.balanceAfterMinor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContextBlock({ row }: { row: StatementRow }) {
  const t = useTranslations('wallet-message-billing.statement.context');
  const tch = useTranslations('wallet-message-billing.statement.channels');
  const te = useTranslations('wallet-message-billing.statement.engines');
  const tcat = useTranslations('wallet-message-billing.categories');
  const c = row.context;
  return (
    <>
      {row.note && (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('reason')}: {row.note}
        </div>
      )}
      {c && (
        <>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {c.campaignName && <div>{c.campaignName}</div>}
            {c.recipient && (
              <div>
                {t('to')}: {c.recipient}
              </div>
            )}
            {c.template && (
              <div>
                {t('template')}: {c.template}
              </div>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {c.channel && (
              <Badge>{CHANNELS.includes(c.channel) ? tch(c.channel) : c.channel}</Badge>
            )}
            {c.country && <Badge>{c.country}</Badge>}
            {c.category && (
              <Badge>{CATEGORIES.includes(c.category) ? tcat(c.category) : c.category}</Badge>
            )}
            {c.engine && <Badge>{ENGINES.includes(c.engine) ? te(c.engine) : c.engine}</Badge>}
          </div>
        </>
      )}
    </>
  );
}
