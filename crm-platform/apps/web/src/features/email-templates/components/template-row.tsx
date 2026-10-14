'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { EmailTemplate } from '@crm/contracts';
import { Badge, Button } from '@crm/ui';
import { sanitizeHtml } from '@/features/channel-email/lib/rich-text';

/** One template of the library: name, badges, subject, how often it was used, and the actions the caller may take. */
export function TemplateRow({
  template,
  busy,
  onEdit,
  onToggleArchive,
  onDelete,
}: {
  template: EmailTemplate;
  busy: boolean;
  onEdit: (t: EmailTemplate) => void;
  onToggleArchive: (t: EmailTemplate) => void;
  onDelete: (t: EmailTemplate) => void;
}) {
  const t = useTranslations('emailTemplates.card');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const archived = template.status === 'archived';
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <li
      data-testid="email-template-row"
      className="rounded-md border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 dir="auto" className="min-w-0 break-words text-base font-semibold">
              {template.name}
            </h2>
            <Badge tone={template.scope === 'shared' ? 'neutral' : 'success'}>
              {t(`badges.${template.scope}`)}
            </Badge>
            {template.purpose === 'marketing' && (
              <Badge tone="warning">{t('badges.marketing')}</Badge>
            )}
            {archived && <Badge tone="danger">{t('badges.archived')}</Badge>}
            {template.category && (
              <span dir="auto" className="rounded-full border border-border px-2 py-0.5 text-xs">
                {template.category}
              </span>
            )}
          </div>
          <p dir="auto" className="mt-1 break-words text-sm text-muted-foreground">
            <span className="me-1">{t('subject')}:</span>
            {template.subject !== '' ? (
              <span className="text-foreground">{template.subject}</span>
            ) : (
              <span>{t('noSubject')}</span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{t('used', { count: template.usedCount })}</span>
            {template.lastUsedAt && (
              <span>{t('lastUsed', { date: date(template.lastUsedAt) })}</span>
            )}
            {template.createdByName && <span>{t('by', { name: template.createdByName })}</span>}
          </p>
          {template.variables.length > 0 && (
            <p dir="ltr" className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
              {t('variables', { list: template.variables.map((v) => `{{${v}}}`).join(' ') })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            data-testid="email-template-toggle-preview"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t('hidePreview') : t('preview')}
          </Button>
          {template.canEdit && (
            <>
              <Button
                variant="secondary"
                size="sm"
                data-testid="email-template-edit"
                disabled={busy}
                onClick={() => onEdit(template)}
              >
                {t('edit')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                data-testid="email-template-archive"
                disabled={busy}
                onClick={() => onToggleArchive(template)}
              >
                {archived ? t('restore') : t('archive')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="border-danger text-danger hover:bg-danger/10"
                data-testid="email-template-delete"
                disabled={busy}
                onClick={() => onDelete(template)}
              >
                {t('delete')}
              </Button>
            </>
          )}
        </div>
      </div>
      {open && (
        <div
          dir="auto"
          data-testid="email-template-body"
          className="mt-3 max-h-64 overflow-y-auto break-words rounded-md border border-border bg-muted/30 p-3 text-sm [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5"
          // Safe: the server sanitised it on write and it goes through the page's allow-list again.
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(template.bodyHtml) }}
        />
      )}
    </li>
  );
}
