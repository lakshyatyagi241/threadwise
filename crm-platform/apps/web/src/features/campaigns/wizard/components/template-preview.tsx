'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { WizardTemplate } from '@crm/contracts';
import { MessageBubble } from '@/features/message-templates/components/message-bubble';
import { previewModelOf } from '../lib/templates';

/** The WhatsApp chat wallpaper: a plain beige with a faint dot pattern, as the app draws it. */
const WALLPAPER = {
  backgroundColor: '#ece5dd',
  backgroundImage: 'radial-gradient(rgba(0,0,0,0.045) 1px, transparent 1px)',
  backgroundSize: '14px 14px',
} as const;

/**
 * The selected template as it will arrive on the customer's phone: a phone frame with the WhatsApp chat header (the sending business),
 * the chat wallpaper, the message bubble (header, body, footer, buttons) and the reply bar. Before a template is chosen the chat is
 * empty and says what to do.
 */
export function TemplatePreview({
  template,
  senderName,
}: {
  template: WizardTemplate | null;
  /** The name of the number the broadcast is sent from, shown as the chat title. */
  senderName?: string | null;
}) {
  const t = useTranslations('campaigns.wizard.template');
  const model = useMemo(() => (template ? previewModelOf(template) : null), [template]);
  const title = senderName?.trim() || t('previewBusiness');
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-gradient-to-b from-muted/30 to-muted p-4 lg:sticky lg:top-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        {t('livePreview')}
      </h2>
      <section
        aria-label={t('previewTitle')}
        data-testid="phone-preview"
        className="mx-auto flex h-[clamp(340px,calc(100vh-390px),600px)] w-full max-w-[340px] flex-col overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 bg-[#ece5dd] shadow-xl"
      >
        <header className="flex items-center gap-3 bg-[#075e54] px-3 py-2.5 text-white">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-semibold uppercase"
          >
            {title.charAt(0)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{title}</span>
            <span className="block text-xs text-white/75">{t('previewOnline')}</span>
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" style={WALLPAPER}>
          <span className="mx-auto rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-neutral-600 shadow-sm">
            {t('previewToday')}
          </span>
          {model ? (
            <MessageBubble model={model} />
          ) : (
            <p
              data-testid="phone-preview-empty"
              className="m-auto max-w-[220px] rounded-lg bg-white/80 px-3 py-2 text-center text-sm text-neutral-600"
            >
              {t('previewEmpty')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 bg-[#f0f0f0] px-2 py-2">
          <span className="flex-1 rounded-full bg-white px-3 py-2 text-sm text-neutral-400">
            {t('previewInput')}
          </span>
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[#075e54] text-white"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
          </span>
        </div>
      </section>
      {template && template.slots.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {t('previewVariables', { count: template.slots.length })}
        </p>
      )}
    </div>
  );
}
