'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { previewLauncher, previewWhatsappLink, type BuilderState } from '../lib/builder-model';
import { chatPreviewDocument, chatPreviewInput } from '../lib/chat-preview-doc';
import { previewDocument } from '../lib/launcher-preview-doc';

export type PreviewDevice = 'desktop' | 'mobile';

const REPAINT_MS = 120;

/**
 * The live preview shared by all three engines (TW-WGT-028): a stand-in website frame with the messenger panel OPEN, as tall
 * as the real one, repainted a moment after every change. For a WhatsApp widget it runs the real embed script (Start
 * Conversation opens WhatsApp for the configured number); for Smart agent and Smart + WhatsApp it draws the wizard's fields
 * in the same panel (header, welcome bubble, intake, input and send, the WhatsApp action). The visitor's own collapse and
 * re-open of the panel are remembered across repaints.
 */
export function LauncherPreview({
  s,
  device,
  onDevice,
  children,
}: {
  s: BuilderState;
  device: PreviewDevice;
  /** The wizard has no placement card, so the preview carries its own Desktop / Mobile switch. */
  onDevice?: (device: PreviewDevice) => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.preview');
  const frame = useRef<HTMLIFrameElement>(null);
  const open = useRef(true);
  const chat = s.mode !== 'whatsapp';

  const fallbackName = t('businessName');
  const texts = { title: t('chatTitle'), welcome: t('chatWelcome'), send: t('chatSend') };
  const build = (startOpen: boolean) =>
    chat
      ? chatPreviewDocument(chatPreviewInput(s, device, startOpen, texts))
      : previewDocument({
          name: s.name.trim() || fallbackName,
          launcher: previewLauncher(s.launcher),
          whatsappUrl: previewWhatsappLink(s),
          device,
          startOpen,
        });
  // Repaint only when what the frame draws changes, never on an unrelated re-render of the builder.
  const fresh = build(true);
  const key = fresh;
  const latest = useRef(build);
  useEffect(() => {
    latest.current = build;
  });
  const [doc, setDoc] = useState(fresh);

  useEffect(() => {
    const timer = window.setTimeout(() => setDoc(latest.current(open.current)), REPAINT_MS);
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

  const height = chat ? 700 : device === 'mobile' ? 700 : 620;
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
          style={{ height }}
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
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {t(chat ? 'chatHint' : 'hint')}
        </p>
      </div>
      {children}
    </aside>
  );
}
