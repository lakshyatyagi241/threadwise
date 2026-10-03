'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  legalPageAdminSchema,
  legalPageListResponseSchema,
  type LegalPageAdmin,
} from '@crm/contracts';
import { Badge, Card } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

export const LEGAL_KEY = ['operator', 'cms', 'legal'];

/** The five legal documents as Reference lists them: title, address, Live / Hidden, section count, Edit / View / Hide (TW-CMS-033, 035). */
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
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.data.map((p) => (
            <li key={p.slug} className="flex">
              <Card className="flex w-full flex-col rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[20px] font-semibold leading-tight">{p.title}</p>
                    <p className="mt-1 font-mono text-[10.5px] text-muted-foreground" dir="ltr">
                      /legal/{p.slug}
                    </p>
                  </div>
                  <Badge tone={p.isPublished ? 'success' : 'neutral'}>
                    {p.isPublished ? t('live') : t('hidden')}
                  </Badge>
                </div>
                <p className="mt-3 text-[12px] text-muted-foreground">
                  {t('sectionCount', { count: p.sections.length })}
                  {p.updatedLabel ? ` · ${t('updated')} ${p.updatedLabel}` : ''}
                </p>
                <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
                  <Link
                    href={`/admin/legal-pages/${p.slug}`}
                    className="flex items-center gap-2 rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="size-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      aria-hidden
                    >
                      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11z" />
                      <path d="M9.5 4l2.5 2.5" />
                    </svg>
                    {t('edit')}
                  </Link>
                  <a
                    href={`/legal/${p.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-border bg-background px-3.5 py-1.5 text-[12px] font-medium hover:bg-muted"
                  >
                    {t('view')}
                  </a>
                  <button
                    type="button"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(p)}
                    className="ms-auto rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-muted disabled:opacity-60"
                  >
                    {p.isPublished ? t('hide') : t('publish')}
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
