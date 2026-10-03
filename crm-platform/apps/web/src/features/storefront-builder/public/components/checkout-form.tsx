'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { postAbandon, postCheckout, postCoupon, type CallResult } from '../api/client';
import { cartTotal, toRequestItems } from '../lib/cart';
import { isWaHandoff } from '../lib/links';
import { formatMinor } from '../lib/money';
import { useStore } from './store-provider';

type Tone = 'ok' | 'error';
type Line = { tone: Tone; text: string } | null;

/** One beacon per page load and shop, like Reference. */
const abandonSent = new Set<string>();

/** The checkout form (TW-STORE-012): collects the buyer's details, quotes the coupon, posts the order, then hands off to WhatsApp. */
export function CheckoutForm() {
  const t = useTranslations('shopPublic');
  const { shop, shipping, cart, clearCart, openModal } = useStore();
  const uid = useId();
  const cur = shop.currencyCode;
  const money = (minor: number) => formatMinor(minor, cur);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [coupon, setCoupon] = useState('');
  const [acceptedCode, setAcceptedCode] = useState<string | null>(null);
  const [method, setMethod] = useState<'prepaid' | 'cod'>('prepaid');
  const [couponLine, setCouponLine] = useState<Line>(null);
  const [status, setStatus] = useState<Line>(null);
  const [busy, setBusy] = useState(false);

  const digits = (v: string) => v.replace(/\D/g, '').length;
  const itemsLabel = t('checkout.summary', {
    count: cart.length,
    total: money(cartTotal(cart, shipping)),
  });

  const errorText = (
    res: Extract<CallResult<unknown>, { ok: false }>,
    fallback: string,
  ): string => {
    if (res.kind === 'network') return t('checkout.network');
    switch (res.code) {
      case 'STORE_ITEMS_UNAVAILABLE':
        return t('errors.itemsUnavailable');
      case 'STORE_NOT_AVAILABLE':
        return t('errors.notAvailable');
      case 'RATE_LIMITED':
        return t('errors.rateLimited');
      default:
        return res.message ?? fallback;
    }
  };

  const fireAbandon = () => {
    if (abandonSent.has(shop.slug) || cart.length === 0 || digits(phone) < 7) return;
    abandonSent.add(shop.slug);
    // Best effort: the buyer never sees the outcome.
    void postAbandon(shop.slug, {
      name: name.trim() || null,
      phone: phone.trim(),
      items: toRequestItems(cart),
    });
  };

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) {
      setAcceptedCode(null);
      setCouponLine(null);
      return;
    }
    const res = await postCoupon(shop.slug, { code, items: toRequestItems(cart) });
    if (res.ok) {
      setAcceptedCode(res.data.code);
      const total = money(res.data.totalMinor);
      setCouponLine({
        tone: 'ok',
        text:
          res.data.freeShipping && !res.data.discountMinor
            ? t('checkout.couponFree', { total })
            : t('checkout.couponSave', { discount: money(res.data.discountMinor), total }),
      });
      return;
    }
    setAcceptedCode(null);
    if (res.kind === 'network') setCouponLine({ tone: 'error', text: t('checkout.couponNetwork') });
    else if (res.code === 'STORE_COUPON_INVALID')
      setCouponLine({ tone: 'error', text: t('checkout.couponInvalid') });
    else setCouponLine({ tone: 'error', text: errorText(res, t('checkout.couponFallback')) });
  };

  const submit = async () => {
    if (busy) return;
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName) return setStatus({ tone: 'error', text: t('checkout.nameRequired') });
    if (digits(trimmedPhone) < 7)
      return setStatus({ tone: 'error', text: t('checkout.phoneInvalid') });
    if (cart.length === 0) return setStatus({ tone: 'error', text: t('checkout.cartEmpty') });

    setBusy(true);
    setStatus(null);
    const res = await postCheckout(
      shop.slug,
      {
        name: trimmedName,
        phone: trimmedPhone,
        address: address.trim() || null,
        note: note.trim() || null,
        coupon: coupon.trim() || acceptedCode || null,
        paymentMethod: method,
        items: toRequestItems(cart),
      },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (!res.ok) {
      setStatus({ tone: 'error', text: errorText(res, t('checkout.failed')) });
      return;
    }
    // Order recorded: the cart is done with, whatever happens to the hand-off.
    clearCart();
    const waUrl = isWaHandoff(res.data.waUrl) ? res.data.waUrl : null;
    openModal({
      kind: 'placed',
      message: res.data.message,
      trackUrl: res.data.trackUrl,
      orderNo: res.data.orderNo,
      waUrl,
    });
    if (waUrl) window.location.assign(waUrl);
  };

  return (
    <form
      className="sf-checkout"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="sf-checkout-summary">{itemsLabel}</p>

      <label className="sf-field" htmlFor={`${uid}-name`}>
        <span>{t('checkout.name')}</span>
        <input
          id={`${uid}-name`}
          value={name}
          maxLength={120}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="sf-field" htmlFor={`${uid}-phone`}>
        <span>{t('checkout.phone')}</span>
        <input
          id={`${uid}-phone`}
          type="tel"
          inputMode="tel"
          maxLength={32}
          autoComplete="tel"
          placeholder={t('checkout.phonePlaceholder')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={fireAbandon}
        />
      </label>
      <label className="sf-field" htmlFor={`${uid}-addr`}>
        <span>{t('checkout.address')}</span>
        <textarea
          id={`${uid}-addr`}
          rows={2}
          maxLength={1000}
          autoComplete="street-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="sf-field" htmlFor={`${uid}-note`}>
        <span>{t('checkout.note')}</span>
        <input
          id={`${uid}-note`}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="sf-coupon">
        <label className="sf-field" htmlFor={`${uid}-coupon`}>
          <span>{t('checkout.coupon')}</span>
          <input
            id={`${uid}-coupon`}
            className="is-upper"
            maxLength={64}
            autoComplete="off"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
          />
        </label>
        <button type="button" className="sf-cta-ghost" onClick={() => void applyCoupon()}>
          {t('checkout.apply')}
        </button>
      </div>
      <div
        className={`sf-form-msg${couponLine ? ` is-${couponLine.tone}` : ''}`}
        role="status"
        aria-live="polite"
      >
        {couponLine?.text}
      </div>

      <fieldset className="sf-pay">
        <legend>{t('checkout.payment')}</legend>
        <label>
          <input
            type="radio"
            name={`${uid}-pay`}
            value="prepaid"
            checked={method === 'prepaid'}
            onChange={() => setMethod('prepaid')}
          />
          {t('checkout.prepaid')}
        </label>
        <label>
          <input
            type="radio"
            name={`${uid}-pay`}
            value="cod"
            checked={method === 'cod'}
            onChange={() => setMethod('cod')}
          />
          {t('checkout.cod')}
        </label>
      </fieldset>

      <div className={`sf-form-msg${status ? ` is-${status.tone}` : ''}`} role="alert">
        {status?.text}
      </div>
      <button type="submit" className="sf-cta sf-cta-wide" disabled={busy}>
        {busy ? t('checkout.placing') : t('checkout.place')}
      </button>
    </form>
  );
}
