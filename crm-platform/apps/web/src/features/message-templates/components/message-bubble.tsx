'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { parseMarkup, type Segment } from '../lib/format';
import type { PreviewModel } from '../lib/form-model';
import { CopyIcon, DocumentIcon, ImageIcon, LinkIcon, PhoneIcon, PinIcon, ReplyIcon, VideoIcon } from './icons';

/** The fixed code shown in the authentication layout (display only). */
const AUTH_SAMPLE_CODE = '482913';

function renderSegments(segs: Segment[], keyBase = 'k'): ReactNode[] {
  return segs.map((s, i) => {
    const key = `${keyBase}${i}`;
    switch (s.kind) {
      case 'text':
        return s.text.split('\n').map((line, j, all) => (
          <span key={`${key}-${j}`}>
            {line}
            {j < all.length - 1 && <br />}
          </span>
        ));
      case 'var':
        return (
          <span key={key} className="rounded bg-success/15 px-1 font-medium text-success">
            {`{{${s.token}}}`}
          </span>
        );
      case 'code':
        return (
          <code key={key} className="font-mono text-[0.9em]">
            {s.text}
          </code>
        );
      case 'bold':
        return <strong key={key}>{renderSegments(s.children, key)}</strong>;
      case 'italic':
        return <em key={key}>{renderSegments(s.children, key)}</em>;
      case 'strike':
        return <del key={key}>{renderSegments(s.children, key)}</del>;
    }
  });
}

/** Body text in WhatsApp's markup, rendered as elements (no HTML injection). Unfilled `{{tokens}}` show as pills. */
export function FormattedText({ text }: { text: string }) {
  return <>{renderSegments(parseMarkup(text))}</>;
}

function ButtonIcon({ kind }: { kind: PreviewModel['buttons'][number]['kind'] }) {
  const cls = 'size-3.5 shrink-0';
  if (kind === 'url') return <LinkIcon className={cls} />;
  if (kind === 'phone') return <PhoneIcon className={cls} />;
  if (kind === 'copy_code') return <CopyIcon className={cls} />;
  return <ReplyIcon className={cls} />;
}

function MediaBlock({ model }: { model: PreviewModel }) {
  const t = useTranslations('message-templates.preview');
  const k = model.headerKind;
  if (k === 'image' && model.headerImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Meta's sample URL, not a build-time asset
      <img
        src={model.headerImageUrl}
        alt={t('headerImageAlt')}
        className="mb-1.5 h-28 w-full rounded-md object-cover"
      />
    );
  }
  if (k !== 'image' && k !== 'video' && k !== 'document' && k !== 'location') return null;
  const Icon = k === 'video' ? VideoIcon : k === 'document' ? DocumentIcon : k === 'location' ? PinIcon : ImageIcon;
  return (
    <div
      className="mb-1.5 grid h-24 place-items-center rounded-md border border-border bg-muted text-muted-foreground"
      data-testid="bubble-media"
    >
      <span className="flex flex-col items-center gap-1 text-xs">
        <Icon className="size-6" />
        {t(`header.${k}`)}
      </span>
    </div>
  );
}

/**
 * The WhatsApp-style message bubble used by the library cards, the live form preview and the detail page. Only shows what
 * the template holds; it never invents content.
 */
export function MessageBubble({
  model,
  maxButtons,
  className,
}: {
  model: PreviewModel;
  /** The library card shows three and "+N more". The form and the detail show them all. */
  maxButtons?: number;
  className?: string;
}) {
  const t = useTranslations('message-templates.preview');
  const shown = maxButtons === undefined ? model.buttons : model.buttons.slice(0, maxButtons);
  const hidden = model.buttons.length - shown.length;

  return (
    <div
      className={cn('w-full max-w-[95%] rounded-lg rounded-ss-sm bg-background px-2.5 py-2 text-sm shadow-sm', className)}
      data-testid="message-bubble"
    >
      {model.auth ? (
        <>
          <p>
            <strong>{AUTH_SAMPLE_CODE}</strong> {t('authBody')}
          </p>
          {model.expiry !== null && (
            <p className="mt-1 text-xs text-muted-foreground">{t('authExpiry', { count: model.expiry })}</p>
          )}
        </>
      ) : (
        <>
          <MediaBlock model={model} />
          {model.headerKind === 'text' && model.headerText && (
            <p className="mb-1 font-semibold break-words">
              <FormattedText text={model.headerText} />
            </p>
          )}
          {model.body ? (
            <p className="break-words" data-testid="bubble-body">
              <FormattedText text={model.body} />
            </p>
          ) : (
            <p className="text-muted-foreground">{t('bodyEmpty')}</p>
          )}
          {model.footer && <p className="mt-1 text-xs text-muted-foreground break-words">{model.footer}</p>}
        </>
      )}
      <p className="mt-1 text-end text-[10px] text-muted-foreground">{t('time')} ✓✓</p>
      {(shown.length > 0 || model.auth) && (
        <ul className="mt-1.5 space-y-1 border-t border-border pt-1.5" data-testid="bubble-buttons">
          {model.auth ? (
            <li className="flex items-center justify-center gap-1.5 text-xs font-medium text-brand">
              <CopyIcon className="size-3.5" />
              {t('copyCode')}
            </li>
          ) : (
            shown.map((b, i) => (
              <li key={i} className="flex items-center justify-center gap-1.5 text-xs font-medium text-brand">
                <ButtonIcon kind={b.kind} />
                <span className="truncate">{b.text || t('buttonUnnamed')}</span>
              </li>
            ))
          )}
          {hidden > 0 && <li className="text-center text-[11px] text-muted-foreground">{t('moreButtons', { count: hidden })}</li>}
        </ul>
      )}
    </div>
  );
}

/** A phone-shaped frame around the bubble, for the form and the detail page. */
export function PhonePreview({ model }: { model: PreviewModel }) {
  const t = useTranslations('message-templates.preview');
  return (
    <section aria-label={t('title')} className="rounded-2xl border border-border bg-muted p-3" data-testid="phone-preview">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">{t('title')}</span>
        <span className="rounded-full bg-background px-2 py-0.5 font-mono">{model.language}</span>
      </div>
      <div className="min-h-40 rounded-xl bg-muted/60 p-2">
        <MessageBubble model={model} />
      </div>
    </section>
  );
}

