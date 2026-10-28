import type { Metadata } from 'next';
import { clip, pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { notFound } from 'next/navigation';
import { CHANNELS } from '@/features/marketing-site-cms/geta/data/channels';
import { productBySlug } from '@/features/marketing-site-cms/geta/data/products';
import { ProductPage } from '@/features/marketing-site-cms/geta/pages/product';

type Props = { params: Promise<{ slug: string }> };

const channel = (slug: string) => {
  const p = productBySlug(slug);
  return p?.group === 'channels' ? p : undefined;
};

export const generateStaticParams = () => CHANNELS.map((c) => ({ slug: c.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = channel((await params).slug);
  return c
    ? pageMeta({
        path: `/products/channels/${c.slug}`,
        title: `${c.name} channel: ${clip(c.short.replace(/\.$/, ''), 36)}`,
        description: c.sub,
      })
    : {};
}

export default async function Page({ params }: Props) {
  const c = channel((await params).slug);
  if (!c) notFound();
  return <ProductPage product={c} />;
}
