'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { REFERRAL_RANGES, type ReferralBucket, type ReferralListResponse } from '@crm/contracts';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Tabs,
  ToastProvider,
  useToast,
} from '@crm/ui';
import { copyText } from '@/features/auth-registration-security/shared/clipboard';
import { KEYS, downloadReferralsCsv, fetchReferrals } from '../../api';
import {
  SEARCH_DEBOUNCE_MS,
  buildListQuery,
  chartData,
  copyReferralLink,
  createDebouncer,
  currentCursor,
  FIRST_PAGE,
  hasSearch,
  initialFilters,
  money,
  pageIndexOf,
  popCursor,
  pushCursor,
  runExport,
  shownRange,
  withRange,
  type AffiliateFilters,
  type CursorStack,
} from '../../lib/affiliate';
import { saveBlob } from '../../lib/download';
import {
  AffiliateSkeleton,
  ErrorState,
  KpiStrip,
  Payouts,
  ReferralsTable,
  ShareHeader,
  TableFooter,
  TopCodes,
} from './parts';
import { VolumeChart } from './volume-chart';

const NS = 'coupons-credits-referral-currency.affiliate';
const BUCKETS: readonly ReferralBucket[] = ['daily', 'weekly', 'monthly'];

/** The Affiliate pane of the account hub (TW-CPN-035..037): Reference's account tab and its history page as one screen. */
export function AffiliatePage() {
  const t = useTranslations(`${NS}.common`);
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <AffiliateScreen />
    </ToastProvider>
  );
}

function AffiliateScreen() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const toast = useToast();
  const [filters, setFilters] = useState<AffiliateFilters>(initialFilters);
  const [searchText, setSearchText] = useState('');
  const [stack, setStack] = useState<CursorStack>(FIRST_PAGE);
  const [now] = useState(() => Date.now());

  // Typing waits a moment before it is sent; every change of what is listed starts again from the first page.
  const debouncer = useMemo(
    () =>
      createDebouncer<string>(SEARCH_DEBOUNCE_MS, (q) => {
        setFilters((f) => (f.q === q.trim() ? f : { ...f, q: q.trim() }));
        setStack(FIRST_PAGE);
      }),
    [],
  );
  useEffect(() => () => debouncer.cancel(), [debouncer]);

  const query = buildListQuery(filters, currentCursor(stack));
  const list = useQuery({
    queryKey: KEYS.affiliateList(query),
    queryFn: ({ signal }) => fetchReferrals(query, signal),
    placeholderData: keepPreviousData,
    // a failure shows its error state (with Retry) at once, not after the client's backoff
    retry: false,
  });

  const exporter = useMutation({
    mutationFn: () =>
      runExport(filters.range, {
        download: downloadReferralsCsv,
        save: saveBlob,
        notify: (kind, detail) =>
          toast.toast(
            kind === 'exported'
              ? t('filters.exported', { fileName: detail })
              : t(`errors.${detail}`),
            kind === 'exported' ? 'success' : 'danger',
          ),
      }),
  });

  const copy = () =>
    void copyReferralLink(list.data?.link ?? '', {
      copy: copyText,
      notify: (kind) => toast.toast(t(`header.${kind}`), kind === 'copied' ? 'success' : 'danger'),
    });

  const changeRange = (range: AffiliateFilters['range']) => {
    setFilters((f) => withRange(f, range));
    setStack(FIRST_PAGE);
  };
  const changeBucket = (bucket: ReferralBucket) => setFilters((f) => ({ ...f, bucket }));
  const reset = () => {
    debouncer.cancel();
    setSearchText('');
    setFilters((f) => ({ ...f, q: '' }));
    setStack(FIRST_PAGE);
  };
  const onSearch = (text: string) => {
    setSearchText(text);
    debouncer.push(text);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      {list.isPending ? (
        <AffiliateSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <AffiliateView
          data={list.data}
          locale={locale}
          now={now}
          filters={filters}
          searchText={searchText}
          pageIndex={pageIndexOf(stack)}
          busy={list.isPlaceholderData}
          exporting={exporter.isPending}
          onCopy={copy}
          onRange={changeRange}
          onBucket={changeBucket}
          onSearch={onSearch}
          onReset={reset}
          onExport={() => exporter.mutate()}
          onPrev={() => setStack(popCursor)}
          onNext={() => {
            const next = list.data.page.nextCursor;
            if (next) setStack((s) => pushCursor(s, next));
          }}
        />
      )}
    </div>
  );
}

