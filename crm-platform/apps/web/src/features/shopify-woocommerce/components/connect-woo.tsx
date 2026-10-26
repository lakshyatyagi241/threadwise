'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';
import { KEYS, connectWoo, testWoo, type StoreOverview } from '../api/ecom';
import { BackIcon, SendIcon, WooGlyph } from './ecom-icons';
import { ResultLine, pillLink, primaryButton } from './ui';

const field =
  'w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[13px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10';

/**
 * The WooCommerce connect page (TW-ECOM-025, 026): store address and REST keys, a "Test connection" that saves nothing and a
 * "Connect store" that verifies, saves and registers the webhooks. Failures show inline with the reason the store gave.
 */
export function ConnectWoo({ overview }: { overview: StoreOverview }) {
  const t = useTranslations('ecom.connect.woocommerce');
  const c = useTranslations('ecom.common');
  const qc = useQueryClient();
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [busy, setBusy] = useState<'test' | 'connect' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const on = overview.appEnabled;
  const body = { storeUrl, consumerKey, consumerSecret };

  const run = async (kind: 'test' | 'connect') => {
    setBusy(kind);
    setResult({ ok: true, message: kind === 'test' ? t('testing') : t('connecting') });
    try {
      if (kind === 'test') {
        setResult(await testWoo(body));
      } else {
        await connectWoo(body);
        await qc.invalidateQueries({ queryKey: KEYS.all });
        setResult({ ok: true, message: t('connected') });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : t('failed') });
    } finally {
      setBusy(null);
    }
  };

  const filled =
    storeUrl.trim() !== '' && consumerKey.trim() !== '' && consumerSecret.trim() !== '';
  const step = (n: number, label: string, done = false) => (
    <li
      key={n}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] text-muted-foreground"
    >
      <span
        className={`grid size-5 place-items-center rounded-full font-mono text-[10px] ${done ? 'bg-success/15 text-success' : 'bg-muted'}`}
      >
        {done ? '✓' : n}
      </span>
      {label}
    </li>
  );

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
            <span className="mb-3 grid size-12 place-items-center rounded-xl bg-[#F3EEF9]">
              <WooGlyph className="size-8" />
            </span>
            <div className="text-[18px] leading-tight">WooCommerce</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {c('integration')}
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-1 font-mono text-[10px]">
              <span className="size-1.5 rounded-full bg-border" />
              {c('notConnected')}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-2 shadow-sm">
            <div className="px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {c('setupSteps')}
            </div>
            <ol className="space-y-0.5 px-1">
              {step(1, t('step1'), on)}
              {step(2, t('step2'))}
              {step(3, t('step3'))}
              {step(4, t('step4'))}
            </ol>
          </div>
          <div className="rounded-2xl border border-success/30 bg-success/5 p-4 text-xs leading-relaxed">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <span className="size-2 rounded-full bg-success" />
              {c('needHelp')}
            </div>
            {t('help')}{' '}
            <Link href="/support" className="font-semibold text-brand underline">
              {c('support')}
            </Link>
            .
          </div>
        </aside>

        <section className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {c('integrations')} / WooCommerce
              </div>
              <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
                {t('title')} <span className="not-italic text-[#7F54B3]">{t('accent')}</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
            </div>
            <Link href="/dashboard" className={pillLink}>
              <BackIcon className="size-3.5" />
              {c('back')}
            </Link>
          </div>

          {!on ? (
            <div className="rounded-2xl border border-border bg-background p-6 shadow-sm">
              <div className="text-[22px] leading-tight">{t('disabledTitle')}</div>
              <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground">{t('disabledBody')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_330px]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('connect');
                }}
                className="space-y-4 rounded-2xl border border-border bg-background p-5 shadow-sm"
              >
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('formStep')}
                  </div>
                  <h2 className="mb-4 mt-0.5 text-[22px] leading-tight">{t('formTitle')}</h2>
                </div>
                <div>
                  <label htmlFor="wc-url" className="mb-1.5 block text-xs font-semibold">
                    {t('urlLabel')} <span className="text-danger">*</span>
                  </label>
                  <input
                    id="wc-url"
                    type="url"
                    required
                    value={storeUrl}
                    onChange={(e) => setStoreUrl(e.target.value)}
                    placeholder="https://your-store.com"
                    className={field}
                  />
                  <p className="mt-1 text-[10.5px] text-muted-foreground">{t('urlHint')}</p>
                </div>
                <div>
                  <label htmlFor="wc-key" className="mb-1.5 block text-xs font-semibold">
                    {t('keyLabel')} <span className="text-danger">*</span>
                  </label>
                  <input
                    id="wc-key"
                    required
                    value={consumerKey}
                    onChange={(e) => setConsumerKey(e.target.value)}
                    placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    autoComplete="off"
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="wc-secret" className="mb-1.5 block text-xs font-semibold">
                    {t('secretLabel')} <span className="text-danger">*</span>
                  </label>
                  <input
                    id="wc-secret"
                    type="password"
                    required
                    value={consumerSecret}
                    onChange={(e) => setConsumerSecret(e.target.value)}
                    placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    autoComplete="off"
                    className={field}
                  />
                  <p className="mt-1 text-[10.5px] text-muted-foreground">{t('secretHint')}</p>
                </div>
                {result && <ResultLine ok={result.ok}>{result.message}</ResultLine>}
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('webhookLabel')}
                  </div>
                  <div className="break-all font-mono text-[11px]">
                    /v2/woocommerce/webhook/&#123;secret&#125;
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    disabled={busy !== null || !filled}
                    onClick={() => void run('test')}
                    className={pillLink}
                  >
                    {t('test')}
                  </button>
                  <button
                    type="submit"
                    disabled={busy !== null || !filled}
                    className={`${primaryButton} ms-auto`}
                  >
                    <SendIcon className="size-3.5" />
                    {t('connect')}
                  </button>
                </div>
              </form>

              <aside className="space-y-4">
                <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('guideKicker')}
                  </div>
                  <h3 className="mb-3 mt-0.5 text-[18px] leading-tight">{t('guideTitle')}</h3>
                  <ol className="space-y-3 text-[12.5px]">
                    {[t('g1'), t('g2'), t('g3'), t('g4'), t('g5')].map((text, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px]">
                          {i + 1}
                        </span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
                  <div className="text-[12.5px] font-semibold">{t('httpsTitle')}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t('httpsBody')}
                  </p>
                </div>
              </aside>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
