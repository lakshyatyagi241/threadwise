'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  legalPageAdminSchema,
  legalPageListResponseSchema,
  type LegalPageAdmin,
  type LegalSection,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Input, Switch, Textarea } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

const KEY = ['operator', 'cms', 'legal'];

/** The five legal documents: list, show or hide, edit title, labels and numbered sections (WD-CMS-033..035). */
export function LegalPages() {
  const t = useTranslations(`${NS}.legal`);
  const tc = useTranslations(`${NS}.common`);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const list = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/cms/legal', { schema: legalPageListResponseSchema, signal }),
  });
  const toggle = useMutation({
    mutationFn: (p: LegalPageAdmin) =>
      operatorFetch(`/cms/legal/${p.slug}/toggle`, {
        method: 'POST',
        body: { rowVersion: p.rowVersion },
        schema: legalPageAdminSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} description={t('description')} />
      <ActionError error={toggle.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <ul className="space-y-3">
          {list.data.data.map((p) => (
            <li key={p.slug}>
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.title}</p>
                    <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                      /legal/{p.slug}
                    </p>
                  </div>
                  <Badge tone={p.isPublished ? 'success' : 'neutral'}>
                    {p.isPublished ? t('published') : t('hidden')}
                  </Badge>
                  <Switch
                    checked={p.isPublished}
                    label={t('visible')}
                    disabled={toggle.isPending}
                    onCheckedChange={() => toggle.mutate(p)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing(editing === p.slug ? null : p.slug)}
                  >
                    {editing === p.slug ? tc('cancel') : tc('edit')}
                  </Button>
                </div>
                {editing === p.slug && (
                  <LegalEditor
                    key={p.rowVersion}
                    page={p}
                    onSaved={() => {
                      setEditing(null);
                      void qc.invalidateQueries({ queryKey: KEY });
                    }}
                  />
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LegalEditor({ page, onSaved }: { page: LegalPageAdmin; onSaved: () => void }) {
  const t = useTranslations(`${NS}.legal`);
  const tc = useTranslations(`${NS}.common`);
  const [title, setTitle] = useState(page.title);
  const [subtitle, setSubtitle] = useState(page.subtitle ?? '');
  const [updatedLabel, setUpdatedLabel] = useState(page.updatedLabel ?? '');
  const [effectiveLabel, setEffectiveLabel] = useState(page.effectiveLabel ?? '');
  const [sections, setSections] = useState<LegalSection[]>(page.sections);
  const patch = (i: number, p: Partial<LegalSection>) =>
    setSections((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

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
          isPublished: page.isPublished,
          rowVersion: page.rowVersion,
        },
        schema: legalPageAdminSchema,
      }),
    onSuccess: onSaved,
  });

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <ActionError error={save.error} />
      {save.isSuccess && <Alert tone="success">{t('saved')}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('pageTitle')} htmlFor={`${page.slug}-title`}>
          <Input
            id={`${page.slug}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
          />
        </Field>
        <Field label={t('subtitle')} htmlFor={`${page.slug}-sub`}>
          <Input
            id={`${page.slug}-sub`}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </Field>
        <Field label={t('updatedLabel')} htmlFor={`${page.slug}-upd`}>
          <Input
            id={`${page.slug}-upd`}
            value={updatedLabel}
            onChange={(e) => setUpdatedLabel(e.target.value)}
          />
        </Field>
        <Field label={t('effectiveLabel')} htmlFor={`${page.slug}-eff`}>
          <Input
            id={`${page.slug}-eff`}
            value={effectiveLabel}
            onChange={(e) => setEffectiveLabel(e.target.value)}
          />
        </Field>
      </div>
      <h3 className="text-sm font-semibold">{t('sections')}</h3>
      {sections.map((s, i) => (
        <div key={i} className="space-y-2 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-end">
            <Field label={t('sectionNumber')} htmlFor={`${page.slug}-n-${i}`}>
              <Input
                id={`${page.slug}-n-${i}`}
                value={s.n}
                onChange={(e) => patch(i, { n: e.target.value })}
                maxLength={12}
              />
            </Field>
            <Field label={t('sectionTitle')} htmlFor={`${page.slug}-t-${i}`}>
              <Input
                id={`${page.slug}-t-${i}`}
                value={s.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                maxLength={200}
              />
            </Field>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => setSections((x) => x.filter((_, j) => j !== i))}
            >
              {t('removeSection')}
            </Button>
          </div>
          <Field label={t('sectionBody')} htmlFor={`${page.slug}-b-${i}`}>
            <Textarea
              id={`${page.slug}-b-${i}`}
              rows={6}
              className="font-mono"
              dir="ltr"
              value={s.body}
              onChange={(e) => patch(i, { body: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setSections((s) => [...s, { n: String(s.length + 1), title: '', body: '' }])
          }
        >
          {t('addSection')}
        </Button>
        <Button
          type="button"
          disabled={save.isPending || title.trim() === ''}
          onClick={() => save.mutate()}
        >
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}
