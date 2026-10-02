import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BlogForm } from '@/features/marketing-site-cms/admin/blog-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('blog.form.titleEdit') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BlogForm id={id} />;
}
