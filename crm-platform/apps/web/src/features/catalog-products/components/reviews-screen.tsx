'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Button, ConfirmDialog, cn, useToast } from '@crm/ui';
import { REVIEWS_PAGE_SIZE, type ReviewResponse, type ReviewStatus } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS } from '../api/catalog';
import { deleteReview, moderateReview, useReviewsPage } from '../api/reviews';
import { timeAgo } from '../lib/format';
import { REVIEW_TABS, parseReviewTab, reviewsStateToSearch } from '../lib/pages';
import { CARD, LoadError, LoadingBlock, PagerBar } from './parts';
import { useErrorText } from './use-error-text';

/** Five stars, filled up to the rating (WaDesk drew them as characters). */
function Stars({ rating }: { rating: number }) {
  const t = useTranslations('catalogProducts.reviews');
  return (
    <span role="img" aria-label={t('rating', { rating })} className="text-[13px] text-warning">
      {'★'.repeat(rating)}
      <span className="text-border">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

/**
 * `/store/reviews` (WD-CAT-027): storefront reviews by status with the three counts, and Approve, Reject and Delete. A review
 * shows on the product page only once approved.
 */
export function ReviewsScreen() {
  const t = useTranslations('catalogProducts.reviews');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canModerate = useCan('cat.reviews.moderate');

  const tab = parseReviewTab(search.get('status'));
  const page = useMemo(() => {
    const n = Number(search.get('page'));
    return Number.isInteger(n) && n > 1 ? n : 1;
  }, [search]);
  const go = (nextTab: ReviewStatus, nextPage: number) =>
    router.replace(`${pathname}${reviewsStateToSearch(nextTab, nextPage)}`, { scroll: false });

  const list = useReviewsPage(tab, page);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReviewResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.reviews });

  const moderate = async (r: ReviewResponse, status: ReviewStatus) => {
    setBusyId(r.id);
    try {
      await moderateReview(r.id, status);
      toast(t(status === 'approved' ? 'approved' : 'rejected'), 'success');
      await refresh();
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteReview(pendingDelete.id);
      toast(t('deleted'), 'success');
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setDeleting(false);
    }
  };

  const total = list.counts?.[tab];

  return (
    <div>
      <section className="min-w-0 space-y-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="font-serif text-[26px] font-normal leading-tight tracking-tight sm:text-[30px] lg:text-[34px]">
            {t('title')}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>

        <nav
          aria-label={t('tabs')}
          className="flex items-center gap-1 overflow-x-auto border-b border-border"
        >
          {REVIEW_TABS.map((k) => (
            <Link
              key={k}
              href={`${pathname}${reviewsStateToSearch(k, 1)}`}
              replace
              scroll={false}
              aria-current={tab === k ? 'page' : undefined}
              className={cn(
                'relative shrink-0 whitespace-nowrap px-4 py-2.5 text-[12.5px] font-medium outline-none focus-visible:underline',
                tab === k ? 'text-brand dark:text-primary' : 'text-foreground/80 hover:text-brand',
              )}
            >
              {t(`tab.${k}`)}{' '}
              <span className="font-mono text-[10px] opacity-70">{list.counts?.[k] ?? '·'}</span>
              {tab === k && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand dark:bg-primary" />
              )}
            </Link>
          ))}
        </nav>

        <div
          className={cn(
            'space-y-3 transition-opacity',
            list.isFetching && !list.isPending && 'opacity-60',
          )}
        >
          {list.isPending ? (
            <LoadingBlock label={t('loading')} />
          ) : list.isError ? (
            <LoadError
              error={list.error}
              title={t('loadError')}
              onRetry={() => void list.refetch()}
            />
          ) : list.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background p-8 text-center text-[13px] text-muted-foreground">
              {t(`empty.${tab}`)}
            </div>
          ) : (
            list.items.map((r) => (
              <article key={r.id} className={cn(CARD, 'flex flex-wrap items-start gap-4 p-4')}>
                <div className="min-w-[220px] flex-1">
                  <div className="flex items-center gap-2">
                    <Stars rating={r.rating} />
                    <span className="text-[13px] font-semibold">
                      {r.customerName || t('anonymous')}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t('on')}{' '}
                    <span className="font-medium text-foreground">
                      {r.product?.name ?? t('unknownProduct')}
                    </span>{' '}
                    · {timeAgo(r.createdAt, new Date(), locale)}
                  </div>
                  {r.body ? <p className="mt-2 text-[12.5px]">{r.body}</p> : null}
                </div>
                {canModerate && (
                  <div className="flex items-center gap-2">
                    {tab !== 'approved' && (
                      <Button
                        variant="brand"
                        size="sm"
                        className="rounded-full text-[11.5px]"
                        disabled={busyId === r.id}
                        onClick={() => void moderate(r, 'approved')}
                      >
                        {t('approve')}
                      </Button>
                    )}
                    {tab !== 'rejected' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full text-[11.5px]"
                        disabled={busyId === r.id}
                        onClick={() => void moderate(r, 'rejected')}
                      >
                        {t('reject')}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-full text-[11.5px] text-danger hover:border-danger/40 hover:bg-danger/10"
                      disabled={busyId === r.id}
                      onClick={() => setPendingDelete(r)}
                    >
                      {t('delete')}
                    </Button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
        <PagerBar
          page={list.page}
          total={total}
          size={REVIEWS_PAGE_SIZE}
          shown={list.items.length}
          onPage={(p) => go(tab, p)}
        />
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteTitle')}
        message={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
