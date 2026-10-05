'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  guidebookAdminListResponseSchema,
  guidebookArticleAdminSchema,
  guidebookPreviewResponseSchema,
  type GuidebookArticleAdmin,
} from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Switch, Textarea } from '@crm/ui';
import { GUIDEBOOK_KEY } from './guidebook-admin';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

/** Create and edit a help article (TW-CMS-045). `id` absent means a new article. */
export function GuidebookForm({ id }: { id?: string }) {
  const row = useQuery({
    queryKey: [...GUIDEBOOK_KEY, id],
    enabled: !!id,
    queryFn: ({ signal }) =>
      operatorFetch(`/cms/guidebook/${id}`, { schema: guidebookArticleAdminSchema, signal }),
  });
  if (id && row.isPending) return <LoadingBlock />;
  if (id && row.isError) return <ErrorBlock error={row.error} onRetry={() => void row.refetch()} />;
  return <Editor key={row.data?.rowVersion ?? 'new'} row={row.data} />;
}

function Editor({ row }: { row: GuidebookArticleAdmin | undefined }) {
  const t = useTranslations(`${NS}.guidebookAdmin.form`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const known = useQuery({
    queryKey: [...GUIDEBOOK_KEY, 'categories'],
    queryFn: ({ signal }) =>
      operatorFetch('/cms/guidebook', {
        query: { limit: 1 },
        schema: guidebookAdminListResponseSchema,
        signal,
      }),
  });
  const [f, setF] = useState({
    title: row?.title ?? '',
    excerpt: row?.excerpt ?? '',
    body: row?.body ?? '',
    slug: row?.slug ?? '',
    category: row?.category ?? 'general',
    sortOrder: String(row?.sortOrder ?? 0),
    // Reference's new-article form starts with Published on.
    isPublished: row?.isPublished ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const blank = (v: string) => (v.trim() === '' ? null : v.trim());
      const body = {
        title: f.title.trim(),
        excerpt: blank(f.excerpt),
        body: f.body === '' ? null : f.body,
        slug: blank(f.slug),
        category: f.category.trim() || 'general',
        sortOrder: Math.max(0, Math.trunc(Number(f.sortOrder) || 0)),
        isPublished: f.isPublished,
      };
      return row
        ? operatorFetch(`/cms/guidebook/${row.id}`, {
            method: 'PUT',
            body: { ...body, rowVersion: row.rowVersion },
            schema: guidebookArticleAdminSchema,
          })
        : operatorFetch('/cms/guidebook', {
            method: 'POST',
            body,
            schema: guidebookArticleAdminSchema,
          });
    },
    onSuccess: (r) => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: GUIDEBOOK_KEY });
      if (!row) router.replace(`/admin/guidebook/${r.id}`);
    },
  });
  const render = useMutation({
    mutationFn: () =>
      operatorFetch('/cms/guidebook/preview', {
        method: 'POST',
        body: { body: f.body },
        schema: guidebookPreviewResponseSchema,
      }),
    onSuccess: (r) => setPreview(r.html),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  };
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const nf = new Intl.NumberFormat(locale);

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={row ? t('titleEdit') : t('titleNew')}
        actions={
          <>
            <Link href="/admin/guidebook" className="text-sm underline">
              {tc('cancel')}
            </Link>
            <Button type="submit" disabled={save.isPending || f.title.trim() === ''}>
              {row ? t('saveChanges') : t('create')}
            </Button>
          </>
        }
      />
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      <ActionError error={save.error} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold">{t('content')}</h2>
          <Field label={t('title')} htmlFor="g-title">
            <Input
              id="g-title"
              required
              maxLength={200}
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label={t('excerpt')} htmlFor="g-excerpt">
            <Input
              id="g-excerpt"
              maxLength={500}
              value={f.excerpt}
              onChange={(e) => set('excerpt', e.target.value)}
              placeholder={t('excerptPlaceholder')}
            />
          </Field>
          <Field label={t('body')} htmlFor="g-body" hint={t('bodyHint')}>
            <Textarea
              id="g-body"
              rows={18}
              dir="ltr"
              className="font-mono"
              value={f.body}
              onChange={(e) => {
                set('body', e.target.value);
                setPreview(null);
              }}
              placeholder={t('bodyPlaceholder')}
            />
          </Field>
          <div className="space-y-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={render.isPending}
              onClick={() => render.mutate()}
            >
              {t('preview')}
            </Button>
            {preview !== null && (
              <div
                className="space-y-3 rounded-md border border-border p-4 leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:ps-6 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:ps-6"
                aria-label={t('preview')}
                // The API renders and sanitises it with the same renderer readers get.
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            )}
          </div>
        </Card>
        <Card className="h-fit space-y-4">
          <h2 className="text-sm font-semibold">{t('publishing')}</h2>
          <Field label={t('slug')} htmlFor="g-slug">
            <Input
              id="g-slug"
              dir="ltr"
              pattern="[a-z0-9\-]*"
              maxLength={160}
              value={f.slug}
              onChange={(e) => set('slug', e.target.value)}
              placeholder={t('slugPlaceholder')}
            />
          </Field>
          <Field label={t('category')} htmlFor="g-cat">
            <Input
              id="g-cat"
              required
              maxLength={80}
              list="g-cat-suggest"
              value={f.category}
              onChange={(e) => set('category', e.target.value)}
            />
            <datalist id="g-cat-suggest">
              {known.data?.categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label={t('sortOrder')} htmlFor="g-sort">
            <Input
              id="g-sort"
              type="number"
              min={0}
              value={f.sortOrder}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{t('published')}</span>
            <Switch
              checked={f.isPublished}
              label={t('published')}
              onCheckedChange={(v) => set('isPublished', v)}
            />
          </div>
          {row && (
            <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>{t('viewsLine', { count: nf.format(row.views) })}</p>
              <p>{t('votesLine', { helpful: row.helpful, notHelpful: row.notHelpful })}</p>
              {row.publishedAt && (
                <p>{t('firstPublished', { date: day.format(new Date(row.publishedAt)) })}</p>
              )}
            </div>
          )}
        </Card>
      </div>
    </form>
  );
}
