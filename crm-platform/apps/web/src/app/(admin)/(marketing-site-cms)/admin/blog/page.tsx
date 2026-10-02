import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BlogList } from '@/features/marketing-site-cms/admin/blog-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('blog.title') };
}

export default function Page() {
  return <BlogList />;
}
