import type { PublicOrder } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { orderQuestionUrl, safeHttpUrl } from '../lib/links';
import { footerParts } from '../lib/footer';
import { DEFAULT_BRAND, isHexColor } from '../lib/themes';
import { TRACK_STEPS, isCancelled, statusLabel, trackerIndex } from '../lib/tracker';
import { formatMinor } from '../lib/money';
import '../styles/storefront.css';
import { CardIcon, CheckIcon, PackageIcon, WhatsAppIcon } from './icons';

/** The order tracking page (TW-STORE-017): narrow, light, read-only. The token in the URL is the only access control. */
export function OrderTracking({ data }: { data: PublicOrder }) {
  const t = useTranslations('shopPublic');
  const { shop, order } = data;
  const brand = isHexColor(shop.brandColor) ? shop.brandColor : DEFAULT_BRAND;
  const money = (minor: number) => formatMinor(minor, order.currencyCode);
  const cancelled = isCancelled(order.status);
  const reached = trackerIndex(order.status);
  // Reference's page shows total minus shipping as the subtotal (a coupon is already inside it) and has no discount row.
  const subtotal = order.totalMinor - order.shippingMinor;
  const payLink = order.status.toLowerCase() !== 'paid' ? safeHttpUrl(order.paymentLink) : null;
  const footer = footerParts(shop).bottom;
  const style = { '--sf-brand': brand } as CSSProperties;

  return (
    <div className="sf-order" style={style}>
      <div className="sf-order-wrap">
        <div className="sf-ot-bar">
          {shop.logoUrl ? (
            <img className="sf-ot-logo" src={shop.logoUrl} alt="" />
          ) : (
            <span className="sf-ot-logo" aria-hidden="true">
              {shop.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <div className="sf-ot-muted">{shop.name}</div>
            <h1 className="sf-ot-h1">{t('order.title', { orderNo: order.orderNo })}</h1>
          </div>
          <span className={`sf-ot-pill${cancelled ? ' is-cancelled' : ''}`}>
            {statusLabel(order.status)}
          </span>
        </div>

        <section className="sf-ot-card" aria-label={t('order.progress')}>
          {cancelled ? (
            <div className="sf-ot-muted sf-ot-center">{t('order.cancelled')}</div>
          ) : (
            <ol className="sf-ot-steps">
              {TRACK_STEPS.map((step, i) => (
                <li
                  key={step}
                  className={i <= reached ? 'is-done' : ''}
                  aria-current={i === reached ? 'step' : undefined}
                >
                  <span className="sf-ot-dot">
                    {i <= reached ? <CheckIcon size={12} strokeWidth={2.4} /> : null}
                  </span>
                  <span className="sf-ot-lbl">{t(`order.steps.${step}`)}</span>
                  <span className="sf-sr">
                    {i <= reached ? t('order.stepDone') : t('order.stepTodo')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="sf-ot-card" aria-label={t('order.items')}>
          <ul className="sf-ot-items">
            {order.items.map((item, i) => (
              <li key={`${item.name}-${i}`} className="sf-ot-row">
                {item.image ? (
                  <img src={item.image} alt="" />
                ) : (
                  <span className="sf-ot-ph" aria-hidden="true">
                    <PackageIcon size={20} />
                  </span>
                )}
                <div>
                  <div className="sf-ot-nm">{item.name || '—'}</div>
                  <div className="sf-ot-qty">
                    {t('order.qty', { qty: item.qty, price: money(item.priceMinor) })}
                  </div>
                </div>
                <div className="sf-ot-amt">{money(item.priceMinor * item.qty)}</div>
              </li>
            ))}
          </ul>
          <dl className="sf-ot-totals">
            <div>
              <dt>{t('cart.subtotal')}</dt>
              <dd>{money(subtotal)}</dd>
            </div>
            <div>
              <dt>{t('cart.shipping')}</dt>
              <dd>{order.shippingMinor > 0 ? money(order.shippingMinor) : t('order.free')}</dd>
            </div>
            <div className="is-grand">
              <dt>{t('cart.total')}</dt>
              <dd>{money(order.totalMinor)}</dd>
            </div>
          </dl>
        </section>

        {order.customerAddress ? (
          <section className="sf-ot-card" aria-label={t('order.deliveryTo')}>
            <div className="sf-ot-k">{t('order.deliveryTo')}</div>
            {order.customerName ? <div className="sf-ot-name">{order.customerName}</div> : null}
            <div className="sf-ot-muted sf-ot-pre">{order.customerAddress}</div>
          </section>
        ) : null}

        {payLink ? (
          <a className="sf-ot-btn is-pay" href={payLink} rel="noopener noreferrer">
            <CardIcon size={16} />
            {t('order.payNow')}
          </a>
        ) : null}
        {shop.waNumber ? (
          <a
            className="sf-ot-btn"
            href={orderQuestionUrl(shop.waNumber, order.orderNo)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <WhatsAppIcon size={16} />
            {t('order.message')}
          </a>
        ) : null}

        {footer ? (
          <p
            className="sf-ot-muted sf-ot-center sf-ot-foot"
            dangerouslySetInnerHTML={{ __html: footer }}
          />
        ) : (
          <p className="sf-ot-muted sf-ot-center sf-ot-foot">
            {t('footer.copyright', { year: new Date().getFullYear(), shop: shop.name })}
          </p>
        )}
      </div>
    </div>
  );
}
