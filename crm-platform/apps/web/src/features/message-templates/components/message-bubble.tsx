'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { parseMarkup, type Segment } from '../lib/format';
import type { PreviewModel } from '../lib/form-model';
import {
  CopyIcon,
  DocumentIcon,
  ImageIcon,
  LinkIcon,
  PhoneIcon,
  PinIcon,
  ReplyIcon,
  VideoIcon,
} from './icons';

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

export function ButtonIcon({ kind }: { kind: PreviewModel['buttons'][number]['kind'] }) {
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
      <img
        src={model.headerImageUrl}
        alt={t('headerImageAlt')}
        className="mb-1.5 h-28 w-full rounded-md object-cover"
      />
    );
  }
  if (k !== 'image' && k !== 'video' && k !== 'document' && k !== 'location') return null;
  const Icon =
    k === 'video'
      ? VideoIcon
      : k === 'document'
        ? DocumentIcon
        : k === 'location'
          ? PinIcon
          : ImageIcon;
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
      className={cn(
        'w-full max-w-[95%] rounded-lg rounded-ss-sm bg-background px-2.5 py-2 text-sm shadow-sm',
        className,
      )}
      data-testid="message-bubble"
    >
      {model.auth ? (
        <>
          <p>
            <strong>{AUTH_SAMPLE_CODE}</strong> {t('authBody')}
          </p>
          {model.expiry !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('authExpiry', { count: model.expiry })}
            </p>
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
          {model.footer && (
            <p className="mt-1 text-xs text-muted-foreground break-words">{model.footer}</p>
          )}
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
              <li
                key={i}
                className="flex items-center justify-center gap-1.5 text-xs font-medium text-brand"
              >
                <ButtonIcon kind={b.kind} />
                <span className="truncate">{b.text || t('buttonUnnamed')}</span>
              </li>
            ))
          )}
          {hidden > 0 && (
            <li className="text-center text-[11px] text-muted-foreground">
              {t('moreButtons', { count: hidden })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * A phone around the bubble that looks like WhatsApp: status bar, chat header (back, avatar, business name, call icons), the chat
 * wallpaper with a date chip, the message bubble, and the input bar. Display only; it shows what the template holds.
 */
export function PhonePreview({ model }: { model: PreviewModel }) {
  const t = useTranslations('message-templates.preview');
  return (
    <section
      aria-label={t('title')}
      className="mx-auto w-full max-w-[340px]"
      data-testid="phone-preview"
    >
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">{t('live')}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono">{model.language}</span>
      </div>
      <div className="rounded-[2.4rem] bg-neutral-900 p-2 shadow-xl ring-1 ring-black/20">
        <div className="relative flex h-[min(34rem,calc(100dvh-16rem))] min-h-[26rem] flex-col overflow-hidden rounded-[2rem] bg-[#efeae2] dark:bg-[#0b141a]">
          <div className="absolute top-1.5 left-1/2 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-neutral-900" />
          <div className="flex items-center justify-between bg-[#008069] px-5 pt-2 pb-1 text-[10px] font-medium text-white dark:bg-[#202c33]">
            <span>{t('time')}</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <svg viewBox="0 0 16 10" className="h-2.5 w-3.5" fill="currentColor">
                <rect x="0" y="6" width="3" height="4" rx="0.5" />
                <rect x="4.3" y="4" width="3" height="6" rx="0.5" />
                <rect x="8.6" y="2" width="3" height="8" rx="0.5" />
                <rect x="12.9" y="0" width="3" height="10" rx="0.5" />
              </svg>
              <svg viewBox="0 0 24 12" className="h-2.5 w-5" fill="none" stroke="currentColor">
                <rect x="1" y="1" width="19" height="10" rx="2.5" />
                <rect x="3" y="3" width="13" height="6" rx="1" fill="currentColor" stroke="none" />
                <rect
                  x="21"
                  y="4"
                  width="2"
                  height="4"
                  rx="0.8"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </span>
          </div>
          <div className="flex items-center gap-2 bg-[#008069] px-2 py-2 text-white dark:bg-[#202c33]">
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span className="grid size-8 place-items-center rounded-full bg-white/90 text-xs font-bold text-[#008069]">
              {t('business').slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{t('business')}</p>
              <p className="text-[10px] opacity-80">{t('online')}</p>
            </div>
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z" />
            </svg>
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
              <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.6 3.6a1 1 0 0 1-.25 1z" />
            </svg>
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 [background-image:radial-gradient(rgba(0,0,0,0.045)_1px,transparent_1px)] [background-size:14px_14px] dark:[background-image:radial-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)]">
            <p className="mx-auto w-fit rounded-md bg-white/90 px-2.5 py-1 text-[10px] font-medium tracking-wide text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
              TODAY
            </p>
            <MessageBubble
              model={model}
              className="max-w-[92%] bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]"
            />
          </div>
          <div
            className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2 dark:bg-[#202c33]"
            aria-hidden="true"
          >
            <span className="flex-1 rounded-full bg-white px-3 py-1.5 text-xs text-[#667781] dark:bg-[#2a3942] dark:text-[#8696a0]">
              Message
            </span>
            <span className="grid size-8 place-items-center rounded-full bg-[#008069] text-white">
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12z" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
