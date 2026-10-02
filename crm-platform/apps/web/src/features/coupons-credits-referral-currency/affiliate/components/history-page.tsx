'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { ReferralBucket, ReferralHistoryResponse, ReferralRange } from '@crm/contracts';
import { Button, Select, Spinner, ToastProvider, cn, useToast } from '@crm/ui';
import { HISTORY_PAGE_SIZE, KEYS, affiliateApi, downloadAffiliateCsv, exportHref } from '../api';
import { saveBlob } from '../lib/download';
import { errorKind } from '../lib/errors';
import {
  FIRST_PAGE,
  RANGES,
  currentCursor,
  effectiveBucket,
  pageNumber,
  parseFilters,
  popCursor,
  pushCursor,
  shownRange,
  toSearch,
} from '../lib/format';
import { useCopyLink, useDebounced } from './hooks';
import { KpiStrip } from './kpi-strip';
import { ReferralsTable } from './referrals-table';
import { PayoutsCard, HowItWorks, ShareCard } from './side-panel';
import { ErrorState, LoadingBlock } from './state';
import { TopCodes } from './top-codes';
import { VolumePanel } from './volume-chart';

export const SEARCH_DEBOUNCE_MS = 220;
const HISTORY_PATH = '/affiliate-history';

/** Affiliate history (TW-CPN-035): KPIs, volume chart, top codes, a searchable table, the share panel and recent payouts. */
export function AffiliateHistoryPage() {
  const tc = useTranslations('coupons-credits-referral-currency.affiliate.common');
  return (
    <ToastProvider dismissLabel={tc('dismiss')}>
      <HistoryBody />
    </ToastProvider>
  );
}

function HistoryBody() {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.history');
  const params = useSearchParams();
  const initial = useMemo(() => parseFilters(params), [params]);
  const [range, setRange] = useState<ReferralRange>(initial.range);
  const [chosenBucket, setChosenBucket] = useState<ReferralBucket | null>(initial.bucket);
  const [text, setText] = useState(initial.q);
  const q = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const bucket = effectiveBucket({ range, bucket: chosenBucket, q });

  // Prev/Next keep the cursors already visited; changing any filter starts again from the first page.
  const key = `${range}|${bucket}|${q}`;
  const [pager, setPager] = useState({ key, stack: FIRST_PAGE });
  const stack = pager.key === key ? pager.stack : FIRST_PAGE;
  const setStack = (next: typeof stack) => setPager({ key, stack: next });
  const cursor = currentCursor(stack);

  // The address keeps what differs from the defaults (as Reference did), without navigating.
  useEffect(() => {
    window.history.replaceState(
      null,
      '',
      `${HISTORY_PATH}${toSearch({ range, bucket: chosenBucket, q })}`,
    );
  }, [range, chosenBucket, q]);

  const me = useQuery({
    queryKey: KEYS.me,
    queryFn: ({ signal }) => affiliateApi.me(signal),
  });
  const history = useQuery({
    queryKey: KEYS.history(range, bucket, q, cursor),
    queryFn: ({ signal }) => affiliateApi.history({ range, bucket, q, cursor }, signal),
    placeholderData: keepPreviousData,
  });

  const copy = useCopyLink('copied');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/account/affiliate"
            title={t('back')}
            aria-label={t('back')}
            className="grid h-8 w-8 place-items-center rounded-full border border-border hover:bg-muted"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 rtl:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </Link>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t('breadcrumb')}</div>
            <h1 className="truncate text-2xl font-semibold leading-tight">{t('title')}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('rangeLabel')}
            value={range}
            onChange={(e) => setRange(e.target.value as ReferralRange)}
            className="h-9 w-auto rounded-full py-1 text-xs font-medium"
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {t(`range.${r}`)}
              </option>
            ))}
          </Select>
          <ExportLink range={range} />
          <Button size="sm" disabled={!me.data} onClick={() => me.data && void copy(me.data.link)}>
            {t('copyShare')}
          </Button>
        </div>
      </header>

      {history.isPending || me.isPending ? (
        <LoadingBlock />
      ) : history.isError || me.isError || !history.data || !me.data ? (
        <ErrorState
          error={history.error ?? me.error}
          onRetry={() => {
            void history.refetch();
            void me.refetch();
          }}
        />
      ) : (
        <HistoryContent
          data={history.data}
          me={me.data}
          range={range}
          bucket={bucket}
          onBucket={setChosenBucket}
          text={text}
          onText={setText}
          stack={stack}
          onPush={(c) => setStack(pushCursor(stack, c))}
          onPop={() => setStack(popCursor(stack))}
          busy={history.isPlaceholderData}
          onCopy={(url) => void copy(url)}
        />
      )}
    </div>
  );
}

