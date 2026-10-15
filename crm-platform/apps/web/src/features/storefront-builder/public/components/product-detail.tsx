'use client';

import type { PublicProductPage } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { discountPercent, isOnSale, isSoldOut } from '../lib/catalog';
import {
  allVariantsSoldOut,
  emptySelection,
  findVariant,
  firstMissingOption,
  fromPrice,
  hasVariants,
  selectionComplete,
  variantSoldOut,
  type Selection,
} from '../lib/variants';
import { productPath, productQuestionUrl, shopPath } from '../lib/links';
import { LEGACY_FREE_THRESHOLD_MINOR, formatIn } from '../lib/money';
import { sanitizeHtml } from '../lib/sanitize';
import { CheckIcon, CompareIcon, HeartIcon, ShareIcon } from './icons';
import { ProductCard } from './product-card';
import { ProductImage } from './product-image';
import { ReviewForm } from './review-form';
import { VariantPicker } from './variant-picker';
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

/** The rating summary, the approved reviews and the review form: rendered in the Reviews tab and again in the page's Reviews block. */
function ReviewsBlock({ page }: { page: PublicProductPage }) {
  const t = useTranslations('shopPublic');
  const { product, reviews, ratingAvg, ratingCount } = page;
  return (
    <>
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
        <p className="sf-reviews-empty">{t('product.noReviews')}</p>
      )}
      <ReviewForm productId={product.id} />
    </>
  );
}

/** The product page body (TW-STORE-010): gallery, buy box, tabs, reviews with the one review form, related products. */
export function ProductDetail({ page }: { page: PublicProductPage }) {
  const t = useTranslations('shopPublic');
  const { shop, product, related } = page;
  const store = useStore();
  const { wish, compare, addQuantity, toggleWish, toggleCompare, openShare, toggleDrawer, drawer } =
    store;
  const uid = useId();
  const origin = useOrigin();

  const variantProduct = hasVariants(product);
  const images = useMemo(
    () => [
      ...new Set(
        [
          product.imageUrl,
          ...product.galleryUrls,
          ...(product.variants ?? []).map((v) => v.imageUrl),
        ].filter((u): u is string => Boolean(u)),
      ),
    ],
    [product.imageUrl, product.galleryUrls, product.variants],
  );
  const [active, setActive] = useState(0);
  const [selection, setSelection] = useState<Selection>(() => emptySelection(product));
  const variant = findVariant(product, selection);
  const complete = selectionComplete(selection);
  const missing = firstMissingOption(selection);
  const choose = (next: Selection) => {
    setSelection(next);
    // A variant with its own picture takes the main image.
    const img = findVariant(product, next)?.imageUrl;
    const at = img ? images.indexOf(img) : -1;
    if (at >= 0) setActive(at);
  };
  const [qty, setQty] = useState('1');
  const [tab, setTab] = useState<Tab>('desc');

  // What the price, compare price and stock lines show: the chosen variant, else (variants, nothing chosen yet) "From <lowest>".
  const from = fromPrice(product);
  const shown = variant ?? product;
  const soldOut = variantProduct
    ? allVariantsSoldOut(product) || (variant ? variantSoldOut(variant) : false)
    : isSoldOut(product);
  const onSale = isOnSale(shown);
  const wished = wish.includes(product.id);
  const compared = compare.includes(product.id);
  const home = shopPath(shop.slug);
  const url = `${origin}${productPath(shop.slug, product.slug)}`;
  const body = sanitizeHtml(product.bodyHtml, 'rich');
  const stockQty = variantProduct ? (variant ? variant.stockQty : null) : product.stockQty;
  const lowStock = stockQty !== null && stockQty <= 10;
  const needsChoice = variantProduct && !variant;
  const noCombination = variantProduct && complete && !variant;

  const parsedQty = () => Math.max(1, Number.parseInt(qty || '1', 10) || 1);
  const add = () => {
    // QUIRK (Reference): no stock cap here, the page's own product is in the browser catalog without a stock quantity.
    if (variantProduct && !variant) return;
    addQuantity({ ...product, stockQty: null }, parsedQty(), variant);
    if (drawer !== 'cart') toggleDrawer('cart');
  };

  return (
    <>
      <div className="sf-pd">
        <div className="sf-pd-gallery">
          {/* The column is there even without images (Reference keeps the empty 84px thumbnail track). */}
          <div
            className="sf-pd-thumbs"
            role={images.length > 0 ? 'group' : undefined}
            aria-label={images.length > 0 ? t('product.gallery') : undefined}
          >
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
            <a href={home}>{shop.name}</a> <span aria-hidden="true">/</span>{' '}
            {product.category ? (
              <>
                <a href={`${home}#categories`}>{product.category}</a>{' '}
                <span aria-hidden="true">/</span>{' '}
              </>
            ) : null}
            <span aria-current="page">{product.name}</span>
          </nav>

          <h1>{product.name}</h1>

          <div className="sf-pd-price">
            <span className="sf-pd-now">
              {variant
                ? variant.priceDisplay
                : variantProduct && from.varies
                  ? t('variant.from', { price: from.display })
                  : variantProduct
                    ? from.display
                    : product.priceDisplay}
            </span>
            {onSale && shown.comparePriceDisplay ? (
              <>
                <s className="sf-pd-was">{shown.comparePriceDisplay}</s>
                <span className="sf-pd-save">
                  {t('product.save', { percent: discountPercent(shown) })}
                </span>
              </>
            ) : null}
          </div>

          {variantProduct ? (
            <VariantPicker product={product} selection={selection} onChange={choose} />
          ) : null}

          <div aria-live="polite">
            {needsChoice && !soldOut ? null : soldOut ? (
              <span className="sf-pd-stock is-out">{t('card.soldOut')}</span>
            ) : (
              <span className="sf-pd-stock">
                <CheckIcon size={11} />
                {lowStock ? t('product.onlyLeft', { count: stockQty ?? 0 }) : t('product.inStock')}
              </span>
            )}
          </div>

          {needsChoice && !soldOut ? (
            <p className="sf-variant-prompt" id={`${uid}-choose`} role="status">
              {noCombination
                ? t('variant.unavailable')
                : t('variant.select', { option: product.options?.[missing]?.name ?? '' })}
            </p>
          ) : null}

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
            <button
              type="button"
              className="sf-cta sf-pd-add"
              disabled={soldOut || needsChoice}
              aria-describedby={needsChoice ? `${uid}-choose` : undefined}
              onClick={add}
            >
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
            {(variant?.sku ?? product.sku) ? (
              <>
                <dt>{t('product.sku')}</dt>
                <dd>{variant?.sku ?? product.sku}</dd>
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
            {` ${t('product.freeAbove', { amount: formatIn(LEGACY_FREE_THRESHOLD_MINOR, shop.currencyCode) })}`}
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
          <ReviewsBlock page={page} />
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

      <section className="sf-reviews-section">
        <h2>{t('product.tabs.reviews')}</h2>
        <div className="sf-reviews-box">
          <ReviewsBlock page={page} />
        </div>
      </section>
    </>
  );
}
