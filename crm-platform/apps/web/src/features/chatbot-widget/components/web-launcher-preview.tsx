'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Spinner } from '@crm/ui';
import { previewFlowEmbed } from '../api/widgets';
import { launcherPayload, type BuilderState } from '../lib/builder-model';

/**
 * The closed launcher of a website chat bot as a visitor's site draws it: the real loader (the launcher, the callout, the animation
 * and the unread dot) on a stand-in page, repainted a moment after every change with the settings being edited.
 */
export function WebLauncherPreview({ flowId, s }: { flowId: string; s: BuilderState }) {
  const t = useTranslations('chatbotWidget.flowBot.customize.preview');
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const body = JSON.stringify({
    launcher: launcherPayload(s.launcher),
    position: s.position,
    buttonColor: s.buttonColor,
    buttonImageUrl: s.buttonImageUrl,
  });
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      previewFlowEmbed(flowId, JSON.parse(body) as Record<string, unknown>)
        .then((r) => {
          if (live) {
            setHtml(r.html);
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [flowId, body]);
  if (failed) return <p className="p-8 text-center text-[13px] text-danger">{t('error')}</p>;
  if (html === null)
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  return (
    <div
      data-testid="web-launcher-preview"
      className="mx-auto h-[640px] w-full max-w-[640px] overflow-hidden rounded-[20px] border border-border bg-white shadow-lg"
    >
      <iframe
        title={t('launcherFrame')}
        sandbox="allow-scripts"
        srcDoc={html}
        className="size-full border-0"
      />
    </div>
  );
}
