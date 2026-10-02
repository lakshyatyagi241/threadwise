'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COUPON_LIMITS,
  type Coupon,
  type CouponListResponse,
  type CouponStatusFilter,
} from '@crm/contracts';
import { Button, Card, ConfirmDialog, Menu, MenuItem, StatTile, Switch, cn } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { COUPON_KEYS, couponApi } from '../api';
import { couponErrorKind } from '../lib/errors';
import {
  currentCursor,
  firstPage,
  formatDiscount,
  formatUses,
  pageIndexOf,
  popCursor,
  pushCursor,
  showingRange,
  validityOf,
} from '../lib/list';
import { Breadcrumb, ErrorState, LoadingBlock, NS, ReadOnlyBanner, useCanWrite } from './parts';

const PILLS: readonly CouponStatusFilter[] = ['all', 'active', 'disabled', 'expired'];
const SEARCH_DEBOUNCE_MS = 350;

/** TW-CPN-001: the coupon catalogue with its KPI strip, status pills, search and cursor pagination. */
export function CouponsPage() {
  const t = useTranslations(`${NS}.list`);
  const tCommon = useTranslations(`${NS}.common`);
  const canWrite = useCanWrite();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CouponStatusFilter>('all');
  const [stack, setStack] = useState(firstPage);
  const cursor = currentCursor(stack);

  const query = useQuery({
    queryKey: COUPON_KEYS.list(q, status, cursor),
    queryFn: ({ signal }) =>
      couponApi.list({ q, status, cursor, limit: COUPON_LIMITS.pageSize }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  // A new search or pill starts again from the first page.
  const commitSearch = (value: string) => {
    const next = value.trim();
    if (next === q) return;
    setQ(next);
    setStack(firstPage());
  };
  useEffect(() => {
    const timer = setTimeout(() => commitSearch(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const data = query.data;
  // The last row of a later page was deleted: step back to the previous page.
  const onRemoved = () => {
    if (data && data.data.length === 1) setStack((s) => popCursor(s));
  };

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: tCommon('crumb') }]} />
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          canWrite ? (
            <Link
              href="/admin/coupons/new"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t('new')}
            </Link>
          ) : undefined
        }
      />
      {!canWrite && <ReadOnlyBanner />}
      {!data ? (
        query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <>
          <Kpis stats={data.stats} />
          <Card className="flex flex-wrap items-center gap-2 p-2">
            <div role="group" aria-label={t('filters.label')} className="flex flex-wrap gap-1">
              {PILLS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={status === p}
                  onClick={() => {
                    if (p === status) return;
                    setStatus(p);
                    setStack(firstPage());
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition',
                    status === p
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {t(`filters.${p}`)}
                  {p !== 'disabled' && (
                    <span className="font-mono text-xs opacity-80">
                      {p === 'all' ? `(${data.counts.all})` : data.counts[p]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <input
              type="search"
              value={typed}
              aria-label={t('search.label')}
              placeholder={t('search.placeholder')}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitSearch(typed);
                }
              }}
              className="h-9 w-full rounded-full border border-border bg-background px-4 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-72"
            />
          </Card>
          {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
          <Card className={cn('p-0', query.isPlaceholderData && 'opacity-70')}>
            <CouponTable rows={data.data} canWrite={canWrite} onRemoved={onRemoved} />
            <ListFooter
              data={data}
              pageIndex={pageIndexOf(stack)}
              onPrev={() => setStack((s) => popCursor(s))}
              onNext={() =>
                data.page.nextCursor && setStack((s) => pushCursor(s, data.page.nextCursor!))
              }
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Kpis({ stats }: { stats: CouponListResponse['stats'] }) {
  const t = useTranslations(`${NS}.list.kpi`);
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label={t('total.label')} value={nf.format(stats.total)} hint={t('total.hint')} />
      <StatTile
        tone="accent"
        label={t('active.label')}
        value={nf.format(stats.active)}
        hint={t('active.hint')}
      />
      <StatTile
        tone="warning"
        label={t('expired.label')}
        value={nf.format(stats.expired)}
        hint={t('expired.hint')}
      />
      <StatTile
        label={t('redeemed.label')}
        value={nf.format(stats.redeemed)}
        hint={t('redeemed.hint')}
      />
    </section>
  );
}

function ListFooter({
  data,
  pageIndex,
  onPrev,
  onNext,
}: {
  data: CouponListResponse;
  pageIndex: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTranslations(`${NS}.list.footer`);
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const { from, to } = showingRange(pageIndex, COUPON_LIMITS.pageSize, data.data.length);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
      <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
        {t('showing', { from: nf.format(from), to: nf.format(to), total: nf.format(data.total) })}
      </p>
      <nav aria-label={t('pages')} className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={pageIndex === 0} onClick={onPrev}>
          {t('prev')}
        </Button>
        <Button variant="secondary" size="sm" disabled={!data.page.hasMore} onClick={onNext}>
          {t('next')}
        </Button>
      </nav>
    </div>
  );
}

/** The rows: code, discount, uses, validity, the active switch and the row menu (Edit / Delete). */
export function CouponTable({
  rows,
  canWrite,
  onRemoved,
}: {
  rows: readonly Coupon[];
  canWrite: boolean;
  onRemoved?: () => void;
}) {
  const t = useTranslations(`${NS}.list`);
  const tc = useTranslations(`${NS}.list.columns`);
  const te = useTranslations(`${NS}.errors`);
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<Coupon | null>(null);

  const toggle = useMutation({
    mutationFn: (v: { coupon: Coupon; value: boolean }) =>
      couponApi.setActive(v.coupon.id, v.value),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: COUPON_KEYS.all });
      toast.success(t(c.isActive ? 'flash.activated' : 'flash.deactivated'));
    },
    onError: (err) => toast.error(te(couponErrorKind(err))),
  });
  const remove = useMutation({
    mutationFn: (c: Coupon) => couponApi.remove(c.id),
    onSuccess: () => {
      setDeleting(null);
      onRemoved?.();
      void qc.invalidateQueries({ queryKey: COUPON_KEYS.all });
      toast.success(t('flash.removed'));
    },
    onError: (err) => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: COUPON_KEYS.all });
      toast.error(te(couponErrorKind(err)));
    },
  });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm" aria-label={tc('label')}>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-start font-medium">
                {tc('code')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">
                {tc('discount')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">
                {tc('uses')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">
                {tc('validity')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-center font-medium">
                {tc('status')}
              </th>
              <th scope="col" className="w-12 px-3 py-2.5">
                <span className="sr-only">{tc('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  <p className="text-lg font-medium text-foreground">{t('empty.title')}</p>
                  <p className="mt-1 text-sm">
                    {t('empty.before')}{' '}
                    {canWrite ? (
                      <Link
                        href="/admin/coupons/new"
                        className="font-semibold text-primary hover:underline"
                      >
                        {t('empty.link')}
                      </Link>
                    ) : (
                      t('empty.link')
                    )}
                    {t('empty.after')}
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <CouponRow
                  key={c.id}
                  coupon={c}
                  locale={locale}
                  canWrite={canWrite}
                  busy={toggle.isPending && toggle.variables?.coupon.id === c.id}
                  onToggle={(value) => toggle.mutate({ coupon: c, value })}
                  onEdit={() => router.push(`/admin/coupons/${c.id}`)}
                  onDelete={() => setDeleting(c)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title={t('delete.title')}
        message={deleting ? t('delete.message', { code: deleting.code }) : ''}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function CouponRow({
  coupon: c,
  locale,
  canWrite,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  coupon: Coupon;
  locale: string;
  canWrite: boolean;
  busy: boolean;
  onToggle: (value: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations(`${NS}.list`);
  const validity = validityOf(c, locale);
  return (
    <tr className={cn('hover:bg-muted/30', c.isExpired && 'opacity-60')} data-expired={c.isExpired}>
      <td className="max-w-xs px-4 py-3">
        <div className="font-mono text-[13px] font-semibold">{c.code}</div>
        {c.description && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.description}</div>
        )}
      </td>
      <td className="px-3 py-3 font-mono">{formatDiscount(c, locale)}</td>
      <td className="px-3 py-3 font-mono text-xs">{formatUses(c.usesCount, c.maxUses, locale)}</td>
      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
        {validity.kind === 'forever'
          ? t('validity.forever')
          : t('validity.range', {
              start: validity.start ?? t('validity.now'),
              end: validity.end ?? t('validity.forever'),
            })}
      </td>
      <td className="px-3 py-3 text-center">
        <Switch
          checked={c.isActive}
          label={t('switchLabel', { code: c.code })}
          disabled={!canWrite || busy}
          onCheckedChange={onToggle}
        />
      </td>
      <td className="px-3 py-3 text-center">
        {canWrite && (
          <Menu
            label={t('menu.label', { code: c.code })}
            align="end"
            trigger={<span aria-hidden="true">⋯</span>}
            triggerProps={{ 'aria-label': t('menu.label', { code: c.code }) }}
          >
            <MenuItem onSelect={onEdit}>{t('menu.edit')}</MenuItem>
            <MenuItem danger onSelect={onDelete}>
              {t('menu.delete')}
            </MenuItem>
          </Menu>
        )}
      </td>
    </tr>
  );
}
