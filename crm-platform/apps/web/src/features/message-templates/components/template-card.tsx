'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TemplateSummary } from '@crm/contracts';
import { Button, Card } from '@crm/ui';
import { canEdit } from '../lib/status-model';
import { previewOfSummary } from '../lib/preview';
import { CategoryBadge, QualityBadge, StatusBadge } from './badges';
import { MessageBubble } from './message-bubble';

/** One template in the library: identity, status, a bubble preview, and the actions the status allows. */
export function TemplateCard({
  template: tpl,
  connectionLabel,
  mayEdit,
  mayDelete,
  onDelete,
}: {
  template: TemplateSummary;
  /** The number it is submitted through, resolved by the screen; null when it is not known. */
  connectionLabel: string | null;
  /** `tpl.templates.create`: creating and editing share one permission. */
  mayEdit: boolean;
  /** `tpl.templates.delete`. */
  mayDelete: boolean;
  onDelete: (t: TemplateSummary) => void;
}) {
  const t = useTranslations('message-templates.card');
  return (
    <Card className="flex flex-col gap-3" data-testid="template-card">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold">
          <Link href={`/templates/${tpl.id}`} className="hover:underline focus-visible:underline">
            {tpl.name}
          </Link>
        </h2>
        <CategoryBadge category={tpl.metaCategory} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <StatusBadge status={tpl.status} />
        {tpl.status === 'approved' && <QualityBadge score={tpl.qualityScore} />}
        <span className="font-mono">{tpl.language}</span>
        {connectionLabel && (
          <>
            <span aria-hidden="true">·</span>
            <span className="max-w-40 truncate" title={connectionLabel}>
              {connectionLabel}
            </span>
          </>
        )}
      </div>
      <div className="flex-1 rounded-xl border border-border bg-muted p-3">
        <MessageBubble model={previewOfSummary(tpl)} maxButtons={3} />
      </div>
      {tpl.status === 'rejected' && tpl.rejectionReason && (
        <p className="rounded-md bg-danger/10 px-2 py-1 text-xs text-danger break-words">
          {t('rejected', { reason: tpl.rejectionReason })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/templates/${tpl.id}`}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          {t('view')}
        </Link>
        {mayEdit && canEdit(tpl.status) && (
          <Link
            href={`/templates/${tpl.id}/edit`}
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            {t('edit')}
          </Link>
        )}
        {mayDelete && (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onDelete(tpl)}>
            {t('delete')}
          </Button>
        )}
      </div>
    </Card>
  );
}
