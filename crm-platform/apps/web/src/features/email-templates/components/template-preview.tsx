'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { EMAIL_TEMPLATE_SUBJECT_MAX } from '@crm/contracts';
import { Spinner } from '@crm/ui';
import { isBlankHtml, sanitizeHtml } from '@/features/channel-email/lib/rich-text';
import { templatesApi } from '../api/templates';
import { useDebounced } from '../lib/use-debounced';

/**
 * The editor's live preview: the server renders the unsaved subject and message with sample data (it sanitises the HTML exactly as it
 * would on save and says which variables it could not fill), and the page shows the result through the same allow-list again.
 */
export function TemplatePreview({ subject, html }: { subject: string; html: string }) {
  const t = useTranslations('emailTemplates.preview');
  const dSubject = useDebounced(subject.trim(), 500);
  const dHtml = useDebounced(html, 500);
  const blank = isBlankHtml(dHtml);
  const subjectOk = !/[\r\n]/.test(dSubject) && dSubject.length <= EMAIL_TEMPLATE_SUBJECT_MAX;
  const q = useQuery({
    queryKey: ['email-templates', 'preview', dSubject, dHtml],
    enabled: !blank && subjectOk,
    queryFn: ({ signal }) => templatesApi.preview({ subject: dSubject, bodyHtml: dHtml }, signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
  });
  const issues = q.data?.issues ?? [];

  return (
    <section
      data-testid="email-template-preview"
      aria-label={t('title')}
      className="rounded-md border border-border"
    >
      <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>{t('title')}</span>
        {q.isFetching && !q.isPending && <Spinner className="size-3" />}
      </header>
      <div className="space-y-2 p-3 text-sm">
        {blank ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : q.isError ? (
          <p role="alert" className="text-danger">
            {t('failed')}
          </p>
        ) : q.isPending || !q.data ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> {t('loading')}
          </p>
        ) : (
          <>
            <p dir="auto" className="break-words">
              <span className="me-1 text-xs text-muted-foreground">{t('subjectLabel')}:</span>
              <span className="font-medium">{q.data.subject || t('noSubject')}</span>
            </p>
            <div
              dir="auto"
              data-testid="email-template-preview-body"
              className="max-h-64 overflow-y-auto break-words rounded-md border border-border bg-background p-3 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5"
              // Safe: the server sanitised it on the email allow-list and it goes through the page's allow-list again.
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.data.html) }}
            />
            {issues.length > 0 && (
              <p role="status" className="text-xs text-warning">
                {t('issues', { count: issues.length, list: issues.map((i) => i.token).join(', ') })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('sampleNote')}</p>
          </>
        )}
      </div>
    </section>
  );
}
