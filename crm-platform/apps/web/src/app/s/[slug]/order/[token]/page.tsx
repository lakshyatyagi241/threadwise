import { ShopOrder, shopOrderMetadata } from '@/features/storefront-builder/public';

type Props = { params: Promise<{ slug: string; token: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug, token } = await params;
  return shopOrderMetadata(slug, token);
}

export default async function ShopOrderPage({ params }: Props) {
  const { slug, token } = await params;
  return <ShopOrder slug={slug} token={token} />;
}
