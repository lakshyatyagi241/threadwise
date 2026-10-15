'use client';

import type { PublicProduct } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { discountPercent, isOnSale, isSoldOut } from '../lib/catalog';
import { productPath } from '../lib/links';
import { allVariantsSoldOut, fromPrice, hasVariants, variantCount } from '../lib/variants';
import { EyeIcon, HeartIcon } from './icons';
import { ProductImage } from './product-image';
import { useStore } from './store-provider';

export function ProductCard({ product }: { product: PublicProduct }) {
  const t = useTranslations('shopPublic');
  const { shop, wish, addToCart, toggleWish, openQuickView } = useStore();
  const variants = hasVariants(product);
  const from = fromPrice(product);
  const soldOut = variants ? allVariantsSoldOut(product) : isSoldOut(product);
  const onSale = isOnSale(product);
  const wished = wish.includes(product.id);
  const href = productPath(shop.slug, product.slug);
  return (
    <article className="sf-card" data-product-id={product.id}>
      <a href={href} className="sf-card-img" tabIndex={-1} aria-hidden="true">
        <ProductImage src={product.imageUrl} alt="" />
        <span className="sf-card-badge">
          {onSale ? <span>−{discountPercent(product)}%</span> : null}
          {product.isNew ? <span className="is-new">{t('card.new')}</span> : null}
          {soldOut ? <span className="is-out">{t('card.soldOut')}</span> : null}
        </span>
      </a>
      <button
        type="button"
        className={`sf-wish${wished ? ' is-on' : ''}`}
        aria-pressed={wished}
        aria-label={t(wished ? 'card.removeWish' : 'card.addWish', { name: product.name })}
        onClick={() => toggleWish(product.id)}
      >
        <HeartIcon size={14} />
      </button>
      <button
        type="button"
        className="sf-quick"
        aria-label={t('card.quickView', { name: product.name })}
        title={t('card.quickViewTitle')}
        onClick={() => openQuickView(product)}
      >
        <EyeIcon size={14} />
      </button>
      <div className="sf-card-body">
        {product.category ? <div className="sf-card-cat">{product.category}</div> : null}
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        <div className="sf-card-price">
          <b>
            {variants && from.varies
              ? t('variant.from', { price: from.display })
              : variants
                ? from.display
                : product.priceDisplay}
          </b>
          {onSale && product.comparePriceDisplay ? (
            <s className="sf-card-was">
              <span className="sf-sr">{t('card.was')}</span>
              {product.comparePriceDisplay}
            </s>
          ) : null}
        </div>
        {variants ? (
          <div className="sf-card-options">
            {t('variant.optionsCount', { count: variantCount(product) })}
          </div>
        ) : null}
        {variants && !soldOut ? (
          // A variant product is bought from its page, where the buyer picks size, colour...
          <a
            className="sf-add sf-add-link"
            href={href}
            aria-label={t('card.chooseOptionsNamed', { name: product.name })}
          >
            {t('card.chooseOptions')}
          </a>
        ) : (
          <button
            type="button"
            className="sf-add"
            disabled={soldOut}
            aria-label={t(soldOut ? 'card.soldOutNamed' : 'card.addToCartNamed', {
              name: product.name,
            })}
            onClick={() => addToCart(product)}
          >
            {soldOut ? t('card.soldOut') : t('card.addToCart')}
          </button>
        )}
      </div>
    </article>
  );
}
