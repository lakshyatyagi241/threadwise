'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blogCategoryListResponseSchema,
  blogPostAdminSchema,
  type BlogPostAdmin,
} from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea } from '@crm/ui';
import {
  ActionError,
  ErrorBlock,
  LoadingBlock,
  NS,
  PageHeader,
  fromLocalInput,
  operatorFetch,
  toLocalInput,
} from './shared';

/** Create and edit a post (TW-CMS-030). `id` absent means a new post. */
export function BlogForm({ id }: { id?: string }) {
  const post = useQuery({
    queryKey: ['operator', 'cms', 'blog', id],
    enabled: !!id,
    queryFn: ({ signal }) =>
      operatorFetch(`/cms/blog/${id}`, { schema: blogPostAdminSchema, signal }),
  });
  if (id && post.isPending) return <LoadingBlock />;
  if (id && post.isError)
    return <ErrorBlock error={post.error} onRetry={() => void post.refetch()} />;
  return <Editor key={post.data?.rowVersion ?? 'new'} post={post.data} />;
}

function Editor({ post }: { post: BlogPostAdmin | undefined }) {
  const t = useTranslations(`${NS}.blog.form`);
  const tc = useTranslations(`${NS}.common`);
  const router = useRouter();
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: ['operator', 'cms', 'blog-categories'],
    queryFn: ({ signal }) =>
      operatorFetch('/cms/blog/categories', { schema: blogCategoryListResponseSchema, signal }),
  });

  const [f, setF] = useState({
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    body: post?.body ?? '',
    featuredImage: post?.featuredImage ?? '',
    categoryId: post?.category?.id ?? '',
    newCategory: '',
    tags: post?.tags.join(', ') ?? '',
    authorName: post?.authorName ?? '',
    status: post?.status ?? 'draft',
    publishedAt: toLocalInput(post?.publishedAt ?? null),
    isFeatured: post?.isFeatured ?? false,
    metaTitle: post?.metaTitle ?? '',
    metaDescription: post?.metaDescription ?? '',
    canonicalUrl: post?.canonicalUrl ?? '',
    noindex: post?.noindex ?? false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const blank = (v: string) => (v.trim() === '' ? null : v.trim());
      const body = {
        title: f.title.trim(),
        slug: blank(f.slug),
        excerpt: blank(f.excerpt),
        body: f.body === '' ? null : f.body,
        featuredImage: blank(f.featuredImage),
        categoryId: f.categoryId === '' ? null : f.categoryId,
        newCategory: blank(f.newCategory),
        tags: f.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        authorName: blank(f.authorName),
        status: f.status,
        publishedAt: fromLocalInput(f.publishedAt),
        isFeatured: f.isFeatured,
        metaTitle: blank(f.metaTitle),
        metaDescription: blank(f.metaDescription),
        canonicalUrl: blank(f.canonicalUrl),
        noindex: f.noindex,
      };
      return post
        ? operatorFetch(`/cms/blog/${post.id}`, {
            method: 'PUT',
            body: { ...body, rowVersion: post.rowVersion },
            schema: blogPostAdminSchema,
          })
        : operatorFetch('/cms/blog', { method: 'POST', body, schema: blogPostAdminSchema });
    },
    onSuccess: (saved) => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['operator', 'cms'] });
      if (!post) router.replace(`/admin/blog/${saved.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        eyebrow={post ? t('eyebrowEdit') : t('eyebrowNew')}
        title={post ? t('titleEdit') : t('titleNew')}
        description={t('intro')}
        actions={
          <>
            <Link href="/admin/blog" className="text-sm underline">
              {tc('cancel')}
            </Link>
            <Button type="submit" disabled={save.isPending || f.title.trim() === ''}>
              {post ? t('saveChanges') : t('create')}
            </Button>
          </>
        }
      />
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      <ActionError error={save.error} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('article')}</h2>
            <Field label={t('title')} htmlFor="b-title">
              <Input
                id="b-title"
                value={f.title}
                onChange={(e) => set('title', e.target.value)}
                required
                maxLength={200}
              />
            </Field>
            <Field label={t('slug')} htmlFor="b-slug" hint={t('slugHint')}>
              <Input
                id="b-slug"
                value={f.slug}
                onChange={(e) => set('slug', e.target.value)}
                dir="ltr"
                maxLength={200}
                placeholder={t('slugPlaceholder')}
              />
            </Field>
            <Field label={t('excerpt')} htmlFor="b-excerpt">
              <Textarea
                id="b-excerpt"
                rows={2}
                value={f.excerpt}
                onChange={(e) => set('excerpt', e.target.value)}
                maxLength={500}
                placeholder={t('excerptPlaceholder')}
              />
            </Field>
            <Field label={t('body')} htmlFor="b-body" hint={t('bodyHint')}>
              <Textarea
                id="b-body"
                rows={18}
                className="font-mono"
                dir="ltr"
                value={f.body}
                onChange={(e) => set('body', e.target.value)}
                placeholder={t('bodyPlaceholder')}
              />
            </Field>
          </Card>
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('media')}</h2>
            <Field label={t('image')} htmlFor="b-image" hint={t('imageHint')}>
              <Input
                id="b-image"
                value={f.featuredImage}
                onChange={(e) => set('featuredImage', e.target.value)}
                dir="ltr"
                placeholder="https://"
              />
            </Field>
            <Field label={t('tags')} htmlFor="b-tags">
              <Input
                id="b-tags"
                value={f.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder={t('tagsPlaceholder')}
              />
            </Field>
            <Field label={t('author')} htmlFor="b-author">
              <Input
                id="b-author"
                value={f.authorName}
                onChange={(e) => set('authorName', e.target.value)}
                maxLength={120}
              />
            </Field>
          </Card>
        </div>
        <aside className="space-y-5">
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('visibility')}</h2>
            <Field label={t('status')} htmlFor="b-status">
              <Select
                id="b-status"
                value={f.status}
                onChange={(e) => set('status', e.target.value as 'draft' | 'published')}
              >
                <option value="draft">{t('statusDraft')}</option>
                <option value="published">{t('statusPublished')}</option>
              </Select>
            </Field>
            <Field label={t('publishedAt')} htmlFor="b-date" hint={t('publishedAtHint')}>
              <Input
                id="b-date"
                type="datetime-local"
                value={f.publishedAt}
                onChange={(e) => set('publishedAt', e.target.value)}
              />
            </Field>
            <Checkbox
              label={t('featured')}
              checked={f.isFeatured}
              onChange={(e) => set('isFeatured', e.target.checked)}
            />
            <p className="-mt-2 text-xs text-muted-foreground">{t('featuredHint')}</p>
            <Button
              type="submit"
              className="w-full"
              disabled={save.isPending || f.title.trim() === ''}
            >
              {post ? t('saveChanges') : t('create')}
            </Button>
          </Card>
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('filing')}</h2>
            <Field label={t('category')} htmlFor="b-cat">
              <Select
                id="b-cat"
                value={f.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              >
                <option value="">{t('noCategory')}</option>
                {categories.data?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('newCategory')} htmlFor="b-newcat" hint={t('newCategoryHint')}>
              <Input
                id="b-newcat"
                value={f.newCategory}
                onChange={(e) => set('newCategory', e.target.value)}
                maxLength={120}
                placeholder={t('newCategoryPlaceholder')}
              />
            </Field>
          </Card>
        </aside>
      </div>
    </form>
  );
}
