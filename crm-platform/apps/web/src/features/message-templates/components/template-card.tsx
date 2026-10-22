'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TemplateSummary } from '@crm/contracts';
import { cn } from '@crm/ui';
import { canSendViaApi } from '../lib/curl';
import { canDuplicate, canEdit, statusGroupOf } from '../lib/status-model';
import { previewOfSummary } from '../lib/preview';
import { CategoryPill } from './badges';
import { ChatIcon, CodeIcon, CopyIcon, EyeIcon, PhoneIcon, TrashIcon } from './icons';
import { MessageBubble } from './wa-bubble';

const DOT = {
  approved: 'bg-success',
  pending: 'bg-warning',
  rejected: 'bg-danger',
} as const;

/**
 * One template in the library, laid out like Reference's card: name and category pill, a line of chips (engine, status, type,
 * category, number), the WhatsApp mock-up, the rejection reason, and Edit template / view / delete.
 */
export function TemplateCard({
  template: tpl,
  connectionLabel,
  mayEdit,
  mayDelete,
  mayCurl = false,
  onDelete,
}: {
  template: TemplateSummary;
  /** The number it is submitted through, resolved by the screen; null when it is not known. */
  connectionLabel: string | null;
  /** `tpl.templates.create`: creating and editing share one permission. */
  mayEdit: boolean;
  /** `tpl.templates.delete`. */
  mayDelete: boolean;
  /** `tpl.templates.api_curl` and `api.keys.read`: the cURL shortcut to the send example. */
  mayCurl?: boolean;
  onDelete: (t: TemplateSummary) => void;
}) {
  const t = useTranslations('message-templates.card');
  const ts = useTranslations('message-templates.status');
  const tq = useTranslations('message-templates.quality');
  // the status line shows the quality (the corner pill already shows the category)
  const quality = (tpl.qualityScore ?? 'UNKNOWN').toUpperCase();
  const group = statusGroupOf(tpl.status);
  return (
    <article
      className="flex w-full flex-col rounded-[14px] border border-border bg-background p-4 transition hover:-translate-y-px hover:border-brand hover:shadow-md"
      data-testid="template-card"
      data-status={tpl.status}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-[13px] font-semibold">
          <Link href={`/templates/${tpl.id}`} className="hover:underline focus-visible:underline">
            {tpl.name}
          </Link>
        </h2>
        <CategoryPill category={tpl.metaCategory} />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-1.5 py-0.5 font-semibold text-brand">
          <ChatIcon className="size-3" />
          {t('engine')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn('size-1.5 rounded-full', group ? DOT[group] : 'bg-border')}
            aria-hidden="true"
          />
          {ts(tpl.status)}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {t.has(`type.${tpl.templateType}`) ? t(`type.${tpl.templateType}`) : tpl.templateType}
        </span>
        <span aria-hidden="true">·</span>
        <span data-testid="quality-label">{tq.has(quality) ? tq(quality) : tq('UNKNOWN')}</span>
        {connectionLabel && (
          <>
            <span aria-hidden="true">·</span>
            <span
              className="inline-flex max-w-[150px] items-center gap-1 truncate font-semibold text-brand"
              title={connectionLabel}
            >
              <PhoneIcon className="size-3 shrink-0" />
              {connectionLabel}
            </span>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-hidden rounded-xl border border-border bg-muted p-3">
        <MessageBubble model={previewOfSummary(tpl)} maxButtons={3} />
      </div>

      {tpl.status === 'rejected' && tpl.rejectionReason && (
        <div className="mt-2 break-words rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          <b>{t('rejectedLabel')}</b> {tpl.rejectionReason}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {mayEdit && canEdit(tpl.status, tpl.templateType) ? (
          <Link
            href={`/templates/${tpl.id}/edit`}
            className="flex-1 rounded-full border border-dashed border-brand py-[7px] text-center text-[11px] font-medium text-brand transition hover:border-solid hover:bg-brand hover:text-brand-foreground"
          >
            {t('edit')}
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        <Link
          href={`/templates/${tpl.id}`}
          title={t('viewTitle')}
          aria-label={t('viewTitle')}
          className="grid size-8 place-items-center rounded-full border border-border bg-background transition hover:border-brand hover:bg-brand/10 hover:text-brand"
        >
          <EyeIcon className="size-3.5" />
        </Link>
        {mayEdit && canDuplicate(tpl.status, tpl.templateType) && (
          <Link
            href={`/templates/new?from=${tpl.id}`}
            title={t('duplicate')}
            aria-label={t('duplicateNamed', { name: tpl.name })}
            className="grid size-8 place-items-center rounded-full border border-border bg-background transition hover:border-brand hover:bg-brand/10 hover:text-brand"
          >
            <CopyIcon className="size-3.5" />
          </Link>
        )}
        {mayCurl && canSendViaApi(tpl) && (
          <Link
            href={`/templates/${tpl.id}#curl`}
            title={t('curl')}
            aria-label={t('curlNamed', { name: tpl.name })}
            className="grid size-8 place-items-center rounded-full border border-border bg-background transition hover:border-brand hover:bg-brand/10 hover:text-brand"
          >
            <CodeIcon className="size-3.5" />
          </Link>
        )}
        {mayDelete && (
          <button
            type="button"
            title={t('delete')}
            aria-label={t('deleteNamed', { name: tpl.name })}
            onClick={() => onDelete(tpl)}
            className="grid size-8 place-items-center rounded-full border border-border bg-background transition hover:border-danger hover:bg-danger/10 hover:text-danger"
          >
            <TrashIcon className="size-3.5" />
          </button>
        )}
      </div>
    </article>
  );
}
