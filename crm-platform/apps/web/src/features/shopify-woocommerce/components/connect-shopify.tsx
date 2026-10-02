'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { startShopify, type StoreOverview } from '../api/ecom';
import { BackIcon, SendIcon, ShopifyGlyph } from './ecom-icons';
import { pillLink, primaryButton } from './ui';

/**
 * The Shopify connect page (WD-ECOM-004, 005): setup rail, the store domain form and the guide. A merchant types just the handle;
 * the server normalises it and answers with Shopify's approval address, which the browser follows. The app being off is said
 * plainly instead of showing a form that cannot work.
 */
export function ConnectShopify({ overview }: { overview: StoreOverview }) {
  const t = useTranslations('ecom.connect.shopify');
  const c = useTranslations('ecom.common');
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = overview.appEnabled;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { url } = await startShopify(shop.trim());
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
      setBusy(false);
    }
  };

  const step = (n: number, label: string, active: boolean, done: boolean) => (
    <li
      key={n}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ${active ? 'bg-brand/10 font-semibold text-brand' : done ? '' : 'text-muted-foreground'}`}
    >
      <span
        className={`grid size-5 place-items-center rounded-full font-mono text-[10px] ${done ? 'bg-success/15 text-success' : active ? 'bg-brand text-white' : 'bg-muted text-muted-foreground'}`}
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
            <span className="mb-3 grid size-12 place-items-center rounded-xl bg-[#F1F9EC]">
              <ShopifyGlyph className="size-8" />
            </span>
            <div className="text-[18px] leading-tight">Shopify</div>
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
              {step(1, t('step1'), false, on)}
              {step(2, t('step2'), on, false)}
              {step(3, t('step3'), false, false)}
              {step(4, t('step4'), false, false)}
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
                {c('integrations')} / Shopify
              </div>
              <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
                {t('title')} <span className="italic text-brand">{t('accent')}</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
            </div>
            <Link href="/dashboard" className={pillLink}>
              <BackIcon className="size-3.5" />
              {c('back')}
            </Link>
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          {!on ? (
            <div className="flex items-start gap-5 rounded-2xl border border-border bg-background p-6 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="text-[22px] leading-tight">{t('disabledTitle')}</div>
                <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground">
                  {t('disabledBody')}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_330px]">
              <form
                onSubmit={submit}
                className="space-y-4 rounded-2xl border border-border bg-background p-5 shadow-sm"
              >
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('formStep')}
                  </div>
                  <h2 className="mb-4 mt-0.5 text-[22px] leading-tight">{t('formTitle')}</h2>
                </div>
                <div>
                  <label htmlFor="shop" className="mb-1.5 block text-xs font-semibold">
                    {t('urlLabel')} <span className="text-danger">*</span>
                  </label>
                  <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-background focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
                    <input
                      id="shop"
                      required
                      autoFocus
                      value={shop}
                      onChange={(e) => setShop(e.target.value)}
                      placeholder={t('urlPlaceholder')}
                      className="flex-1 bg-transparent px-3 py-2.5 font-mono text-[13px] outline-none"
                    />
                    <span className="flex items-center border-l border-border bg-muted px-3 font-mono text-[12.5px] text-muted-foreground">
                      {t('urlSuffix')}
                    </span>
                  </div>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">{t('urlHint')}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('webhookLabel')}
                  </div>
                  <div className="break-all font-mono text-[11px]">
                    /v2/shopify/webhook/&#123;webhook_secret&#125;
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Link href="/dashboard" className={pillLink}>
                    {t('cancel')}
                  </Link>
                  <button
                    type="submit"
                    disabled={busy || shop.trim() === ''}
                    className={`${primaryButton} ml-auto`}
                  >
                    <SendIcon className="size-3.5" />
                    {busy ? t('continuing') : t('continue')}
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
                    {[
                      t('guide1'),
                      t('guide2'),
                      t('guide3', { count: overview.eventTopics.length }),
                      t('guide4'),
                    ].map((text, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px]">
                          {i + 1}
                        </span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-2xl border border-success/40 bg-success/5 p-4">
                  <div className="text-[12.5px] font-semibold">{t('scopes')}</div>
                  <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {overview.scopes}
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
