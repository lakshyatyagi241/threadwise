'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  couponStatusFilterSchema,
  type CouponItem,
  type CouponListResponse,
  type CouponStatusFilter,
} from '@crm/contracts';
import {
  Alert,
  Card,
  ConfirmDialog,
  Menu,
  MenuItem,
  MenuSeparator,
  StatTile,
  Switch,
  ToastProvider,
  cn,
  useToast,
} from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, couponItemSchema, fetchCoupons } from '../api';
import { cpnErrorKey } from '../lib/errors';
import { money, validityParts } from '../lib/format';
import { Accent, ErrorBlock, LoadingBlock, PageHead, Pager, PrimaryLink } from './ui';

const NS = 'coupons-credits-referral-currency.coupons';
const BASE = '/admin/coupons';

export function CouponsPage() {
  const t = useTranslations('coupons-credits-referral-currency.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <CouponsScreen />
    </ToastProvider>
  );
}

/** The list's own state lives in the address (`?q=&status=&page=`), as in Reference: a filtered view can be shared and reloaded. */
function useListQuery() {
  const sp = useSearchParams();
  const parsed = couponStatusFilterSchema.safeParse(sp.get('status') ?? 'all');
  const status: CouponStatusFilter = parsed.success ? parsed.data : 'all';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  return { q: sp.get('q') ?? '', status, page };
}

/** The API's limit on the search text; a longer value cannot match anything, so it is never sent. */
const MAX_SEARCH = 100;

function useGo(q: string, status: CouponStatusFilter) {
  const router = useRouter();
  const pathname = usePathname();
  return (next: { q?: string; status?: CouponStatusFilter; page?: number }) => {
    const p = new URLSearchParams();
    const nq = next.q ?? q;
    const ns = next.status ?? status;
    if (nq) p.set('q', nq);
    if (ns !== 'all') p.set('status', ns);
    if (next.page && next.page > 1) p.set('page', String(next.page));
    const s = p.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  };
}

