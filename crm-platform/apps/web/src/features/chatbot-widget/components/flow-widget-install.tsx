'use client';

import { useTranslations } from 'next-intl';
import { Spinner, useToast } from '@crm/ui';
import { useFlowWidget } from '../api/widgets';
import { snippetFor } from '../lib/builder-model';

/**
 * The Install tab of a website chat bot: only shows the script to paste and the standalone chat link. Nothing is deployed
 * here; the bot goes live when it is published.
 */
export function FlowWidgetInstall({ flowId, published }: { flowId: string; published: boolean }) {
  const t = useTranslations('chatbotWidget.flowBot.install');
  const { toast } = useToast();
  const q = useFlowWidget(flowId);
  if (q.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  const widget = q.data?.widget ?? null;
  if (!widget) {
    return (
      <p className="mx-auto max-w-xl p-10 text-center text-[13px] text-muted-foreground">
        {t('locked')}
      </p>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippetFor(widget.embedUrl));
      toast(t('copied'), 'success');
    } catch {
      toast(t('clipboardBlocked'), 'info');
    }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg">{t('title')}</h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{t('lead')}</p>
      </div>
      {published ? null : (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[12.5px]"
        >
          {t('notPublished')}
        </p>
      )}
      <pre
        data-testid="install-snippet"
        className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-foreground p-3 font-mono text-[11.5px] leading-relaxed text-background"
      >
        {snippetFor(widget.embedUrl)}
      </pre>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground hover:opacity-90"
        >
          {t('copy')}
        </button>
        <a
          href={widget.previewUrl}
          target="_blank"
          rel="noopener"
          className="rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold hover:border-brand hover:text-brand"
        >
          {t('preview')}
        </a>
      </div>
    </div>
  );
}
