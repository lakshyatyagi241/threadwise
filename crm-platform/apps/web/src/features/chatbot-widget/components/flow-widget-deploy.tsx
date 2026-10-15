'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { QRCodeCanvas } from 'qrcode.react';
import { buildWhatsappLink } from '@crm/contracts';
import { Spinner, useToast } from '@crm/ui';
import { useFlowWidget } from '../api/widgets';
import { snippetFor } from '../lib/builder-model';

const PRIMARY =
  'rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground hover:opacity-90';
const SECONDARY =
  'rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold hover:border-brand hover:text-brand';
const CODE =
  'overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-foreground p-3 pe-20 font-mono text-[11.5px] leading-relaxed text-background';

/** True when the address only works on the computer it is typed on, so a live website cannot load it. */
export function isLocalAddress(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

/** One way to put the bot in front of people: a numbered card with a title, a line of help and its controls. */
function Step({
  n,
  id,
  title,
  body,
  children,
  className = '',
}: {
  n: number;
  id: string;
  title: string;
  body: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`rounded-2xl border border-border bg-background p-4 sm:p-5 ${className}`}
    >
      <div className="mb-3 flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-[12px] font-bold text-brand"
        >
          {n}
        </span>
        <div className="min-w-0">
          <h3 id={id} className="text-[14px] font-semibold">
            {title}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{body}</p>
        </div>
      </div>
      <div className="space-y-3 sm:ps-10">{children}</div>
    </section>
  );
}

/** A code block with its copy button inside it. */
function CodeBlock({
  testId,
  text,
  label,
  copyLabel,
  onCopy,
}: {
  testId: string;
  text: string;
  label: string;
  copyLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="relative">
      <span className="absolute start-3 top-1.5 text-[10px] font-semibold uppercase tracking-wider text-background/50">
        {label}
      </span>
      <pre data-testid={testId} className={`${CODE} pt-6`}>
        {text}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        className="absolute end-2 top-1.5 rounded bg-background/15 px-2 py-0.5 text-[11px] font-semibold text-background hover:bg-background/25"
      >
        {copyLabel}
      </button>
    </div>
  );
}

/**
 * The Deploy tab of a website chat or WhatsApp bot: where to put it. Nothing is deployed here; the bot goes live when it is
 * published. A website chat bot gets its embed code and the chat page. A WhatsApp bot gets the embed code of its website button, a
 * QR code and the direct WhatsApp link (for emails, social bios and print), each as a numbered card.
 */
export function FlowWidgetDeploy({
  flowId,
  channel,
  published,
}: {
  flowId: string;
  channel: 'web' | 'chat';
  published: boolean;
}) {
  const t = useTranslations('chatbotWidget.flowBot.deploy');
  const { toast } = useToast();
  const qr = useRef<HTMLDivElement>(null);
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
        {t(channel === 'chat' ? 'lockedWhatsapp' : 'locked')}
      </p>
    );
  }
  const link =
    channel === 'chat'
      ? buildWhatsappLink(
          widget.targetWhatsappCc,
          widget.targetWhatsappNumber,
          widget.prefilledMessage,
        )
      : null;
  const downloadQr = () => {
    const canvas = qr.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'whatsapp-qr-code.png';
    a.click();
  };
  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done, 'success');
    } catch {
      toast(t('clipboardBlocked'), 'info');
    }
  };
  const snippet = snippetFor(widget.embedUrl);
  return (
    <div className="w-full space-y-5 p-4 sm:p-6 lg:px-10 lg:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl">{t('title')}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t(channel === 'chat' ? 'leadWhatsapp' : 'lead')}
          </p>
        </div>
        <span
          data-testid="deploy-status"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            published ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
          }`}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {t(published ? 'statusLive' : 'statusDraft')}
        </span>
      </div>
      {published ? null : (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[12.5px]"
        >
          {t(channel === 'chat' ? 'notPublishedWhatsapp' : 'notPublished')}
        </p>
      )}
      {isLocalAddress(widget.embedUrl) ? (
        <p
          role="note"
          data-testid="deploy-local-note"
          className="rounded-xl border border-border bg-muted p-3 text-[12.5px]"
        >
          {t('localNote')}
        </p>
      ) : null}

      <div className={link ? 'grid gap-5 xl:grid-cols-3' : 'grid gap-5'}>
        <Step
          n={1}
          id="deploy-embed"
          title={t('embedTitle')}
          body={t('embedBody')}
          className={link ? 'xl:col-span-3' : ''}
        >
          <CodeBlock
            testId="install-snippet"
            text={snippet}
            label={t('codeLabel')}
            copyLabel={t('copy')}
            onCopy={() => void copy(snippet, t('copied'))}
          />
          <div className="flex flex-wrap gap-2">
            <a href={widget.previewUrl} target="_blank" rel="noopener" className={SECONDARY}>
              {t('preview')}
            </a>
          </div>
        </Step>

        {link ? (
          <>
            <Step
              n={2}
              id="deploy-qr"
              title={t('qrTitle')}
              body={t('qrBody')}
              className="xl:col-span-1"
            >
              <div
                ref={qr}
                data-testid="deploy-qr"
                className="inline-block rounded-lg border border-border bg-white p-3"
              >
                <QRCodeCanvas value={link} size={176} marginSize={1} />
              </div>
              <div>
                <button type="button" onClick={downloadQr} className={SECONDARY}>
                  {t('downloadQr')}
                </button>
              </div>
            </Step>
            <Step
              n={3}
              id="deploy-link"
              title={t('linkTitle')}
              body={t('linkBody')}
              className="xl:col-span-2"
            >
              <pre data-testid="deploy-link" className={`${CODE} pe-3`}>
                {link}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copy(link, t('linkCopied'))}
                  className={PRIMARY}
                >
                  {t('copyLink')}
                </button>
                <a href={link} target="_blank" rel="noopener" className={SECONDARY}>
                  {t('openLink')}
                </a>
              </div>
            </Step>
          </>
        ) : null}
      </div>
    </div>
  );
}
