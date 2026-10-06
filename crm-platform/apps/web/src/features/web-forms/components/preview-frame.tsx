'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { FormRenderer } from './form-renderer';
import type { RenderableForm } from '../lib/types';

/** Empty page the form is drawn into; it carries only a reset, so the form's own stylesheet decides everything else. */
const FRAME_DOC =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<style>html,body{margin:0;min-height:100%}body{background:transparent}</style>' +
  '</head><body></body></html>';

/**
 * The builder's live preview. The form renders into a real, separate document (the same isolation the public page and the embed have),
 * so its stylesheet applies there and nothing of it leaks into the builder, and the builder's styles never touch the form. The frame
 * is sandboxed without scripts: React still drives the portal from this window, but the page itself can run nothing.
 */
export function PreviewFrame({
  form,
  device,
  forceMode,
}: {
  form: RenderableForm;
  device: 'desktop' | 'mobile';
  forceMode?: 'light' | 'dark';
}) {
  const t = useTranslations('web-forms.design');
  const frame = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const { locale, dir } = form.settings;
  const direction = dir ?? (locale === 'ar' ? 'rtl' : 'ltr');

  // The document is replaced whenever the frame reloads, so the portal target is re-read on every load.
  const onLoad = () => setBody(frame.current?.contentDocument?.body ?? null);

  useEffect(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!root || !body) return;
    root.lang = locale;
    root.dir = direction;
  }, [body, locale, direction]);

  return (
    <div
      className={cn(
        'mx-auto h-[calc(100vh-14rem)] min-h-[520px] max-w-full overflow-hidden rounded-lg border border-border bg-muted',
        device === 'mobile' ? 'w-[390px]' : 'w-full',
      )}
      data-device={device}
    >
      <iframe
        ref={frame}
        title={t('preview.frameTitle')}
        srcDoc={FRAME_DOC}
        sandbox="allow-same-origin"
        onLoad={onLoad}
        className="block size-full border-0"
      />
      {body
        ? createPortal(<FormRenderer form={form} mode="preview" forceMode={forceMode} />, body)
        : null}
    </div>
  );
}
