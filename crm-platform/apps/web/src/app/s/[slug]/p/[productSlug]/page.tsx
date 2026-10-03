import { ShopProduct, shopProductMetadata } from '@/features/storefront-builder/public';

type Props = { params: Promise<{ slug: string; productSlug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug, productSlug } = await params;
  return shopProductMetadata(slug, productSlug);
}

export default async function ShopProductPage({ params }: Props) {
  const { slug, productSlug } = await params;
  return <ShopProduct slug={slug} productSlug={productSlug} />;
}
