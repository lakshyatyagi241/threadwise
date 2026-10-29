import type { Metadata } from 'next';
import { clip, pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { notFound } from 'next/navigation';
import { PRODUCTS, productBySlug } from '@/features/marketing-site-cms/geta/data/products';
import { ProductPage } from '@/features/marketing-site-cms/geta/pages/product';

type Props = { params: Promise<{ slug: string }> };

export const generateStaticParams = () => PRODUCTS.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = productBySlug((await params).slug);
  return p
    ? pageMeta({
        path: `/products/${p.slug}`,
        title: `${p.name}: ${clip(p.short.replace(/\.$/, ''), 40)}`,
        description: p.sub,
      })
    : {};
}

export default async function Page({ params }: Props) {
  const p = productBySlug((await params).slug);
  if (!p) notFound();
  return <ProductPage product={p} />;
}
