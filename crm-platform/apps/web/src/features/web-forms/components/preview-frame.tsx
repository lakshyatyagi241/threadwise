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
export type PreviewDevice = 'desktop' | 'mobile' | 'popup';
export const PREVIEW_DEVICES: readonly PreviewDevice[] = ['desktop', 'mobile', 'popup'];

/** The three ways the form is seen: on a page, on a phone, and in a popup over the owner's own website. */
export function PreviewDeviceToggle({
  value,
  onChange,
}: {
  value: PreviewDevice;
  onChange: (v: PreviewDevice) => void;
}) {
  const t = useTranslations('web-forms.design');
  return (
    <div role="group" aria-label={t('preview.device')} className="inline-flex gap-1">
      {PREVIEW_DEVICES.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={cn(
            'min-h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary',
            value === d
              ? 'border-primary bg-primary/10 font-medium text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          {t(`preview.${d}`)}
        </button>
      ))}
    </div>
  );
}

export function PreviewFrame({
  form,
  device,
  forceMode,
}: {
  form: RenderableForm;
  device: PreviewDevice;
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
        ? createPortal(
            device === 'popup' ? (
              // What the loader draws on a website: the page dimmed, the form in a dialog with a close button, no page chrome.
              <div
                data-testid="popup-preview"
                style={{
                  minHeight: '100vh',
                  background: 'rgba(15,23,42,.55)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 12,
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: 'min(560px,100%)',
                    maxHeight: 'calc(100vh - 24px)',
                    overflow: 'auto',
                    borderRadius: 12,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 8,
                      insetInlineEnd: 8,
                      zIndex: 1,
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      background: 'rgba(15,23,42,.1)',
                      color: '#111',
                      font: '22px/36px sans-serif',
                      textAlign: 'center',
                    }}
                  >
                    {'\u00d7'}
                  </span>
                  <FormRenderer form={form} mode="preview" embed forceMode={forceMode} />
                </div>
              </div>
            ) : (
              <FormRenderer form={form} mode="preview" forceMode={forceMode} />
            ),
            body,
          )
        : null}
    </div>
  );
}
