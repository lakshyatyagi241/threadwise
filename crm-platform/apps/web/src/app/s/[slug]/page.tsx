import { ShopHome, pageParam, shopHomeMetadata } from '@/features/storefront-builder/public';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

export async function generateMetadata({ params, searchParams }: Props) {
  const { slug } = await params;
  return shopHomeMetadata(slug, pageParam((await searchParams).page));
}

export default async function ShopHomePage({ params, searchParams }: Props) {
  const { slug } = await params;
  return <ShopHome slug={slug} page={pageParam((await searchParams).page)} />;
}