/** "Export CSV": a real link to the range's file; clicking it downloads under the server's file name. */
function ExportLink({ range }: { range: ReferralRange }) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.history');
  const te = useTranslations('coupons-credits-referral-currency.affiliate.errors');
  const toast = useToast();
  const exporter = useMutation({
    mutationFn: () => downloadAffiliateCsv(range),
    onSuccess: ({ blob, fileName }) => {
      saveBlob(blob, fileName);
      toast.toast(t('exported', { fileName }), 'success');
    },
    onError: (err) => toast.toast(te(errorKind(err)), 'danger'),
  });
  return (
    <a
      id="affiliate-export"
      href={exportHref(range)}
      download
      aria-busy={exporter.isPending}
      onClick={(e) => {
        e.preventDefault();
        if (!exporter.isPending) exporter.mutate();
      }}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-medium hover:bg-muted',
        exporter.isPending && 'pointer-events-none opacity-60',
      )}
    >
      {exporter.isPending && <Spinner label={t('exporting')} />}
      {t('export')}
    </a>
  );
}

export function HistoryContent({
  data,
  me,
  range,
  bucket,
  onBucket,
  text,
  onText,
  stack,
  onPush,
  onPop,
  busy,
  onCopy,
  now = new Date(),
}: {
  data: ReferralHistoryResponse;
  me: Parameters<typeof KpiStrip>[0]['me'];
  range: ReferralRange;
  bucket: ReferralBucket;
  onBucket: (b: ReferralBucket) => void;
  text: string;
  onText: (v: string) => void;
  stack: typeof FIRST_PAGE;
  onPush: (cursor: string) => void;
  onPop: () => void;
  busy?: boolean;
  onCopy: (url: string) => void;
  now?: Date;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.history');
  const tt = useTranslations('coupons-credits-referral-currency.affiliate.table');
  const locale = useLocale();
  const page = pageNumber(stack);
  const { from, to } = shownRange(page, HISTORY_PAGE_SIZE, data.data.length);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const nextCursor = data.page.nextCursor;

  return (
    <>
      <KpiStrip stats={data.stats} me={me} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <VolumePanel
          volume={data.volume}
          currency={me.currency}
          bucket={bucket}
          onBucket={onBucket}
        />
        <TopCodes codes={data.topCodes} currency={me.currency} rangeLabel={t(`range.${range}`)} />
      </section>
      <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div
          className={cn(
            'flex min-h-[460px] flex-col rounded-lg border border-border bg-background',
            busy && 'opacity-70',
          )}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <input
              id="affiliate-search"
              type="search"
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder={tt('searchPlaceholder')}
              aria-label={tt('searchPlaceholder')}
              className="h-10 min-w-[260px] max-w-[480px] flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <Button variant="secondary" size="sm" onClick={() => onText('')}>
              {tt('reset')}
            </Button>
          </div>
          <ReferralsTable
            rows={data.data}
            currency={me.currency}
            now={now}
            onReset={() => onText('')}
          />
          {data.total > 0 && (
            <div
              data-footer
              className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground"
            >
              <div>
                {tt('showing')}{' '}
                <span className="font-mono text-foreground">
                  {n(from)}–{n(to)}
                </span>{' '}
                {tt('of')} <span className="font-mono text-foreground">{n(data.total)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="sm" disabled={page <= 1 || busy} onClick={onPop}>
                  {tt('prev')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!data.page.hasMore || !nextCursor || busy}
                  onClick={() => nextCursor && onPush(nextCursor)}
                >
                  {tt('next')}
                </Button>
              </div>
            </div>
          )}
        </div>
        <aside className="space-y-4 xl:sticky xl:top-5">
          <ShareCard me={me} onCopy={onCopy} />
          <PayoutsCard payouts={data.payouts} currency={me.currency} now={now} />
          <HowItWorks me={me} />
        </aside>
      </section>
    </>
  );
}
