'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { ButtonIcon, MessageBubble } from '@/features/message-templates/components/message-bubble';
import type { PreviewModel } from '@/features/message-templates/lib/form-model';
import { BubbleIcon } from './parts';

/**
 * The one message preview of Campaigns, Create (the guided flow and the classic builder alike): a green header with the sender's
 * initial, the message bubble on the chat wallpaper, and each button of the message as its own full-width card under the bubble. With an
 * A/B test, a small A / B switch picks the variant shown.
 */
export function BroadcastPreview({
  title,
  subtitle,
  initial,
  a,
  b,
  placeholder,
}: {
  title: string;
  subtitle: string;
  /** The sending number's initial (WA when none is picked). */
  initial: string;
  /** Variant A, or the only message. `null` = nothing to show yet. */
  a: PreviewModel | null;
  /** Variant B of an A/B test; leave out without A/B. */
  b?: PreviewModel | null;
  /** What to say in place of a bubble (a flow, or an empty preview). */
  placeholder: { title: string; hint: string } | null;
}) {
  const t = useTranslations('campaigns.builder.preview');
  const [variant, setVariant] = useState<'A' | 'B'>('A');
  const ab = b !== undefined;
  const model = ab && variant === 'B' ? (b ?? null) : a;
  const buttons = model?.buttons ?? [];
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
      data-testid="broadcast-preview"
    >
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20 text-[13px] font-semibold uppercase"
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="block truncate text-xs text-white/75">{subtitle}</span>
        </span>
      </div>
      <div className="space-y-2 bg-[#ece5dd] p-3">
        {ab && (
          <div role="tablist" aria-label={t('variants')} className="flex gap-1">
            {(['A', 'B'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={variant === v}
                onClick={() => setVariant(v)}
                className={cn(
                  'rounded-full px-3 py-0.5 text-[11px] font-semibold',
                  variant === v ? 'bg-[#075e54] text-white' : 'bg-white/70 text-neutral-700',
                )}
              >
                {t('variant', { v })}
              </button>
            ))}
          </div>
        )}
        {model ? (
          <>
            <MessageBubble model={{ ...model, buttons: [] }} className="max-w-full" />
            {buttons.length > 0 && (
              <ul className="space-y-1.5" data-testid="preview-buttons">
                {buttons.map((btn, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-background px-3 py-2 text-sm font-semibold text-brand shadow-sm"
                  >
                    <ButtonIcon kind={btn.kind} />
                    <span className="truncate">{btn.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="rounded-xl bg-white/70 px-4 py-8 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand/10 text-brand">
              <BubbleIcon className="size-5" />
            </span>
            <div className="mt-3 text-[15px] font-semibold">{placeholder?.title}</div>
            <p className="mt-1 text-[12px] text-muted-foreground">{placeholder?.hint}</p>
          </div>
        )}
      </div>
    </div>
  );
}
