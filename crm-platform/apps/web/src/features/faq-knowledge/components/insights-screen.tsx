'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import { Button, EmptyState, StatTile, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFaqLog, useFaqSettings, useFaqSummary } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { LOG_VIEWS, type LogView } from '../lib/log-model';
import { DailyChart, ScoreHistogram } from './charts';
import { ChevronIcon, FaqIcon, SearchIcon } from './icons';
import { CandidateList, OutcomeBadge, WhyText } from './log-parts';
import {
  CARD,
  LoadError,
  NoAccess,
  PageHeader,
  RelativeTime,
  SectionCard,
  SkeletonRows,
  useDebounced,
} from './parts';
import { pct } from '../lib/decision';

const RANGES = [7, 30, 90] as const;

/** `/faq/insights`: how well the FAQs answer, the score spread against the threshold, what is never used, and the full match log. */
export function InsightsScreen() {
  const t = useTranslations('faq.insights');
  const canInsights = useCan('faq.insights.read');
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const summary = useFaqSummary(days, canInsights);
  const settings = useFaqSettings(canInsights);
  if (!canInsights) return <NoAccess permission="faq.insights.read" />;
  const s = summary.data;

  return (
    <section className="space-y-4">
      <PageHeader
        icon={<FaqIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <div
            role="group"
            aria-label={t('range.label')}
            className="inline-flex overflow-hidden rounded-md border border-border"
          >
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => setDays(d)}
                className={cn(
                  'h-10 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  days === d ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {t('range.days', { days: d })}
              </button>
            ))}
          </div>
        }
      />

      {summary.isError ? (
        <LoadError
          errorKey={errorKey(summary.error)}
          error={summary.error}
          onRetry={() => void summary.refetch()}
        />
      ) : !s ? (
        <div className={CARD}>
          <SkeletonRows rows={4} />
        </div>
      ) : s.totals.messages === 0 ? (
        <EmptyState className="py-14" title={t('empty.title')} message={t('empty.body')} />
      ) : (
        <>
          <div
            role="group"
            aria-label={t('kpi.label')}
            className="grid grid-cols-2 gap-3 md:grid-cols-5"
          >
            <StatTile label={t('kpi.messages')} value={s.totals.messages} />
            <StatTile
              label={t('kpi.answerRate')}
              value={`${pct(s.answerRate)}%`}
              tone="accent"
              hint={
                s.avgAnsweredScore === null
                  ? undefined
                  : t('kpi.avgScore', { score: pct(s.avgAnsweredScore) })
              }
            />
            <StatTile label={t('kpi.flows')} value={s.totals.flowStarted} />
            <StatTile
              label={t('kpi.unanswered')}
              value={s.totals.unanswered}
              tone={s.unresolvedUnanswered > 0 ? 'warning' : 'default'}
              hint={
                s.unresolvedUnanswered > 0
                  ? t('kpi.toReview', { count: s.unresolvedUnanswered })
                  : undefined
              }
            />
            <StatTile
              label={t('kpi.errors')}
              value={s.totals.providerErrors}
              tone={s.totals.providerErrors > 0 ? 'warning' : 'default'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              id="faq-ins-daily"
              title={t('daily.title')}
              hint={t('daily.hint', { days })}
            >
              <DailyChart daily={s.daily} />
            </SectionCard>
            <SectionCard id="faq-ins-hist" title={t('hist.title')} hint={t('hist.hint')}>
              <div className="pt-4">
                <ScoreHistogram
                  histogram={s.scoreHistogram}
                  threshold={settings.data?.threshold ?? null}
                />
              </div>
              <p className="rounded-md bg-muted/60 p-3 text-sm">{t('hist.advice')}</p>
              <Link
                href="/faq/settings"
                className="text-sm font-medium underline underline-offset-2"
              >
                {t('hist.tune')}
              </Link>
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard id="faq-ins-top" title={t('top.title')}>
              {s.topFaqs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('top.none')}</p>
              ) : (
                <ol className="space-y-2">
                  {s.topFaqs.map((f, i) => (
                    <li key={f.faqId} className="flex items-baseline justify-between gap-3 text-sm">
                      <Link href={`/faq/${f.faqId}`} className="min-w-0 hover:underline">
                        <span className="me-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
                        {f.question}
                      </Link>
                      <span className="font-semibold tabular-nums">
                        {t('top.hits', { count: f.hits })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>
            <SectionCard id="faq-ins-never" title={t('never.title')}>
              <p className="text-3xl font-semibold tabular-nums">{s.neverMatched}</p>
              <p className="text-sm text-muted-foreground">{t('never.body', { days })}</p>
              <Link href="/faq" className="text-sm font-medium underline underline-offset-2">
                {t('never.link')}
              </Link>
            </SectionCard>
          </div>
        </>
      )}

      <MatchLog />
    </section>
  );
}

function MatchLog() {
  const t = useTranslations('faq.log');
  const [view, setView] = useState<LogView>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const log = useFaqLog(view, debounced, true);
  const settings = useFaqSettings(true);
  const fmtTier = useTranslations('faq.decision.tier');

  return (
    <SectionCard id="faq-log" title={t('title')} hint={t('hint')}>
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={t('viewLabel')}
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {LOG_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-9 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <label htmlFor="faq-log-search" className="sr-only">
            {t('search')}
          </label>
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="faq-log-search"
            type="search"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-9 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </div>

      {log.isError ? (
        <LoadError
          errorKey={errorKey(log.error)}
          error={log.error}
          onRetry={() => void log.refetch()}
        />
      ) : log.isPending ? (
        <SkeletonRows rows={4} className="p-0" />
      ) : log.items.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="w-8 py-2" />
                <th scope="col" className="py-2 text-start font-medium">
                  {t('col.time')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('col.message')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('col.outcome')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('col.faq')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('col.score')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {log.items.map((row) => {
                const expanded = open === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className="align-top">
                      <td className="py-2">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={`faq-log-${row.id}`}
                          aria-label={t(expanded ? 'collapse' : 'expand')}
                          onClick={() => setOpen(expanded ? null : row.id)}
                          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <ChevronIcon className={cn('transition', expanded && 'rotate-180')} />
                        </button>
                      </td>
                      <td className="whitespace-nowrap py-2 pe-3 text-muted-foreground">
                        <RelativeTime iso={row.createdAt} />
                      </td>
                      <td className="max-w-xs py-2 pe-3">
                        {row.query ?? (
                          <span className="italic text-muted-foreground">
                            {t('notKept', { length: row.queryLength })}
                          </span>
                        )}
                        {row.origin === 'test' && (
                          <span className="ms-2 text-xs text-muted-foreground">{t('testRun')}</span>
                        )}
                      </td>
                      <td className="py-2 pe-3">
                        <OutcomeBadge outcome={row.outcome} />
                      </td>
                      <td className="max-w-xs py-2 pe-3">
                        {row.faqQuestion ?? <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="py-2 text-end font-semibold tabular-nums">
                        {row.score === null ? '-' : `${pct(row.score)}%`}
                      </td>
                    </tr>
                    {expanded && (
                      <tr id={`faq-log-${row.id}`}>
                        <td />
                        <td colSpan={5} className="space-y-3 pb-4">
                          <WhyText row={row} threshold={settings.data?.threshold} />
                          <CandidateList row={row} />
                          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                            {row.tier && (
                              <div>
                                <dt className="inline">{t('detail.tier')}: </dt>
                                <dd className="inline text-foreground">
                                  {fmtTier(`${row.tier}.name`)}
                                </dd>
                              </div>
                            )}
                            {row.embeddingModel && (
                              <div>
                                <dt className="inline">{t('detail.model')}: </dt>
                                <dd className="inline font-mono text-foreground">
                                  {row.embeddingModel}
                                </dd>
                              </div>
                            )}
                            {row.latencyMs !== null && (
                              <div>
                                <dt className="inline">{t('detail.latency')}: </dt>
                                <dd className="inline text-foreground">
                                  {t('detail.ms', { ms: row.latencyMs })}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {log.hasNextPage && (
        <div className="text-center">
          <Button
            variant="secondary"
            onClick={() => void log.fetchNextPage()}
            disabled={log.isFetchingNextPage}
          >
            {log.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
