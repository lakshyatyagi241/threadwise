import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicProduct, requestOrigin } from '../api/server';
import { ProductDetail } from '../components/product-detail';
import { ShopFrame } from '../components/shop-frame';
import { productPath } from '../lib/links';
import { jsonLdString, productJsonLd, productMetadata } from '../lib/seo';

/**
 * The product page (WD-STORE-010). An unknown shop or product is a 404.
 * QUIRK (WaDesk): the page's own product enters the browser catalog without its stock quantity, so its stock cap is unknown there
 * (only the related cards carry one); the quantity add and the drawer stepper do not clamp it. The server still decides at checkout.
 */
export async function ShopProduct({ slug, productSlug }: { slug: string; productSlug: string }) {
  const page = await getPublicProduct(slug, productSlug);
  if (!page) notFound();
  const origin = await requestOrigin();
  const url = `${origin}${productPath(slug, page.product.slug)}`;
  return (
    <ShopFrame
      shop={page.shop}
      page="product"
      products={[{ ...page.product, stockQty: null }, ...page.related]}
    >
      {/* React hoists these into <head>. `og:type` is `product` here, which the typed metadata API does not offer. */}
      <meta property="og:type" content="product" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(productJsonLd(page, url)) }}
      />
      <ProductDetail page={page} />
    </ShopFrame>
  );
}

export async function shopProductMetadata(slug: string, productSlug: string): Promise<Metadata> {
  const page = await getPublicProduct(slug, productSlug);
  if (!page) return { title: { absolute: 'Store' }, robots: { index: false } };
  const origin = await requestOrigin();
  return productMetadata(
    page.shop,
    page.product,
    `${origin}${productPath(slug, page.product.slug)}`,
  );
}
