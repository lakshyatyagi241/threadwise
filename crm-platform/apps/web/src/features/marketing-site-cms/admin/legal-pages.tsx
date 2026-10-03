'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  legalPageAdminSchema,
  legalPageListResponseSchema,
  type LegalPageAdmin,
} from '@crm/contracts';
import { Badge, Button, Card } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

export const LEGAL_KEY = ['operator', 'cms', 'legal'];

/** The five legal documents as WaDesk lists them: title, address, Live / Hidden, section count, Edit / View / Hide (WD-CMS-033, 035). */
export function LegalPages() {
  const t = useTranslations(`${NS}.legal`);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: LEGAL_KEY,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: LEGAL_KEY }),
  });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <ActionError error={toggle.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.data.data.map((p) => (
            <li key={p.slug}>
              <Card className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{p.title}</p>
                    <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                      /legal/{p.slug}
                    </p>
                  </div>
                  <Badge tone={p.isPublished ? 'success' : 'neutral'}>
                    {p.isPublished ? t('live') : t('hidden')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('sectionCount', { count: p.sections.length })}
                  {p.updatedLabel ? ` · ${t('updated')} ${p.updatedLabel}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/legal-pages/${p.slug}`}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm"
                  >
                    {t('edit')}
                  </Link>
                  <a
                    href={`/legal/${p.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center rounded-md px-3 text-sm underline"
                  >
                    {t('view')}
                  </a>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(p)}
                  >
                    {p.isPublished ? t('hide') : t('publish')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
