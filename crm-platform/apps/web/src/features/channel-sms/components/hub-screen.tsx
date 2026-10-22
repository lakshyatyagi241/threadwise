'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useSmsSenders } from '../api/sms';
import { ConnectForm } from './connect-form';
import { LookupCard } from './lookup-card';
import { SenderCard } from './sender-card';

const STEPS = ['connect', 'report', 'send', 'billing'] as const;
const GUIDES = ['twilio', 'msg91', 'billing'] as const;
const POINTS = ['p1', 'p2', 'p3', 'p4'] as const;
const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/**
 * `/sms` (TW-SMS-001): the one screen where a workspace sees its SMS senders, connects another, switches one off, removes one and
 * checks a number, with the setup guide for both providers. SMS is send-only, so there is no inbox or reply copy here.
 */
export function HubScreen() {
  const t = useTranslations('sms.hub');
  const g = useTranslations('sms.guide');
  const senders = useSmsSenders();
  const canManage = useCan('sms.senders.manage');
  const [copied, setCopied] = useState(false);
  const list = senders.data?.data ?? [];
  const url = senders.data?.deliveryReportUrl;
  const active = list.filter((s) => s.active).length;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const jumpToForm = () => {
    document.getElementById('sms-connect')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('sms-from')?.focus({ preventScroll: true });
  };

  return (
    <div className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="not-italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/campaigns" className={pillLink}>
            {t('campaigns')}
          </Link>
          <Link href="/broadcasts" className={pillLink}>
            {t('broadcasts')}
          </Link>
          <Link href="/settings/channels" className={pillLink}>
            {t('channels')}
          </Link>
        </div>
      </div>

      {(senders.isError || senders.failureCount > 0) && (
        <Alert tone="danger">{t('loadError')}</Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-5 lg:sticky lg:top-6">
          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xl leading-tight">{t('title')}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {t('cardCaption')}
                </div>
              </div>
              {active > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 font-mono text-[11px] text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  {t('activeCount', { count: active })}
                </span>
              ) : (
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                  {t('notConnected')}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="mb-3 text-[13px] font-semibold">{t('howTitle')}</div>
            <ol className="space-y-4">
              {STEPS.map((k, i) => (
                <li key={k} className="flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-muted font-mono text-xs">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold leading-tight">
                      {t(`how.${k}.title`)}
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      {t(`how.${k}.body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
            <div className="text-[13px] font-semibold text-warning">{t('reportTitle')}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t('reportBody')}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t('reportLabel')}
                </div>
                <code
                  className="block break-all rounded-lg bg-background px-3 py-2 font-mono text-[11.5px]"
                  dir="ltr"
                >
                  {url ?? '…'}
                </code>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="rounded-full"
                disabled={!url}
                onClick={() => void copy()}
              >
                {copied ? t('copied') : t('copy')}
              </Button>
            </div>
          </div>

          <section aria-labelledby="sms-numbers">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="sms-numbers" className="text-lg leading-tight">
                {t('connectedTitle')}
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {t('total', { count: list.length })}
              </span>
            </div>
            {senders.isLoading && senders.failureCount === 0 ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : senders.isLoading ? null : list.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
                {canManage && (
                  <Button className="mt-3 rounded-full" onClick={jumpToForm}>
                    {t('connectFirst')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {list.map((s) => (
                  <SenderCard key={s.id} sender={s} canManage={canManage} />
                ))}
              </div>
            )}
          </section>

          <LookupCard />

          {canManage && <ConnectForm deliveryReportUrl={url} />}

          <section className="space-y-2" aria-labelledby="sms-guide">
            <h2 id="sms-guide" className="text-lg leading-tight">
              {g('title')}
            </h2>
            {GUIDES.map((k) => (
              <details key={k} className="rounded-xl border border-border bg-background">
                <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-semibold hover:bg-muted/50">
                  {g(`${k}.title`)}
                </summary>
                <ul className="list-inside list-disc space-y-1.5 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                  {POINTS.map((p) => (
                    <li key={p}>{g(`${k}.${p}`)}</li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
