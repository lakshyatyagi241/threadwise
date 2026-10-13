'use client';

import type { PublicProduct } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useRef, type ReactNode } from 'react';
import { cartTotal, shippingRow } from '../lib/cart';
import { formatMinor } from '../lib/money';
import { productPath } from '../lib/links';
import { fromPrice, hasVariants } from '../lib/variants';
import { BagIcon, BigCompareIcon, BigHeartIcon } from './icons';
import { ProductImage } from './product-image';
import { useStore, type DrawerKind } from './store-provider';
import { useDialog } from './use-dialog';

function Drawer({
  kind,
  title,
  wide = false,
  children,
  footer,
}: {
  kind: DrawerKind;
  title: string;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations('shopPublic');
  const { drawer, closeDrawer, modal } = useStore();
  const open = drawer === kind;
  const panel = useRef<HTMLElement>(null);
  // While a dialog sits on top of the drawer (checkout), the dialog owns focus and Escape.
  useDialog(panel, open && modal === null, closeDrawer);
  return (
    <div className="sf-drawer" data-open={open ? '1' : '0'} inert={!open}>
      <div className="sf-drawer-backdrop" onClick={closeDrawer} aria-hidden="true" />
      <aside
        ref={panel}
        className={`sf-drawer-panel${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`sf-drawer-${kind}-title`}
        tabIndex={-1}
      >
        <header className="sf-drawer-head">
          <h2 id={`sf-drawer-${kind}-title`}>{title}</h2>
          <button type="button" onClick={closeDrawer} aria-label={t('common.close')}>
            ×
          </button>
        </header>
        <div className="sf-drawer-body">{children}</div>
        {footer}
      </aside>
    </div>
  );
}

function Empty({
  icon,
  title,
  body,
  cta,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta?: ReactNode;
}) {
  return (
    <div className="sf-empty">
      {icon}
      <div className="sf-empty-title">{title}</div>
      <div className="sf-empty-body">{body}</div>
      {cta}
    </div>
  );
}

const PAY_LABELS: Record<string, 'upi' | 'razorpay' | 'card' | 'paypal' | 'bank'> = {
  upi: 'upi',
  razorpay_link: 'razorpay',
  stripe_link: 'card',
  paypal_me: 'paypal',
  bank_transfer: 'bank',
};

export function CartDrawer() {
  const t = useTranslations('shopPublic');
  const {
    shop,
    shipping,
    cart,
    cartSubtotal,
    setLineQty,
    removeFromCart,
    openCheckout,
    closeDrawer,
  } = useStore();
  const cur = shop.currencyCode;
  const money = (minor: number) => formatMinor(minor, cur);
  const row = shippingRow(shipping, cartSubtotal);
  const payKey = PAY_LABELS[shop.payment.provider ?? ''];

  const footer = (
    <footer className="sf-drawer-foot">
      <div className="sf-sum-row">
        <span>{t('cart.subtotal')}</span>
        <span className="sf-mono">{money(cartSubtotal)}</span>
      </div>
      {row.kind === 'free' ? (
        <div className="sf-sum-row is-free">
          <span>{t('cart.shipping')}</span>
          <span className="sf-mono">{t('cart.free')}</span>
        </div>
      ) : null}
      {row.kind === 'fee' ? (
        <>
          <div className="sf-sum-row">
            <span>{t('cart.shipping')}</span>
            <span className="sf-mono">{money(row.fee)}</span>
          </div>
          {row.remaining > 0 ? (
            <div className="sf-ship-hint">
              {t('cart.addForFree', { amount: money(row.remaining) })}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="sf-sum-row is-total">
        <span>{t('cart.total')}</span>
        <span className="sf-mono">{money(cartTotal(cart, shipping))}</span>
      </div>
      {shipping.note ? <div className="sf-ship-note">{shipping.note}</div> : null}
      <button type="button" className="sf-order-btn" onClick={openCheckout}>
        {t('cart.order')}
      </button>
      <div className="sf-pay-caption">
        {payKey ? t('cart.payVia', { method: t(`cart.methods.${payKey}`) }) : t('cart.codOnly')}
      </div>
    </footer>
  );

  return (
    <Drawer kind="cart" title={t('cart.title')} footer={footer}>
      {cart.length === 0 ? (
        <Empty
          icon={<BagIcon />}
          title={t('cart.emptyTitle')}
          body={t('cart.emptyBody')}
          cta={
            <button type="button" className="sf-empty-cta" onClick={closeDrawer}>
              {t('cart.keepBrowsing')}
            </button>
          }
        />
      ) : (
        <ul className="sf-lines">
          {cart.map((line) => (
            <li key={`${line.id}:${line.variantId ?? ''}`} className="sf-cart-row">
              <div className="sf-cart-img">
                <ProductImage src={line.image} alt="" emoji />
              </div>
              <div className="sf-cart-meta">
                <div className="sf-cart-name">{line.name}</div>
                {line.variantTitle ? (
                  <div className="sf-cart-variant">{line.variantTitle}</div>
                ) : null}
                <div className="sf-cart-price">
                  {money(line.price)} × {line.qty}
                </div>
                <div
                  className="sf-qty"
                  role="group"
                  aria-label={t('cart.quantityOf', { name: line.name })}
                >
                  <button
                    type="button"
                    aria-label={t('cart.decrease')}
                    onClick={() => setLineQty(line.id, line.qty - 1, line.variantId)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    key={line.qty}
                    defaultValue={line.qty}
                    aria-label={t('cart.quantityOf', { name: line.name })}
                    onBlur={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      // Show what the cart really holds afterwards (a typed 10 on a stock of 3 reads 3).
                      const at =
                        n !== line.qty
                          ? setLineQty(line.id, Number.isFinite(n) ? n : 1, line.variantId)
                          : line.qty;
                      e.target.value = String(at);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                  <button
                    type="button"
                    aria-label={t('cart.increase')}
                    onClick={() => setLineQty(line.id, line.qty + 1, line.variantId)}
                  >
                    +
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="sf-cart-remove"
                aria-label={t('cart.remove', { name: line.name })}
                onClick={() => removeFromCart(line.id, line.variantId)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export function WishDrawer() {
  const t = useTranslations('shopPublic');
  const { shop, wish, catalog, addToCart, toggleWish } = useStore();
  const items = wish.map((id) => catalog[id]).filter((p): p is PublicProduct => p !== undefined);
  return (
    <Drawer kind="wish" title={t('wish.title')}>
      {items.length === 0 ? (
        <Empty icon={<BigHeartIcon />} title={t('wish.emptyTitle')} body={t('wish.emptyBody')} />
      ) : (
        <ul className="sf-lines">
          {items.map((p) => (
            <li key={p.id} className="sf-cart-row">
              <a className="sf-cart-img" href={productPath(shop.slug, p.slug)} aria-label={p.name}>
                <ProductImage src={p.imageUrl} alt="" emoji />
              </a>
              <div className="sf-cart-meta">
                <a className="sf-cart-name" href={productPath(shop.slug, p.slug)}>
                  {p.name}
                </a>
                <div className="sf-cart-price">
                  {hasVariants(p) && fromPrice(p).varies
                    ? t('variant.from', { price: fromPrice(p).display })
                    : hasVariants(p)
                      ? fromPrice(p).display
                      : p.priceDisplay}
                </div>
                {hasVariants(p) ? (
                  <a className="sf-mini-btn" href={productPath(shop.slug, p.slug)}>
                    {t('card.chooseOptions')}
                  </a>
                ) : (
                  <button type="button" className="sf-mini-btn" onClick={() => addToCart(p)}>
                    {t('card.addToCart')}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="sf-cart-remove"
                aria-label={t('wish.remove', { name: p.name })}
                onClick={() => toggleWish(p.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export function CompareDrawer() {
  const t = useTranslations('shopPublic');
  const { shop, compare, catalog, toggleCompare } = useStore();
  const cols = compare.map((id) => catalog[id]).filter((p): p is PublicProduct => p !== undefined);
  return (
    <Drawer kind="compare" title={t('compare.title')} wide>
      {cols.length === 0 ? (
        <Empty
          icon={<BigCompareIcon />}
          title={t('compare.emptyTitle')}
          body={t('compare.emptyBody')}
        />
      ) : (
        <div className="sf-compare-scroll">
          <table className="sf-compare-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sf-sr">{t('compare.attribute')}</span>
                </th>
                {cols.map((p) => (
                  <th key={p.id} scope="col">
                    <button
                      type="button"
                      className="sf-cmp-x"
                      aria-label={t('compare.remove', { name: p.name })}
                      onClick={() => toggleCompare(p.id)}
                    >
                      ×
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{t('compare.rows.image')}</th>
                {cols.map((p) => (
                  <td key={p.id}>
                    <div className="sf-compare-img">
                      <ProductImage src={p.imageUrl} alt={p.name} emoji />
                    </div>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.rows.name')}</th>
                {cols.map((p) => (
                  <td key={p.id}>
                    <a href={productPath(shop.slug, p.slug)} className="sf-strong">
                      {p.name}
                    </a>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.rows.price')}</th>
                {cols.map((p) => (
                  <td key={p.id}>
                    {hasVariants(p) && fromPrice(p).varies
                      ? t('variant.from', { price: fromPrice(p).display })
                      : hasVariants(p)
                        ? fromPrice(p).display
                        : p.priceDisplay}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.rows.sku')}</th>
                {cols.map((p) => (
                  <td key={p.id}>{p.sku || '—'}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.rows.category')}</th>
                {cols.map((p) => (
                  <td key={p.id}>{p.category || '—'}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.rows.description')}</th>
                {cols.map((p) => (
                  <td key={p.id}>{p.description || '—'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}

/** The sticky strip at the bottom while one or more products are in the compare list. */
export function CompareBar() {
  const t = useTranslations('shopPublic');
  const { compare, catalog, toggleCompare, toggleDrawer, drawer } = useStore();
  if (compare.length === 0 || drawer === 'compare') return null;
  const chips = compare.map((id) => catalog[id]).filter((p): p is PublicProduct => p !== undefined);
  return (
    <div className="sf-compare-bar" role="region" aria-label={t('compare.bar')}>
      <div>
        {chips.map((p) => (
          <div key={p.id} className="sf-cmp-chip">
            <span className="sf-cmp-thumb">
              <ProductImage src={p.imageUrl} alt="" emoji />
            </span>
            <span className="sf-cmp-name">{p.name}</span>
            <button
              type="button"
              className="sf-cmp-x"
              aria-label={t('compare.remove', { name: p.name })}
              onClick={() => toggleCompare(p.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="sf-cmp-cta" onClick={() => toggleDrawer('compare')}>
        {t('compare.open')}
      </button>
    </div>
  );
}
