'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { previewLauncher, previewWhatsappLink, type BuilderState } from '../lib/builder-model';
import { previewDocument } from '../lib/launcher-preview-doc';

export type PreviewDevice = 'desktop' | 'mobile';

const REPAINT_MS = 120;

/**
 * The live preview of the WhatsApp widget page (WD-WGT-028): a stand-in website frame running the real embed script with
 * the options as they are right now. It repaints a moment after every change and keeps the messenger panel open across
 * repaints. Start Conversation in it opens WhatsApp for the configured number, as on a real site.
 */
export function LauncherPreview({ s, device }: { s: BuilderState; device: PreviewDevice }) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.preview');
  const frame = useRef<HTMLIFrameElement>(null);
  const open = useRef(false);

  const fallbackName = t('businessName');
  const input = {
    name: s.name.trim() || fallbackName,
    launcher: previewLauncher(s.launcher),
    whatsappUrl: previewWhatsappLink(s),
    device,
  };
  // Repaint only when what the frame draws changes, never on an unrelated re-render of the builder.
  const key = JSON.stringify(input);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const [doc, setDoc] = useState(() => previewDocument({ ...input, startOpen: false }));

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDoc(previewDocument({ ...latest.current, startOpen: open.current })),
      REPAINT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [key]);

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
    <aside className="xl:sticky xl:top-[92px]" aria-label={t('title')}>
      <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('title')}
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] text-emerald-900">
            {t(device)}
          </span>
        </div>
        <div
          data-testid="launcher-preview"
          data-device={device}
          className={cn(
            'mx-auto overflow-hidden bg-white shadow-inner',
            device === 'mobile'
              ? 'w-[300px] rounded-[28px] border-[6px] border-foreground/80'
              : 'w-full rounded-xl border border-border',
          )}
          style={{ height: device === 'mobile' ? 560 : 460 }}
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
    </aside>
  );
}
