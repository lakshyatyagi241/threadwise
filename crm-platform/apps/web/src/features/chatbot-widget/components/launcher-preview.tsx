'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { previewSource, type BuilderState } from '../lib/builder-model';
import { previewDocument } from '../lib/launcher-preview-doc';

export type PreviewDevice = 'desktop' | 'mobile';

const REPAINT_MS = 120;

/**
 * The one live preview of the builder (TW-WGT-028), the same for all three engines: a stand-in website frame running the
 * real WhatsApp messenger script with the panel OPEN, as tall as the real one, repainted a moment after every change. The
 * content comes from the WhatsApp page's options, or, for Smart agent and Smart + WhatsApp, from the wizard's fields. The
 * visitor's own collapse and re-open of the panel are remembered across repaints.
 */
export function LauncherPreview({
  s,
  device,
  onDevice,
  children,
}: {
  s: BuilderState;
  device: PreviewDevice;
  /** The wizard has no placement card, so its preview carries its own Desktop / Mobile switch. */
  onDevice?: (device: PreviewDevice) => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.preview');
  const frame = useRef<HTMLIFrameElement>(null);
  const open = useRef(true);

  const fallbackName = t('businessName');
  const build = (startOpen: boolean) =>
    previewDocument({ ...previewSource(s, fallbackName), device, startOpen });
  // Repaint only when what the frame draws changes, never on an unrelated re-render of the builder.
  const fresh = build(true);
  const latest = useRef(build);
  useEffect(() => {
    latest.current = build;
  });
  const [doc, setDoc] = useState(fresh);

  useEffect(() => {
    const timer = window.setTimeout(() => setDoc(latest.current(open.current)), REPAINT_MS);
    return () => window.clearTimeout(timer);
  }, [fresh]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { wgt?: string; open?: boolean } | null;
      if (e.source === frame.current?.contentWindow && data?.wgt === 'toggle') {
        open.current = data.open === true;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <aside className="space-y-4 xl:sticky xl:top-[92px]" aria-label={t('title')}>
      <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('title')}
          </span>
          {onDevice ? (
            <div role="radiogroup" aria-label={t('title')} className="flex gap-1">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={device === d}
                  data-preview-device={d}
                  onClick={() => onDevice(d)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 font-mono text-[10px] transition',
                    device === d
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {t(d)}
                </button>
              ))}
            </div>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] text-emerald-900">
              {t(device)}
            </span>
          )}
        </div>
        <div
          data-testid="launcher-preview"
          data-device={device}
          className={cn(
            'mx-auto overflow-hidden bg-white shadow-inner',
            device === 'mobile'
              ? 'w-[372px] max-w-full rounded-[32px] border-[6px] border-foreground/80'
              : 'w-full rounded-xl border border-border',
          )}
          style={{ height: device === 'mobile' ? 700 : 620 }}
        >
          <iframe
            ref={frame}
            title={t('frameTitle')}
            data-testid="launcher-preview-frame"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            srcDoc={doc}
            className="size-full border-0"
          />
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">{t('hint')}</p>
      </div>
      {children}
    </aside>
  );
}