function CouponsScreen() {
  const { q, status, page } = useListQuery();
  const tooLong = q.length > MAX_SEARCH;
  const apiQ = tooLong ? undefined : q || undefined;
  const query = useQuery({
    queryKey: KEYS.couponList({ q: apiQ, status, page: tooLong ? 1 : page }),
    queryFn: ({ signal }) => fetchCoupons({ q: apiQ, status, page: tooLong ? 1 : page }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (query.isPending || query.isError) {
    return (
      <div className="space-y-5">
        <CouponsHead />
        <FilterBar q={q} status={status} />
        {query.isPending ? (
          <LoadingBlock />
        ) : (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  const data: CouponListResponse = tooLong
    ? { ...query.data, data: [], total: 0, pageCount: 0, from: 0, to: 0, page: 1 }
    : query.data;
  return <Catalogue data={data} q={q} status={status} />;
}

function CouponsHead() {
  const t = useTranslations(NS);
  const tc = useTranslations('coupons-credits-referral-currency.common');
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  return (
    <>
      <PageHead
        crumbs={[{ label: tc('admin'), href: '/admin' }, { label: t('crumbHere') }]}
        eyebrow={t('eyebrow')}
        title={
          <>
            {t('titleLead')} <Accent>{t('titleAccent')}</Accent>
          </>
        }
        description={t('description')}
        actions={canEdit && <PrimaryLink href={`${BASE}/new`}>{t('new')}</PrimaryLink>}
      />
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}
    </>
  );
}

/** The status pills and the search box; they stay on screen whatever the list is doing. */
function FilterBar({
  q,
  status,
  counts,
}: {
  q: string;
  status: CouponStatusFilter;
  counts?: CouponListResponse['counts'];
}) {
  const t = useTranslations(NS);
  const go = useGo(q, status);
  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get('q');
    go({ q: typeof value === 'string' ? value.trim() : '', page: 1 });
  };
  const pills: Array<{ key: CouponStatusFilter; count?: number }> = [
    { key: 'all', count: counts?.all },
    { key: 'active', count: counts?.active },
    { key: 'disabled' },
    { key: 'expired', count: counts?.expired },
  ];
  return (
    <form
      onSubmit={onSearch}
      role="search"
      aria-label={t('filters.label')}
      className="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-background p-2 shadow-sm"
    >
      {pills.map((p) => {
        const on = status === p.key;
        return (
          <button
            key={p.key}
            type="button"
            aria-pressed={on}
            onClick={() => go({ status: p.key, page: 1 })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-4 py-[7px] text-[13px] transition',
              on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`filters.${p.key}`)}
            {p.count !== undefined && (
              <span
                className={cn(
                  'font-mono text-[11px]',
                  p.key === 'expired' && !on ? 'text-warning' : 'opacity-80',
                )}
              >
                {p.key === 'all' ? `(${p.count})` : p.count}
              </span>
            )}
          </button>
        );
      })}
      <div className="flex-1" />
      <div className="relative">
        <svg
          viewBox="0 0 16 16"
          className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="m11 11 3 3" />
        </svg>
        <input
          key={q}
          name="q"
          type="search"
          defaultValue={q}
          aria-label={t('filters.searchLabel')}
          placeholder={t('filters.search')}
          className="w-72 max-w-full rounded-full border border-border bg-background py-1.5 ps-9 pe-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
    </form>
  );
}

function Catalogue({
  data,
  q,
  status,
}: {
  data: CouponListResponse;
  q: string;
  status: CouponStatusFilter;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('coupons-credits-referral-currency.errors');
  const tc = useTranslations('coupons-credits-referral-currency.common');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [deleting, setDeleting] = useState<CouponItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.coupons });

  // The form pages redirect here with ?saved=created (Reference's flash message); show it once, then clean the URL.
  const saved = sp.get('saved');
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || saved !== 'created') return;
    shown.current = true;
    toast(t('toasts.created'));
    router.replace(BASE);
  }, [saved, toast, t, router]);

  const go = useGo(q, status);

  const toggle = useMutation({
    mutationFn: (c: CouponItem) =>
      operatorFetch(`/coupons/${c.id}/active`, {
        method: 'PATCH',
        body: { isActive: !c.isActive, rowVersion: c.rowVersion },
        schema: couponItemSchema,
      }),
    onMutate: (c) => setTogglingId(c.id),
    onSuccess: (c) => {
      toast(t(c.isActive ? 'toasts.activated' : 'toasts.deactivated'));
      return refresh();
    },
    onError: (e) => {
      toast(te(cpnErrorKey(e)), 'danger');
      void refresh();
    },
    onSettled: () => setTogglingId(null),
  });

  const remove = useMutation({
    mutationFn: (c: CouponItem) => operatorFetch(`/coupons/${c.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast(t('toasts.deleted'));
      setDeleting(null);
      await refresh();
    },
  });

  const discount = (c: CouponItem) =>
    c.type === 'percent'
      ? `${c.amount}%`
      : money(c.amount, c.currencyCode ?? data.defaultCurrency, locale);

  const validity = (c: CouponItem) => {
    const v = validityParts(c, locale, timeZone);
    return v.kind === 'forever'
      ? t('validity.forever')
      : t('validity.range', {
          from: v.from ?? t('validity.now'),
          to: v.to ?? t('validity.forever'),
        });
  };

  const head = 'px-3 py-2.5 text-start font-medium';
  const nf = new Intl.NumberFormat(locale);

  return (
    <div className="space-y-5">
      <CouponsHead />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('crumbHere')}>
        <StatTile
          label={t('kpi.total')}
          value={<span className="font-serif font-normal">{nf.format(data.summary.total)}</span>}
          hint={t('kpi.totalHint')}
          className="rounded-2xl"
        />
        <StatTile
          tone="accent"
          label={t('kpi.active')}
          value={<span className="font-serif font-normal">{nf.format(data.summary.active)}</span>}
          hint={t('kpi.activeHint')}
          className="rounded-2xl"
        />
        <StatTile
          tone="warning"
          label={t('kpi.expired')}
          value={<span className="font-serif font-normal">{nf.format(data.summary.expired)}</span>}
          hint={t('kpi.expiredHint')}
          className="rounded-2xl"
        />
        <StatTile
          label={t('kpi.redeemed')}
          value={<span className="font-serif font-normal">{nf.format(data.summary.redeemed)}</span>}
          hint={<span className="text-primary">{t('kpi.redeemedHint')}</span>}
          className="rounded-2xl"
        />
      </section>

      <FilterBar q={q} status={status} counts={data.counts} />

      <Card className="overflow-hidden rounded-2xl p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[12.5px]">
            <caption className="sr-only">{t('table.label')}</caption>
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className={cn(head, 'px-4')}>
                  {t('table.code')}
                </th>
                <th scope="col" className={cn(head, 'w-[160px]')}>
                  {t('table.discount')}
                </th>
                <th scope="col" className={cn(head, 'w-[130px]')}>
                  {t('table.uses')}
                </th>
                <th scope="col" className={cn(head, 'w-[200px]')}>
                  {t('table.validity')}
                </th>
                <th scope="col" className={cn(head, 'w-[100px] text-center')}>
                  {t('table.status')}
                </th>
                <th scope="col" className={cn(head, 'w-[56px]')}>
                  <span className="sr-only">{t('table.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    <div className="mb-1 font-serif text-xl">{t('empty.title')}</div>
                    <p className="text-[12.5px]">
                      {t('empty.hint')}{' '}
                      {canEdit ? (
                        <Link
                          href={`${BASE}/new`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {t('empty.create')}
                        </Link>
                      ) : (
                        t('empty.create')
                      )}
                      .
                    </p>
                  </td>
                </tr>
              )}
              {data.data.map((c) => (
                <tr key={c.id} className={cn('hover:bg-muted/50', c.isExpired && 'opacity-60')}>
                  <td className="min-w-0 px-4 py-3">
                    <div className="font-mono text-[13px] font-semibold">{c.code}</div>
                    {c.description && (
                      <div className="mt-0.5 max-w-xs truncate text-[10.5px] text-muted-foreground">
                        {c.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono" dir="ltr">
                    {discount(c)}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11.5px]" dir="ltr">
                    {nf.format(c.usesCount)}
                    {c.maxUses ? ` / ${nf.format(c.maxUses)}` : ' / ∞'}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
                    {validity(c)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Switch
                      label={t('actions.toggle', { code: c.code })}
                      checked={c.isActive}
                      disabled={!canEdit || togglingId === c.id}
                      onCheckedChange={() => toggle.mutate(c)}
                    />
                  </td>
                  <td className="px-3 py-3 text-center">
                    {canEdit && (
                      <Menu
                        label={t('actions.menu')}
                        align="end"
                        trigger={
                          <svg
                            viewBox="0 0 16 16"
                            className="size-3.5"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="3" cy="8" r="1.2" />
                            <circle cx="8" cy="8" r="1.2" />
                            <circle cx="13" cy="8" r="1.2" />
                          </svg>
                        }
                        triggerClassName="size-8 h-8 rounded-full border-transparent px-0"
                        triggerProps={{ title: t('actions.menu') }}
                      >
                        <MenuItem onSelect={() => router.push(`${BASE}/${c.id}/edit`)}>
                          {t('actions.edit')}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          danger
                          onSelect={() => {
                            remove.reset();
                            setDeleting(c);
                          }}
                        >
                          {t('actions.delete')}
                        </MenuItem>
                      </Menu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-3">
          <div className="font-mono text-[11px] text-muted-foreground">
            {t('footer', {
              from: nf.format(data.from),
              to: nf.format(data.to),
              total: nf.format(data.total),
            })}
          </div>
          <Pager
            page={data.page}
            pageCount={data.pageCount}
            onGo={(n) => go({ page: n })}
            labels={{
              nav: t('pager.label'),
              previous: t('pager.previous'),
              next: t('pager.next'),
              page: (n) => t('pager.page', { n }),
            }}
          />
        </div>
      </Card>

      {deleting && (
        <ConfirmDialog
          open
          tone="danger"
          busy={remove.isPending}
          title={t('delete.title')}
          message={
            <div className="space-y-3">
              <p>{t('delete.body', { code: deleting.code })}</p>
              {remove.isError && <Alert tone="danger">{te(cpnErrorKey(remove.error))}</Alert>}
            </div>
          }
          confirmLabel={t('delete.confirm')}
          cancelLabel={tc('cancel')}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
