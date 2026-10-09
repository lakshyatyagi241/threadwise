'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { PreviewModel } from '../lib/form-model';
import { FormattedText } from './message-bubble';
import {
  CheckIcon,
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
      className="mb-1.5 grid h-20 place-items-center rounded-md border border-border bg-muted text-muted-foreground"
      data-testid="bubble-media"
    >
      <Icon className="size-6" />
      <span className="sr-only">{t(`header.${k}`)}</span>
    </div>
  );
}

/**
 * The WhatsApp-style message bubble used by the library cards, the live form preview and the detail page: the bubble, then
 * one white pill per button underneath, as WhatsApp draws them. Only shows what the template holds; it never invents content.
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
    <div className={cn('flex w-full max-w-[95%] flex-col gap-1', className)}>
      <div
        className="rounded-lg rounded-ss-sm bg-background px-2.5 py-2 text-[12px] leading-[1.5] shadow-sm"
        data-testid="message-bubble"
      >
        {model.auth ? (
          <>
            <p>
              <strong>{AUTH_SAMPLE_CODE}</strong> {t('authBody')}
            </p>
            {model.expiry !== null && (
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {t('authExpiry', { count: model.expiry })}
              </p>
            )}
          </>
        ) : (
          <>
            <MediaBlock model={model} />
            {model.headerKind === 'text' && model.headerText && (
              <p className="mb-1 text-[12.5px] font-semibold leading-snug break-words">
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
              <p className="mt-1.5 text-[10.5px] text-muted-foreground break-words">
                {model.footer}
              </p>
            )}
          </>
        )}
        <p className="mt-1 flex items-center justify-end gap-1 text-[9px] text-muted-foreground">
          <span>{t('time')}</span>
          <CheckIcon className="h-3 w-3.5 text-brand" />
        </p>
      </div>
      {(shown.length > 0 || model.auth) && (
        <ul className="space-y-1" data-testid="bubble-buttons">
          {model.auth ? (
            <li className="flex items-center justify-center gap-1.5 rounded-lg bg-background py-1.5 text-[12px] font-medium text-brand shadow-sm">
              <CopyIcon className="size-3.5" />
              {t('copyCode')}
            </li>
          ) : (
            shown.map((b, i) => (
              <li
                key={i}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-background px-2 py-1.5 text-[12px] font-medium text-brand shadow-sm"
              >
                <ButtonIcon kind={b.kind} />
                <span className="truncate">{b.text || t('buttonUnnamed')}</span>
              </li>
            ))
          )}
          {hidden > 0 && (
            <li className="text-center font-mono text-[10px] text-muted-foreground">
              {t('moreButtons', { count: hidden })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
