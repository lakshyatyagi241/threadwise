'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FaqLogItem } from '@crm/contracts';
import { Button, EmptyState, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, refreshFaqs, useFaqLog, useFaqSettings } from '../api/hooks';
import { faqApi } from '../api/service';
import { pct } from '../lib/decision';
import { errorKey } from '../lib/errors';
import { withoutLog } from '../lib/log-model';
import { writePrefill } from '../lib/prefill';
import { FaqIcon, SearchIcon } from './icons';
import { CandidateList, FaqPickerModal, WhyText } from './log-parts';
import {
  CARD,
  LoadError,
  NoAccess,
  PageHeader,
  RelativeTime,
  SkeletonRows,
  focusAfterRemoval,
  useDebounced,
} from './parts';

type LogCache = Parameters<typeof withoutLog>[0];

/** `/faq/unanswered`: customer messages no FAQ answered. Each one can become a phrasing of an FAQ, a new FAQ, or be dismissed. */
export function UnansweredScreen() {
  const t = useTranslations('faq.unanswered');
  const te = useTranslations('faq.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const canInsights = useCan('faq.insights.read');
  const canUpdate = useCan('faq.entries.update');
  const canCreate = useCan('faq.entries.create');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());
  const log = useFaqLog('unanswered', debounced, canInsights);
  const settings = useFaqSettings(canInsights);
  const [picking, setPicking] = useState<FaqLogItem | null>(null);

  /** The row leaves at once; a failure puts every cached page back exactly as it was. */
  const optimistic = async (id: string) => {
    await qc.cancelQueries({ queryKey: KEYS.log });
    const snapshot = qc.getQueriesData<LogCache>({ queryKey: KEYS.log });
    qc.setQueriesData<LogCache>({ queryKey: KEYS.log }, (d) => withoutLog(d, id));
    return { snapshot };
  };
  type Ctx = Awaited<ReturnType<typeof optimistic>>;
  const rollback = (ctx: Ctx | undefined) =>
    ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));

  const dismiss = useMutation({
    mutationFn: (row: FaqLogItem) => faqApi.dismiss(row.id),
    onMutate: (row) => optimistic(row.id),
    onError: (e, _r, ctx) => {
      rollback(ctx);
      toast(te(errorKey(e)), 'danger');
    },
    onSuccess: () => {
      toast(t('dismissed'));
      focusAfterRemoval('faq-un-search');
    },
    onSettled: () => void refreshFaqs(qc),
  });
  const learn = useMutation({
    mutationFn: (v: { row: FaqLogItem; faqId: string; question: string }) =>
      faqApi.learn(v.row.id, { faqId: v.faqId }),
    onMutate: async (v) => {
      setPicking(null);
      return optimistic(v.row.id);
    },
    onError: (e, _v, ctx) => {
      rollback(ctx);
      toast(te(errorKey(e)), 'danger');
    },
    onSuccess: (_r, v) => {
      toast(t('learned', { question: v.question }));
      focusAfterRemoval('faq-un-search');
    },
    onSettled: () => void refreshFaqs(qc),
  });

  if (!canInsights) return <NoAccess permission="faq.insights.read" />;

  const createFrom = (row: FaqLogItem) => {
    if (!row.query) return;
    writePrefill({ question: row.query, resolveLogId: row.id });
    router.push('/faq/new?prefill=1');
  };

  return (
    <section className="space-y-4">
      <PageHeader
        icon={<FaqIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle')}
      />
      <div className={`${CARD} p-4`}>
        <div className="relative max-w-md">
          <label htmlFor="faq-un-search" className="sr-only">
            {t('search')}
          </label>
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="faq-un-search"
            type="search"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
        <div className={CARD}>
          <SkeletonRows rows={4} />
        </div>
      ) : log.items.length === 0 ? (
        <EmptyState
          className="py-14"
          title={debounced ? t('noMatch') : t('emptyTitle')}
          message={debounced ? undefined : t('emptyBody')}
        />
      ) : (
        <ul className="space-y-3" aria-label={t('listLabel')}>
          {log.items.map((row) => {
            const best = row.candidates[0];
            return (
              <li key={row.id} className={`${CARD} space-y-3 p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words font-medium">
                    {row.query ?? (
                      <span className="italic text-muted-foreground">{t('notKept')}</span>
                    )}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    <RelativeTime iso={row.createdAt} />
                  </span>
                </div>
                <WhyText row={row} threshold={settings.data?.threshold} />
                {best ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t('closest')} </span>
                    <span className="font-medium">{best.question}</span>
                    <span className="ms-2 font-semibold tabular-nums">{pct(best.score)}%</span>
                  </p>
                ) : null}
                {row.candidates.length > 1 && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      {t('allCandidates', { count: row.candidates.length })}
                    </summary>
                    <div className="mt-2">
                      <CandidateList row={row} />
                    </div>
                  </details>
                )}
                <div className="flex flex-wrap gap-2">
                  {canUpdate && row.query && (
                    <Button size="sm" variant="secondary" onClick={() => setPicking(row)}>
                      {t('addToFaq')}
                    </Button>
                  )}
                  {canCreate && row.query && (
                    <Button size="sm" variant="secondary" onClick={() => createFrom(row)}>
                      {t('createFaq')}
                    </Button>
                  )}
                  {canUpdate && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={dismiss.isPending && dismiss.variables?.id === row.id}
                      onClick={() => dismiss.mutate(row)}
                    >
                      {t('dismiss')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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

      <FaqPickerModal
        open={picking !== null}
        title={t('pickTitle')}
        onClose={() => setPicking(null)}
        onPick={(faq) =>
          picking && learn.mutate({ row: picking, faqId: faq.id, question: faq.question })
        }
      />
    </section>
  );
}
