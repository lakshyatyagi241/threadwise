'use client';

import { useTranslations } from 'next-intl';
import type { BroadcastDetail } from '@crm/contracts';

/** The template as a WhatsApp bubble inside a phone frame (WD-BCAST-031). */
export function TemplatePreview({
  template,
}: {
  template: NonNullable<BroadcastDetail['template']>;
}) {
  const t = useTranslations('broadcasts.detail.overview');
  const category = template.category.charAt(0).toUpperCase() + template.category.slice(1);
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('previewKicker')}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-brand">
          {category}
        </span>
      </div>
      <div className="rounded-[20px] border border-border bg-foreground/90 p-2 shadow-md">
        <div className="overflow-hidden rounded-2xl bg-muted">
          <div className="flex h-9 items-center gap-2 bg-brand px-3 text-brand-foreground">
            <span className="grid size-6 place-items-center rounded-full bg-background text-[10px] font-semibold text-brand">
              WA
            </span>
            <span className="truncate text-[11px] font-semibold">{template.name}</span>
          </div>
          <div className="min-h-[200px] p-3">
            <div className="ms-auto max-w-[255px] rounded-2xl rounded-tr-md border border-border bg-background px-3 py-2 shadow-sm">
              {template.header && <div className="text-xs font-semibold">{template.header}</div>}
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{template.body}</p>
              {template.footer && (
                <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
                  {template.footer}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
