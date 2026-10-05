'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, Select } from '@crm/ui';
import type { DashboardTemplate, StoreDashboard } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { sendOffer, sendWinback } from '../../api/ecom';
import { money, type Kind } from '../../lib/model';
import { SendIcon } from '../ecom-icons';
import { ResultLine, primaryButton } from '../ui';

const label = 'block text-xs font-semibold';
const input =
  'mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10';
const card = 'space-y-4 rounded-2xl border border-border bg-background p-5 shadow-sm';

const tplLabel = (t: DashboardTemplate) => `${t.name} · ${t.language.toUpperCase()}`;

function useRun(kind: Kind, storeId: string) {
  const t = useTranslations('ecom.offers');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const run = async (
    action: 'offer' | 'winback',
    body: Parameters<typeof sendOffer>[2] | Parameters<typeof sendWinback>[2],
  ) => {
    setBusy(true);
    setResult({ ok: true, message: t('sending') });
    try {
      const res =
        action === 'offer'
          ? await sendOffer(kind, storeId, body as Parameters<typeof sendOffer>[2])
          : await sendWinback(kind, storeId, body as Parameters<typeof sendWinback>[2]);
      setResult(
        res.ok
          ? {
              ok: true,
              message: t(action === 'offer' ? 'queued' : 'winQueued', { total: res.total ?? 0 }),
            }
          : { ok: false, message: res.message ?? t('failed') },
      );
    } catch (e) {
      setResult({ ok: false, message: e instanceof ApiError ? e.message : t('failed') });
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, run, setResult };
}

function OfferForm({ kind, storeId, data }: { kind: Kind; storeId: string; data: StoreDashboard }) {
  const t = useTranslations('ecom.offers');
  const search = useSearchParams();
  const preset = search.get('product');
  const [picked, setPicked] = useState<string[]>(preset ? [preset] : []);
  const [templateUuid, setTemplateUuid] = useState('');
  const [groupUuid, setGroupUuid] = useState('');
  const [productUuid, setProductUuid] = useState('');
  const [coupon, setCoupon] = useState('');
  const { busy, result, run, setResult } = useRun(kind, storeId);
  const shopify = kind === 'shopify';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (templateUuid === '') return setResult({ ok: false, message: t('pickTemplateFirst') });
    if (groupUuid === '') return setResult({ ok: false, message: t('pickSegmentFirst') });
    // WaDesk uses the first product that is picked.
    const product = shopify ? picked[0] : productUuid;
    void run('offer', {
      templateUuid,
      groupUuid,
      ...(product ? { productUuid: product } : {}),
      ...(coupon !== '' ? { couponCode: coupon } : {}),
    });
  };

  const couponOptions = data.coupons.map((c) => (
    <option key={c.code} value={c.code}>
      {c.code} (
      {c.type === 'percent'
        ? t('couponPercent', { amount: c.amount })
        : money(c.amount / 100, data.currency)}
      )
    </option>
  ));

  return (
    <form
      onSubmit={submit}
      className={shopify ? 'grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]' : card}
    >
      {shopify && (
        <div className={card}>
          <div className="flex items-center justify-between">
            <h3 className="text-[19px] font-normal">{t('choose')}</h3>
            <span className="text-xs text-muted-foreground">
              {t('selected', { count: picked.length })}
            </span>
          </div>
          {data.products.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('noProducts')}</p>
          ) : (
            <div className="grid max-h-[460px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {data.products.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer flex-col gap-1.5 rounded-xl border border-border p-2 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand/5"
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(p.id)}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id),
                      )
                    }
                    className="self-start"
                  />
                  <div className="aspect-square overflow-hidden rounded-lg bg-muted">
                    {p.imageUrl && (
                      <img
                        src={p.imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="text-muted-foreground tabular-nums">
                    {money(p.price, data.currency)}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={shopify ? 'space-y-3' : 'space-y-4'}>
        <div className={shopify ? card : 'space-y-4'}>
          {!shopify && (
            <div>
              <h3 className="text-[19px] font-normal">{t('wooTitle')}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t('wooIntro')}</p>
            </div>
          )}
          <div>
            <label className={label} htmlFor="o-template">
              {shopify ? t('template') : t('wooTemplate')}{' '}
              {shopify && <span className="text-danger">*</span>}
            </label>
            <Select
              id="o-template"
              className="mt-1.5"
              value={templateUuid}
              onChange={(e) => setTemplateUuid(e.target.value)}
              required={!shopify}
            >
              <option value="">— {shopify ? t('pickTemplate') : t('choose2')} —</option>
              {data.templates.map((tpl) => (
                <option key={tpl.uuid} value={tpl.uuid}>
                  {tplLabel(tpl)}
                </option>
              ))}
            </Select>
            {shopify && (
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {t('tokens')} <code>{'{{product_name}}'}</code>, <code>{'{{price}}'}</code>,{' '}
                <code>{'{{coupon_code}}'}</code>
              </p>
            )}
          </div>
          <div>
            <label className={label} htmlFor="o-group">
              {shopify ? t('segment') : t('wooSegment')}{' '}
              {shopify && <span className="text-danger">*</span>}
            </label>
            <Select
              id="o-group"
              className="mt-1.5"
              value={groupUuid}
              onChange={(e) => setGroupUuid(e.target.value)}
              required={!shopify}
            >
              <option value="">— {shopify ? t('pickGroup') : t('choose2')} —</option>
              {data.contactGroups.map((g) => (
                <option key={g.uuid} value={g.uuid}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          {!shopify && (
            <div>
              <label className={label} htmlFor="o-product">
                {t('wooProduct')}{' '}
                <span className="font-normal text-muted-foreground">({t('optional')})</span>
              </label>
              <Select
                id="o-product"
                className="mt-1.5"
                value={productUuid}
                onChange={(e) => setProductUuid(e.target.value)}
              >
                <option value="">— {t('none')} —</option>
                {data.offerProducts.map((p) => (
                  <option key={p.uuid} value={p.uuid}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <label className={label} htmlFor="o-coupon">
              {shopify ? t('coupon') : t('wooCoupon')}
            </label>
            {shopify ? (
              <Select
                id="o-coupon"
                className="mt-1.5"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
              >
                <option value="">— {t('noCoupon')} —</option>
                {couponOptions}
              </Select>
            ) : (
              <>
                <input
                  id="o-coupon"
                  list="ecom-coupons"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value)}
                  placeholder={t('wooCouponPlaceholder')}
                  className={input}
                  maxLength={64}
                />
                <datalist id="ecom-coupons">
                  {data.coupons.map((c) => (
                    <option key={c.code} value={c.code} />
                  ))}
                </datalist>
              </>
            )}
          </div>
          <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
            <SendIcon className="size-3.5" />
            {t('send')}
          </button>
          {result && <ResultLine ok={result.ok}>{result.message}</ResultLine>}
        </div>
        {shopify && (
          <div className="rounded-2xl border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
            {t('note')}
          </div>
        )}
      </div>
    </form>
  );
}

const DAYS = [30, 60, 90, 180, 365];
const MIN_ORDERS = [0, 1, 2, 3, 5, 10];

function WinbackForm({
  kind,
  storeId,
  data,
}: {
  kind: Kind;
  storeId: string;
  data: StoreDashboard;
}) {
  const t = useTranslations('ecom.offers');
  const [days, setDays] = useState(60);
  const [minOrders, setMinOrders] = useState(0);
  const [minSpent, setMinSpent] = useState('');
  const [templateUuid, setTemplateUuid] = useState('');
  const [coupon, setCoupon] = useState('');
  const [confirming, setConfirming] = useState(false);
  const { busy, result, run, setResult } = useRun(kind, storeId);
  const shopify = kind === 'shopify';

  const go = () => {
    setConfirming(false);
    void run('winback', {
      templateUuid,
      days,
      minOrders,
      minSpent: Number(minSpent) || 0,
      ...(coupon !== '' ? { couponCode: coupon } : {}),
    });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (templateUuid === '') return setResult({ ok: false, message: t('pickTemplateFirst') });
    // The Shopify screen asks first (WaDesk confirms before a smart-segment send); WooCommerce sends straight away.
    if (shopify) setConfirming(true);
    else go();
  };

  const dayLabel = (d: number) =>
    d === 180 ? t('winMonths') : d === 365 ? t('winYear') : t('winDays', { days: d });

  return (
    <>
      <form onSubmit={submit} className={card}>
        <div>
          <h3 className="text-[19px] font-normal">{shopify ? t('winTitle') : t('wooWinTitle')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {shopify ? t('winIntro') : t('wooWinIntro')}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {shopify ? (
            <label className={label}>
              {t('winLast')}
              <Select
                className="mt-1.5"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={0}>{t('winAny')}</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <label className={label}>
              {t('wooLapsed')}
              <input
                type="number"
                min={0}
                max={365}
                value={days}
                onChange={(e) => setDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                className={input}
              />
            </label>
          )}
          <label className={label}>
            {t('winMinOrders')}
            {shopify ? (
              <Select
                className="mt-1.5"
                value={minOrders}
                onChange={(e) => setMinOrders(Number(e.target.value))}
              >
                {MIN_ORDERS.map((v) => (
                  <option key={v} value={v}>
                    {v === 0 ? t('winAnyOrders') : `${v}+`}
                  </option>
                ))}
              </Select>
            ) : (
              <input
                type="number"
                min={0}
                max={1000}
                value={minOrders}
                onChange={(e) =>
                  setMinOrders(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))
                }
                className={input}
              />
            )}
          </label>
          <label className={label}>
            {t('winMinSpend', { currency: data.currency })}
            <input
              type="number"
              min={0}
              step={shopify ? 1 : 0.01}
              value={minSpent}
              onChange={(e) => setMinSpent(e.target.value)}
              placeholder="0"
              className={input}
            />
          </label>
          <label className={label}>
            {t('winTemplate')}
            <Select
              className="mt-1.5"
              value={templateUuid}
              onChange={(e) => setTemplateUuid(e.target.value)}
            >
              <option value="">— {shopify ? t('winPick') : t('choose2')} —</option>
              {data.templates.map((tpl) => (
                <option key={tpl.uuid} value={tpl.uuid}>
                  {tplLabel(tpl)}
                </option>
              ))}
            </Select>
          </label>
          <label className={label}>
            {t('winCoupon')}
            {shopify ? (
              <Select className="mt-1.5" value={coupon} onChange={(e) => setCoupon(e.target.value)}>
                <option value="">— {t('winNone')} —</option>
                {data.coupons.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            ) : (
              <input
                list="ecom-coupons"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder={t('wooCouponPlaceholder2')}
                className={input}
                maxLength={64}
              />
            )}
          </label>
        </div>
        {!shopify && <p className="text-xs text-muted-foreground">{t('wooWinNote')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {result && <ResultLine ok={result.ok}>{result.message}</ResultLine>}
          </div>
          <button type="submit" disabled={busy} className={primaryButton}>
            <SendIcon className="size-3.5" />
            {shopify ? t('winSend') : t('wooWinSend')}
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title={t('winTitle')}
        message={t('winConfirm')}
        confirmLabel={t('winSend')}
        cancelLabel={t('cancel')}
        onConfirm={go}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/** The offers tab (WD-ECOM-014, 015): the offer composer and the smart-segment win-back broadcast. */
export function OffersTab({
  kind,
  storeId,
  data,
}: {
  kind: Kind;
  storeId: string;
  data: StoreDashboard;
}) {
  return (
    <div className="space-y-5">
      <OfferForm kind={kind} storeId={storeId} data={data} />
      <WinbackForm kind={kind} storeId={storeId} data={data} />
    </div>
  );
}
