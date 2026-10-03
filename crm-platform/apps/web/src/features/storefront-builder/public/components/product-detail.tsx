'use client';

import type { PublicProductPage } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { discountPercent, isOnSale, isSoldOut } from '../lib/catalog';
import { productPath, productQuestionUrl, shopPath } from '../lib/links';
import { formatMinor } from '../lib/money';
import { sanitizeHtml } from '../lib/sanitize';
import { CheckIcon, CompareIcon, HeartIcon, ShareIcon } from './icons';
import { ProductCard } from './product-card';
import { ProductImage } from './product-image';
import { ReviewForm } from './review-form';
import { useStore } from './store-provider';
import { useOrigin } from './use-origin';

const TABS = ['desc', 'ship', 'reviews'] as const;
type Tab = (typeof TABS)[number];

function Stars({ value }: { value: number }) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="sf-stars" aria-hidden="true">
      {'★'.repeat(full)}
      <span className="sf-stars-off">{'★'.repeat(5 - full)}</span>
    </span>
  );
}

/** The product page body (WD-STORE-010): gallery, buy box, tabs, reviews with the one review form, related products. */
export function ProductDetail({ page }: { page: PublicProductPage }) {
  const t = useTranslations('shopPublic');
  const { shop, product, related, reviews, ratingAvg, ratingCount } = page;
  const store = useStore();
  const { wish, compare, addQuantity, toggleWish, toggleCompare, openShare, toggleDrawer, drawer } =
    store;
  const uid = useId();
  const origin = useOrigin();

  const images = useMemo(
    () => [
      ...new Set([product.imageUrl, ...product.galleryUrls].filter((u): u is string => Boolean(u))),
    ],
    [product.imageUrl, product.galleryUrls],
  );
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState('1');
  const [tab, setTab] = useState<Tab>('desc');

  const soldOut = isSoldOut(product);
  const onSale = isOnSale(product);
  const wished = wish.includes(product.id);
  const compared = compare.includes(product.id);
  const home = shopPath(shop.slug);
  const url = `${origin}${productPath(shop.slug, product.slug)}`;
  const body = sanitizeHtml(product.bodyHtml, 'rich');
  const lowStock = product.stockQty !== null && product.stockQty <= 10;
  const freeAbove = shop.shipping.freeAboveMinor;

  const parsedQty = () => Math.max(1, Number.parseInt(qty || '1', 10) || 1);
  const add = () => {
    addQuantity(product, parsedQty());
    if (drawer !== 'cart') toggleDrawer('cart');
  };

  return (
    <>
      <div className="sf-pd">
        <div className="sf-pd-gallery">
          {images.length > 0 ? (
            <div className="sf-pd-thumbs" role="group" aria-label={t('product.gallery')}>
              {images.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  className={i === active ? 'is-on' : ''}
                  aria-pressed={i === active}
                  aria-label={t('product.showImage', { n: i + 1 })}
                  onClick={() => setActive(i)}
                >
                  <ProductImage src={src} alt="" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="sf-pd-main">
            <ProductImage
              key={images[active] ?? 'none'}
              src={images[active]}
              alt={product.name}
              eager
            />
          </div>
        </div>

        <div className="sf-pd-info">
          <nav className="sf-breadcrumb" aria-label={t('product.breadcrumb')}>
            <a href={home}>{shop.name}</a>
            <span aria-hidden="true">/</span>
            {product.category ? (
              <>
                <a href={`${home}#categories`}>{product.category}</a>
                <span aria-hidden="true">/</span>
              </>
            ) : null}
            <span aria-current="page">{product.name}</span>
          </nav>

          <h1>{product.name}</h1>

          <div className="sf-pd-price">
            <span className="sf-pd-now">{product.priceDisplay}</span>
            {onSale && product.comparePriceDisplay ? (
              <>
                <s className="sf-pd-was">{product.comparePriceDisplay}</s>
                <span className="sf-pd-save">
                  {t('product.save', { percent: discountPercent(product) })}
                </span>
              </>
            ) : null}
          </div>

          <div>
            {soldOut ? (
              <span className="sf-pd-stock is-out">{t('card.soldOut')}</span>
            ) : (
              <span className="sf-pd-stock">
                <CheckIcon size={11} />
                {lowStock
                  ? t('product.onlyLeft', { count: product.stockQty ?? 0 })
                  : t('product.inStock')}
              </span>
            )}
          </div>

          {product.description ? <p className="sf-pd-desc">{product.description}</p> : null}

          <div className="sf-pd-actions">
            <div className="sf-qty" role="group" aria-label={t('product.quantity')}>
              <button
                type="button"
                aria-label={t('cart.decrease')}
                onClick={() => setQty(String(Math.max(1, parsedQty() - 1)))}
              >
                −
              </button>
              <input
                type="number"
                min={1}
                value={qty}
                aria-label={t('product.quantity')}
                onChange={(e) => setQty(e.target.value)}
                onBlur={() => setQty(String(parsedQty()))}
              />
              <button
                type="button"
                aria-label={t('cart.increase')}
                onClick={() => setQty(String(parsedQty() + 1))}
              >
                +
              </button>
            </div>
            <button type="button" className="sf-cta sf-pd-add" disabled={soldOut} onClick={add}>
              {soldOut ? t('card.soldOut') : t('card.addToCart')}
            </button>
            <div className="sf-pd-icons">
              <button
                type="button"
                className={wished ? 'is-on' : ''}
                aria-pressed={wished}
                aria-label={t(wished ? 'card.removeWish' : 'card.addWish', { name: product.name })}
                onClick={() => toggleWish(product.id)}
              >
                <HeartIcon />
              </button>
              <button
                type="button"
                className={compared ? 'is-on is-compare' : ''}
                aria-pressed={compared}
                aria-label={t(compared ? 'product.removeCompare' : 'product.addCompare')}
                onClick={() => toggleCompare(product.id)}
              >
                <CompareIcon />
              </button>
              <button
                type="button"
                aria-label={t('product.share')}
                title={t('product.shareTitle')}
                onClick={() => openShare(url, product.name)}
              >
                <ShareIcon />
              </button>
            </div>
          </div>

          {shop.waNumber ? (
            <a
              className="sf-cta-ghost sf-pd-ask"
              href={productQuestionUrl(shop.waNumber, product.name, url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('product.ask')}
            </a>
          ) : null}

          <dl className="sf-pd-meta">
            {product.sku ? (
              <>
                <dt>{t('product.sku')}</dt>
                <dd>{product.sku}</dd>
              </>
            ) : null}
            {product.category ? (
              <>
                <dt>{t('product.category')}</dt>
                <dd>{product.category}</dd>
              </>
            ) : null}
            {product.weightGrams ? (
              <>
                <dt>{t('product.weight')}</dt>
                <dd>{t('product.grams', { count: product.weightGrams })}</dd>
              </>
            ) : null}
            <dt>{t('product.delivery')}</dt>
            <dd>{t('product.deliveryTime')}</dd>
            {product.tags && product.tags.length > 0 ? (
              <>
                <dt>{t('product.tags')}</dt>
                <dd>
                  {product.tags.map((tag) => (
                    <span key={tag} className="sf-tag">
                      {tag}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="sf-tabs">
        <div className="sf-tabs-head" role="tablist" aria-label={t('product.tabs.label')}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${uid}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${uid}-pane-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? 'is-on' : ''}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                const at = TABS.indexOf(id);
                const next =
                  e.key === 'ArrowRight'
                    ? (at + 1) % TABS.length
                    : e.key === 'ArrowLeft'
                      ? (at + TABS.length - 1) % TABS.length
                      : -1;
                if (next >= 0) {
                  e.preventDefault();
                  setTab(TABS[next]!);
                  document.getElementById(`${uid}-tab-${TABS[next]}`)?.focus();
                }
              }}
            >
              {t(`product.tabs.${id}`)}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`${uid}-pane-desc`}
          aria-labelledby={`${uid}-tab-desc`}
          className="sf-tabs-pane"
          hidden={tab !== 'desc'}
        >
          {body ? (
            <div className="sf-richtext" dangerouslySetInnerHTML={{ __html: body }} />
          ) : (
            <p>{product.description || t('product.noDescription')}</p>
          )}
        </div>

        <div
          role="tabpanel"
          id={`${uid}-pane-ship`}
          aria-labelledby={`${uid}-tab-ship`}
          className="sf-tabs-pane"
          hidden={tab !== 'ship'}
        >
          <p>
            <strong>{t('product.shippingHeading')}</strong> {t('product.shippingBody')}
            {freeAbove > 0
              ? ` ${t('product.freeAbove', { amount: formatMinor(freeAbove, shop.currencyCode) })}`
              : ''}
          </p>
          <p>
            <strong>{t('product.returnsHeading')}</strong> {t('product.returnsBody')}
          </p>
        </div>

        <div
          role="tabpanel"
          id={`${uid}-pane-reviews`}
          aria-labelledby={`${uid}-tab-reviews`}
          className="sf-tabs-pane"
          hidden={tab !== 'reviews'}
        >
          {ratingCount > 0 && ratingAvg !== null ? (
            <>
              <div className="sf-rating-sum">
                <span className="sf-rating-avg">{ratingAvg}</span>
                <Stars value={ratingAvg} />
                <span className="sf-rating-count">
                  {t('product.reviewCount', { count: ratingCount })}
                </span>
              </div>
              <ul className="sf-reviews">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <div className="sf-review-head">
                      <strong>{r.customerName || t('product.anonymous')}</strong>
                      <Stars value={r.rating} />
                      <span className="sf-sr">{t('product.ratingOf', { rating: r.rating })}</span>
                    </div>
                    {r.body ? <p>{r.body}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t('product.noReviews')}</p>
          )}
          <ReviewForm productId={product.id} />
        </div>
      </div>

      {related.length > 0 ? (
        <section className="sf-related" aria-labelledby={`${uid}-related`}>
          <h2 id={`${uid}-related`}>{t('product.related')}</h2>
          <div className="sf-related-grid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
