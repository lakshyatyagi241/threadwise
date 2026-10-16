'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { ComposeTemplate } from '@crm/contracts';
import { previewOf } from '../lib/compose-model';

/** The phone-frame preview of the picked template with sample values, and the selected / schedule tiles under it. */
export function ComposePreview({
  template,
  selected,
  later,
}: {
  template: ComposeTemplate | undefined;
  selected: number;
  later: boolean;
}) {
  const t = useTranslations('broadcasts.compose');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const p = template ? previewOf(template) : null;
  const time = new Date().toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return (
    <div className="sticky top-[92px] rounded-2xl border border-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('preview')}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-brand">
          {p?.category ?? '—'}
        </span>
      </div>
      <div className="rounded-3xl border border-border bg-foreground/90 p-2 shadow-md">
        <div className="overflow-hidden rounded-[19px] bg-muted">
          <div className="flex h-11 items-center gap-2 bg-brand px-3 text-brand-foreground">
            <span className="grid size-7 place-items-center rounded-full bg-background text-[11px] font-semibold text-brand">
              WA
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">{t('previewTitle')}</div>
              <div className="truncate text-[9.5px] opacity-80">{t('previewSub')}</div>
            </div>
          </div>
          <div className="min-h-[270px] p-3">
            <div className="ms-auto max-w-[255px] rounded-2xl rounded-se-md border border-border bg-background px-3 py-2 shadow-sm">
              {p?.media && (
                <div className="mb-2 overflow-hidden rounded-[7px]">
                  {p.media === 'image' && template?.attachmentUrl ? (
                    <img
                      src={template.attachmentUrl}
                      alt=""
                      className="block max-h-[150px] w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-20 items-center justify-center gap-1.5 bg-muted font-mono text-[10.5px] text-brand">
                      {t('media', { kind: p.media.charAt(0).toUpperCase() + p.media.slice(1) })}
                    </div>
                  )}
                </div>
              )}
              {p?.header && <div className="text-xs font-semibold">{p.header}</div>}
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                {p ? p.body : t('pickToPreview')}
              </p>
              {p?.footer && (
                <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
                  {p.footer}
                </div>
              )}
              <div className="mt-1 text-end text-[10px] text-muted-foreground">{time}</div>
            </div>
            {p && p.buttons.length > 0 && (
              <div className="ms-auto mt-[3px] flex max-w-[255px] flex-col gap-[3px]">
                {p.buttons.map((b, i) => (
                  <div
                    key={i}
                    className="rounded-[7px] bg-background px-3 py-2 text-center text-xs font-semibold text-brand shadow-sm"
                  >
                    {b.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-muted/50 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('previewSelected')}
          </div>
          <div className="mt-1 text-[22px] leading-tight">{selected.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border bg-muted/50 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('previewSchedule')}
          </div>
          <div className="mt-1 text-[22px] leading-tight">{later ? t('later') : t('now')}</div>
        </div>
      </div>
    </div>
  );
}
