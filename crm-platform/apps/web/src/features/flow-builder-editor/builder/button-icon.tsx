'use client';

import { useContext, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { launcherAvatarSrc } from '@crm/contracts';
import { uploadFlowWidgetImage } from '@/features/chatbot-widget/api/widgets';
import { IMAGE_MAX_BYTES } from '@/features/chatbot-widget/components/image-upload';
import { FlowEditorContext } from '../lib/flow-editor-context';

/** A random slot name for one button's picture: `bi` and eight hex digits, so no two buttons share a picture. */
const newSlot = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `bi${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * An optional small picture in front of a button, for a website chat bot only (the other channels have no room for one). The
 * picture is uploaded to the bot, and the address it comes back with is kept on the button; with no picture the button keeps its
 * round arrow. A bot that has not been saved yet has nowhere to keep a picture, and says so.
 */
export function ButtonIcon({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { flowId, web } = useContext(FlowEditorContext);
  const t = useTranslations('flb.builder.buttonIcon');
  const tu = useTranslations('chatbotWidget.whatsappBuilder.upload');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!web) return null;
  const pick = async (file: File | undefined) => {
    if (!file || !flowId) return;
    setError(null);
    if (file.size > IMAGE_MAX_BYTES) {
      setError(tu('tooLarge'));
      return;
    }
    setBusy(true);
    try {
      onChange(await uploadFlowWidgetImage(flowId, newSlot(), file));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : tu('failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11.5px]" data-testid="button-icon">
      <span className="font-medium text-muted-foreground">{t('label')}</span>
      {value !== '' ? (
        <img
          src={launcherAvatarSrc(value)}
          alt=""
          className="size-7 rounded-full border border-border object-cover"
        />
      ) : null}
      {flowId ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="rounded-full border border-border px-2.5 py-1 font-semibold hover:bg-muted disabled:opacity-50"
          >
            {busy ? tu('uploading') : value !== '' ? tu('replace') : t('add')}
          </button>
          {value !== '' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange('')}
              className="font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {tu('remove')}
            </button>
          ) : null}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
            tabIndex={-1}
            className="sr-only"
            aria-label={t('add')}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </>
      ) : (
        <span className="text-muted-foreground">{t('saveFirst')}</span>
      )}
      {error ? (
        <span role="alert" className="basis-full text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