export interface AffiliateViewProps {
  data: ReferralListResponse;
  locale: string;
  now: number;
  filters: AffiliateFilters;
  searchText: string;
  pageIndex: number;
  busy: boolean;
  exporting: boolean;
  onCopy: () => void;
  onRange: (range: AffiliateFilters['range']) => void;
  onBucket: (bucket: ReferralBucket) => void;
  onSearch: (text: string) => void;
  onReset: () => void;
  onExport: () => void;
  onPrev: () => void;
  onNext: () => void;
}

/** Everything the screen draws once there is an answer. Plain props in, markup out. */
export function AffiliateView(p: AffiliateViewProps) {
  const t = useTranslations(NS);
  const { data, filters } = p;
  const fmt = (minor: number) => money(minor, data.currency, p.locale);
  const chart = chartData(data.volume, filters.bucket, p.locale);
  const range = shownRange(p.pageIndex, data.page.limit, data.data.length, data.page.total);
  const noneAtAll =
    data.data.length === 0 && !hasSearch(filters) && data.stats.signupsLifetime === 0;

  const chartBody =
    data.volume.length === 0 || chart.signups.every((n) => n === 0) ? (
      <p className="py-10 text-center text-sm text-muted-foreground">{t('chart.empty')}</p>
    ) : (
      <VolumeChart data={chart} label={t('chart.label')} formatMoney={fmt} />
    );

  return (
    <div className="space-y-6" aria-busy={p.busy}>
      <ShareHeader data={data} locale={p.locale} onCopy={p.onCopy} />

      <section aria-label={t('filters.label')} className="flex flex-wrap items-end gap-3">
        <Field label={t('filters.range')} htmlFor="aff-range" className="w-48">
          <Select
            id="aff-range"
            value={filters.range}
            onChange={(e) => {
              const next = REFERRAL_RANGES.find((r) => r === e.target.value);
              if (next) p.onRange(next);
            }}
          >
            {REFERRAL_RANGES.map((r) => (
              <option key={r} value={r}>
                {t(`filters.ranges.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="ms-auto">
          <Button variant="secondary" onClick={p.onExport} disabled={p.exporting}>
            {p.exporting && <Spinner label={t('filters.exporting')} />}
            {t('filters.export')}
          </Button>
        </div>
      </section>

      <KpiStrip data={data} locale={p.locale} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-2 lg:col-span-2">
          <h2 className="text-sm font-semibold">{t('chart.title')}</h2>
          <Tabs
            value={filters.bucket}
            onValueChange={(id) => {
              const next = BUCKETS.find((b) => b === id);
              if (next) p.onBucket(next);
            }}
            items={BUCKETS.map((b) => ({
              id: b,
              label: t(`chart.buckets.${b}`),
              content: chartBody,
            }))}
          />
        </Card>
        <div className="space-y-4">
          <TopCodes data={data} />
          <Payouts data={data} now={p.now} />
        </div>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="me-auto text-sm font-semibold">{t('table.title')}</h2>
          <Field label={t('filters.search')} htmlFor="aff-search" className="w-full sm:w-72">
            <Input
              id="aff-search"
              type="search"
              maxLength={120}
              placeholder={t('filters.searchPlaceholder')}
              value={p.searchText}
              onChange={(e) => p.onSearch(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={p.onReset}
            disabled={p.searchText === '' && !hasSearch(filters)}
          >
            {t('filters.reset')}
          </Button>
        </div>
        {data.data.length === 0 ? (
          <EmptyState
            title={noneAtAll ? t('empty.noneTitle') : t('empty.filteredTitle')}
            message={noneAtAll ? t('empty.noneBody') : t('empty.filteredBody')}
          />
        ) : (
          <>
            <ReferralsTable
              rows={data.data}
              currency={data.currency}
              locale={p.locale}
              now={p.now}
            />
            {range && (
              <TableFooter
                from={range.from}
                to={range.to}
                total={range.total}
                hasPrev={p.pageIndex > 0}
                hasNext={data.page.hasMore && data.page.nextCursor !== null}
                busy={p.busy}
                onPrev={p.onPrev}
                onNext={p.onNext}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
