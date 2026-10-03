'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { legalPageAdminSchema, type LegalPageAdmin, type LegalSection } from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Textarea } from '@crm/ui';
import { LEGAL_KEY } from './legal-pages';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

/** Edit one legal document (WD-CMS-034): header fields, the visibility checkbox and the numbered sections. */
export function LegalEdit({ slug }: { slug: string }) {
  const page = useQuery({
    queryKey: [...LEGAL_KEY, slug],
    queryFn: ({ signal }) =>
      operatorFetch(`/cms/legal/${slug}`, { schema: legalPageAdminSchema, signal }),
  });
  if (page.isPending) return <LoadingBlock />;
  if (page.isError) return <ErrorBlock error={page.error} onRetry={() => void page.refetch()} />;
  return <Editor key={page.data.rowVersion} page={page.data} />;
}

/** A section row can be previewed as the HTML it holds, in a frame that cannot run scripts or reach the app. */
function SectionPreview({ html }: { html: string }) {
  return (
    <iframe
      title="preview"
      sandbox=""
      srcDoc={`<!doctype html><meta charset="utf-8"><body style="font:14px/1.6 system-ui;margin:12px">${html}</body>`}
      className="h-48 w-full rounded-md border border-border bg-white"
    />
  );
}

function Editor({ page }: { page: LegalPageAdmin }) {
  const t = useTranslations(`${NS}.legal`);
  const tc = useTranslations(`${NS}.common`);
  const qc = useQueryClient();
  const [title, setTitle] = useState(page.title);
  const [subtitle, setSubtitle] = useState(page.subtitle ?? '');
  const [updatedLabel, setUpdatedLabel] = useState(page.updatedLabel ?? '');
  const [effectiveLabel, setEffectiveLabel] = useState(page.effectiveLabel ?? '');
  const [isPublished, setIsPublished] = useState(page.isPublished);
  const [sections, setSections] = useState<LegalSection[]>(page.sections);
  const [previewing, setPreviewing] = useState<Set<number>>(new Set());
  const patch = (i: number, p: Partial<LegalSection>) =>
    setSections((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= sections.length) return;
    setSections((s) => {
      const next = [...s];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    setPreviewing(new Set());
  };

  const save = useMutation({
    mutationFn: () =>
      operatorFetch(`/cms/legal/${page.slug}`, {
        method: 'PUT',
        body: {
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          updatedLabel: updatedLabel.trim() || null,
          effectiveLabel: effectiveLabel.trim() || null,
          sections,
          isPublished,
          rowVersion: page.rowVersion,
        },
        schema: legalPageAdminSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: LEGAL_KEY }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        eyebrow={t('eyebrowEdit')}
        title={t(`label_${page.slug}`)}
        description={
          <>
            {t('editIntro')}{' '}
            <a
              href={`/legal/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              dir="ltr"
            >
              /legal/{page.slug}
            </a>
            .
          </>
        }
        actions={
          <>
            <Link href="/admin/legal-pages" className="text-sm underline">
              {tc('cancel')}
            </Link>
            <a
              href={`/legal/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              {t('view')}
            </a>
            <Button type="submit" disabled={save.isPending || title.trim() === ''}>
              {tc('save')}
            </Button>
          </>
        }
      />
      {save.isSuccess && <Alert tone="success">{t('saved')}</Alert>}
      <ActionError error={save.error} />

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">{t('pageHeader')}</h2>
        <Field label={t('pageTitle')} htmlFor="lp-title">
          <Input
            id="lp-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            required
          />
        </Field>
        <Field label={t('subtitle')} htmlFor="lp-sub" hint={t('subtitleHint')}>
          <Textarea
            id="lp-sub"
            rows={2}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('updatedLabel')} htmlFor="lp-upd">
            <Input
              id="lp-upd"
              value={updatedLabel}
              onChange={(e) => setUpdatedLabel(e.target.value)}
              placeholder="March 14, 2026"
            />
          </Field>
          <Field label={t('effectiveLabel')} htmlFor="lp-eff">
            <Input
              id="lp-eff"
              value={effectiveLabel}
              onChange={(e) => setEffectiveLabel(e.target.value)}
              placeholder="April 1, 2026"
            />
          </Field>
        </div>
        <Checkbox
          label={t('publishedCheckbox')}
          checked={isPublished}
          onChange={(e) => setIsPublished(e.target.checked)}
        />
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('sections')}</h2>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setSections((s) => [
              ...s,
              { n: String(s.length + 1).padStart(2, '0'), title: '', body: '' },
            ])
          }
        >
          {t('addSection')}
        </Button>
      </div>
      <ul className="space-y-3">
        {sections.map((s, i) => (
          <li key={i}>
            <Card className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center">
                <Input
                  aria-label={t('sectionNumber')}
                  value={s.n}
                  onChange={(e) => patch(i, { n: e.target.value })}
                  maxLength={12}
                  placeholder="01"
                />
                <Input
                  aria-label={t('sectionTitle')}
                  value={s.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                  maxLength={200}
                  placeholder={t('sectionHeading')}
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={t('moveUp')}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={i === sections.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={t('moveDown')}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setSections((x) => x.filter((_, j) => j !== i));
                      setPreviewing(new Set());
                    }}
                    aria-label={t('removeSection')}
                  >
                    ×
                  </Button>
                </div>
              </div>
              <Textarea
                aria-label={t('sectionBody')}
                rows={6}
                className="font-mono"
                dir="ltr"
                spellCheck
                value={s.body}
                onChange={(e) => patch(i, { body: e.target.value })}
              />
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {t('htmlSupported')}{' '}
                  <code>
                    &lt;p&gt; &lt;ul&gt;&lt;li&gt; &lt;h3&gt; &lt;strong&gt; &lt;a href&gt;
                    &lt;code&gt;
                  </code>
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    setPreviewing((p) => {
                      const n = new Set(p);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                >
                  {t('preview')}
                </button>
              </div>
              {previewing.has(i) && <SectionPreview html={s.body} />}
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('tip')}</p>
    </form>
  );
}
