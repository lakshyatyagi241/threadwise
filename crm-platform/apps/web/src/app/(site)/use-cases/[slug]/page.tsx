import type { Metadata } from 'next';
import { clip, pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { notFound } from 'next/navigation';
import { ALL_SOLUTIONS, solutionBySlug } from '@/features/marketing-site-cms/geta/data/solutions';
import { SolutionPage } from '@/features/marketing-site-cms/geta/pages/solution';

type Props = { params: Promise<{ slug: string }> };

export const generateStaticParams = () =>
  ALL_SOLUTIONS.filter((s) => s.kind === 'usecase').map((s) => ({ slug: s.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = solutionBySlug('usecase', (await params).slug);
  return s
    ? pageMeta({
        path: `/use-cases/${s.slug}`,
        title: `${s.name}: ${clip(s.short.replace(/\.$/, ''), 40)}`,
        description: s.sub,
      })
    : {};
}

export default async function Page({ params }: Props) {
  const s = solutionBySlug('usecase', (await params).slug);
  if (!s) notFound();
  return <SolutionPage solution={s} />;
}
