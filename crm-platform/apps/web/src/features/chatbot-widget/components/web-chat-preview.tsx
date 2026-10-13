'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { CHAT_SIZE_PX } from '@crm/contracts';
import { Spinner } from '@crm/ui';
import { useWebChatPreviewPage } from '../api/widgets';
import { chatPreviewWidget, type BuilderState } from '../lib/builder-model';

/**
 * The live preview of a website chat bot's Customize tab: the real chat window (the same page a visitor gets) in a frame, repainted
 * a moment after every change with the settings being edited, saved or not. The page is told what to draw by a message; it makes no
 * request and starts no conversation.
 */
export type PreviewSurface = 'chat' | 'expanded' | 'mobile' | 'closed';

/** The frame of each chat surface: the docked window at the size the author chose, the expanded one and a phone's sheet. */
const frameSize = (surface: 'chat' | 'expanded' | 'mobile', size: keyof typeof CHAT_SIZE_PX) =>
  surface === 'mobile'
    ? { maxWidth: 360, height: 640 }
    : surface === 'expanded'
      ? { maxWidth: 880, height: 720 }
      : { maxWidth: CHAT_SIZE_PX[size].w, height: CHAT_SIZE_PX[size].h };

export function WebChatPreview({
  flowId,
  s,
  surface = 'chat',
}: {
  flowId: string;
  s: BuilderState;
  surface?: 'chat' | 'expanded' | 'mobile';
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.preview');
  const q = useWebChatPreviewPage(flowId);
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef(s);
  useEffect(() => {
    latest.current = s;
  });

  const paint = () => {
    const win = frame.current?.contentWindow;
    if (win && ready.current)
      win.postMessage({ wgtPreview: { widget: chatPreviewWidget(latest.current) } }, '*');
  };

  // The page says when it can draw; after that every change is sent a moment after it is made.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if ((e.data as { wgt?: string } | null)?.wgt === 'preview-ready') {
        ready.current = true;
        paint();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const json = JSON.stringify(chatPreviewWidget(s));
  useEffect(() => {
    const timer = window.setTimeout(paint, 120);
    return () => window.clearTimeout(timer);
  }, [json]);

  if (q.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (q.isError) return <p className="p-8 text-center text-[13px] text-danger">{t('error')}</p>;
  return (
    <div
      data-testid="web-chat-preview"
      data-surface={surface}
      style={frameSize(surface, s.launcher.chat.size)}
      className="mx-auto w-full overflow-hidden rounded-[20px] border border-border bg-white shadow-lg"
    >
      <iframe
        ref={frame}
        title={t('frame')}
        sandbox="allow-scripts"
        srcDoc={q.data.html}
        className="size-full border-0"
      />
    </div>
  );
}
