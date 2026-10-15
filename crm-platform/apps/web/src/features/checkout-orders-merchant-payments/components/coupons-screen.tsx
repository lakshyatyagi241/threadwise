'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  STORE_COUPON_STATES,
  storeCouponStateSchema,
  type StoreCoupon,
  type StoreCouponState,
} from '@crm/contracts';
import { Button, ConfirmDialog, EmptyState, Input, Select, Switch, useToast } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { useCoupons, useDeleteCoupon, useToggleCoupon } from '../api/hooks';
import { formatDay, formatInt, formatMoney } from '../lib/format';
import type { Tone } from '../lib/status';
import { CouponFormModal } from './coupons-form-modal';
import { CouponUsagesDrawer } from './coupons-usages-drawer';
import {
  ErrorPanel,
  LoadMore,
  NoAccess,
  PageHeader,
  TableSkeleton,
  Th,
  ToneBadge,
  useErrorLine,
  useShopParam,
  useStoreCan,
  useStoreShops,
} from './parts';

const STATE_TONE: Record<StoreCouponState, Tone> = {
  active: 'success',
  inactive: 'neutral',
  scheduled: 'info',
  expired: 'danger',
  exhausted: 'warning',
};

/** `/store/coupons` (Reference store coupons): the shop's discount codes, with search, a state filter, create/edit, on/off, usages and delete. */
export function CouponsScreen() {
  const t = useTranslations('checkout-orders-merchant-payments.coupons');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const shopParam = useShopParam();
  const can = useStoreCan('coupons');
  const errorLine = useErrorLine();
  const { toast } = useToast();

  const q = search.get('q') ?? '';
  const parsedState = storeCouponStateSchema.safeParse(search.get('state'));
  const state = parsedState.success ? parsedState.data : undefined;

  const shops = useStoreShops(shopParam);
  const currency = shops.data?.shop.currencyCode ?? 'INR';
  const shopOptions = (shops.data?.shops ?? []).map((s) => ({
    id: s.id,
    name: s.shopName || s.slug,
  }));

  const list = useCoupons({ q: q || undefined, state });
  const toggle = useToggleCoupon();
  const remove = useDeleteCoupon();

  const [editor, setEditor] = useState<{ coupon: StoreCoupon | null } | null>(null);
  const [usagesOf, setUsagesOf] = useState<StoreCoupon | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoreCoupon | null>(null);

  // The search box types freely; the address (and the request) follow after a pause.
  const [text, setText] = useState(q);
  const lastQ = useRef(q);
  useEffect(() => {
    if (q !== lastQ.current) {
      lastQ.current = q;
      setText(q);
    }
  }, [q]);
  const setParam = (patch: { q?: string; state?: string }) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  useEffect(() => {
    if (text.trim() === q) return;
    const id = window.setTimeout(() => {
      lastQ.current = text.trim();
      setParam({ q: text.trim() });
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (!can.read) {
    return (
      <StoreShell>
        <NoAccess />
      </StoreShell>
    );
  }

  const filtered = Boolean(q || state);
  const newButton = can.manage ? (
    <Button onClick={() => setEditor({ coupon: null })}>{t('newCoupon')}</Button>
  ) : undefined;

  const onToggle = (c: StoreCoupon) =>
    toggle.mutate(c.id, {
      onSuccess: (next) =>
        toast(
          next.active ? t('toggledOn', { code: c.code }) : t('toggledOff', { code: c.code }),
          'success',
        ),
      onError: (err) => toast(errorLine(err), 'danger'),
    });

  const onDelete = () => {
    const c = pendingDelete;
    if (!c) return;
    remove.mutate(c.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast(t('deleted', { code: c.code }), 'success');
      },
      onError: (err) => {
        setPendingDelete(null);
        toast(errorLine(err), 'danger');
      },
    });
  };

  return (
    <StoreShell>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={newButton}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <Input
            type="search"
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            value={text}
            maxLength={64}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            aria-label={t('stateFilterLabel')}
            value={state ?? ''}
            onChange={(e) => setParam({ state: e.target.value })}
          >
            <option value="">{t('stateAll')}</option>
            {STORE_COUPON_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`states.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setText('');
              setParam({ q: '', state: '' });
            }}
          >
            {tc('clear')}
          </Button>
        )}
      </div>

      {list.isPending ? (
        <TableSkeleton label={tc('loading')} />
      ) : list.isError ? (
        <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title={t('emptyFilteredTitle')}
            message={t('emptyFilteredMessage')}
            actions={
              <Button
                variant="secondary"
                onClick={() => {
                  setText('');
                  setParam({ q: '', state: '' });
                }}
              >
                {t('clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} actions={newButton} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-background">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                <tr>
                  <Th>{t('colCode')}</Th>
                  <Th>{t('colDiscount')}</Th>
                  <Th>{t('colMinOrder')}</Th>
                  <Th>{t('colMaxDiscount')}</Th>
                  <Th>{t('colUsage')}</Th>
                  <Th>{t('colValidity')}</Th>
                  <Th>{t('colScope')}</Th>
                  <Th>{t('colStatus')}</Th>
                  <Th>{t('colActive')}</Th>
                  <Th end>{tc('actions')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((c) => (
                  <tr key={c.id} data-testid="coupon-row" className="align-middle">
                    <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                    <td className="px-4 py-3">
                      <span className="whitespace-nowrap">
                        {c.type === 'percent'
                          ? `${formatInt(c.amount, locale)}%`
                          : formatMoney(c.amount, currency, locale)}
                      </span>
                      {c.freeShipping && (
                        <ToneBadge tone="info" className="ms-2">
                          {t('freeShippingBadge')}
                        </ToneBadge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.minSubtotalMinor ? (
                        formatMoney(c.minSubtotalMinor, currency, locale)
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.maxDiscountMinor ? (
                        formatMoney(c.maxDiscountMinor, currency, locale)
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span>{formatInt(c.usedCount, locale)}</span>
                      <span className="text-muted-foreground">
                        {' / '}
                        {c.usageLimit ? (
                          formatInt(c.usageLimit, locale)
                        ) : (
                          <span aria-label={t('noLimit')} title={t('noLimit')}>
                            ∞
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      <Validity coupon={c} locale={locale} />
                    </td>
                    <td className="px-4 py-3">{c.storefrontName ?? tc('allShops')}</td>
                    <td className="px-4 py-3">
                      <ToneBadge tone={STATE_TONE[c.state]}>{t(`states.${c.state}`)}</ToneBadge>
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={c.active}
                        label={t('toggleLabel', { code: c.code })}
                        disabled={!can.manage || (toggle.isPending && toggle.variables === c.id)}
                        onCheckedChange={() => onToggle(c)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {can.manage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('editLabel', { code: c.code })}
                            onClick={() => setEditor({ coupon: c })}
                          >
                            {tc('edit')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('usagesLabel', { code: c.code })}
                          onClick={() => setUsagesOf(c)}
                        >
                          {t('usages')}
                        </Button>
                        {can.manage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            aria-label={t('deleteLabel', { code: c.code })}
                            onClick={() => setPendingDelete(c)}
                          >
                            {tc('delete')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore
            hasMore={Boolean(list.hasNextPage)}
            loading={list.isFetchingNextPage}
            onMore={() => void list.fetchNextPage()}
          />
        </>
      )}

      {editor && (
        <CouponFormModal
          coupon={editor.coupon}
          currency={currency}
          shops={shopOptions}
          onClose={() => setEditor(null)}
        />
      )}
      <CouponUsagesDrawer coupon={usagesOf} shopId={shopParam} onClose={() => setUsagesOf(null)} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteTitle')}
        message={pendingDelete ? t('deleteMessage', { code: pendingDelete.code }) : ''}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={onDelete}
        onClose={() => setPendingDelete(null)}
      />
    </StoreShell>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/** "1 Oct 2026 – 31 Oct 2026", "From ...", "Until ..." or "Always valid". */
function Validity({ coupon, locale }: { coupon: StoreCoupon; locale: string }) {
  const timeZone = useTimeZone();
  const t = useTranslations('checkout-orders-merchant-payments.coupons');
  const from = formatDay(coupon.startsAt, locale, timeZone);
  const to = formatDay(coupon.expiresAt, locale, timeZone);
  if (from && to) return <>{t('validBetween', { from, to })}</>;
  if (from) return <>{t('validFrom', { from })}</>;
  if (to) return <>{t('validUntil', { to })}</>;
  return <>{t('validAlways')}</>;
}
