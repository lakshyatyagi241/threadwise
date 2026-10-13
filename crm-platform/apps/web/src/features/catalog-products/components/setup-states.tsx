'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, useToast } from '@crm/ui';
import type { CatalogOverview } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { autodetectCatalog, KEYS } from '../api/catalog';
import { isOfficialEngine, senderPhone, workspaceEngine } from '../lib/senders';
import { ConnectForm } from './connect-form';
import { ArrowRightIcon, ChatIcon, PhoneIcon } from './icons';
import { CARD, DotPill, KICKER, PILL_LINK, TEXT_LINK } from './parts';
import { useErrorText } from './use-error-text';

/** The "Optional · advanced" panel holding the manual connect form. */
function AdvancedPanel({ title, open }: { title: string; open?: boolean }) {
  const t = useTranslations('catalogProducts.setup');
  return (
    <details className={`${CARD} group`} open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <div>
          <div className={KICKER}>{t('advanced.kicker')}</div>
          <div className="mt-0.5 font-serif text-[18px] leading-tight">{title}</div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">{t('advanced.intro')}</div>
        </div>
        <span
          aria-hidden="true"
          className="shrink-0 text-lg text-muted-foreground transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-border px-5 pb-5">
        <ConnectForm compact />
      </div>
    </details>
  );
}

/** No catalog and no connected sender: catalog sending needs a device first. */
export function NoSenderCard() {
  const t = useTranslations('catalogProducts.setup');
  const canManage = useCan('cat.catalog.manage');
  return (
    <>
      <div className={`${CARD} flex items-start gap-5 p-6`}>
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
          <ChatIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[22px] leading-tight">{t('noSender.title')}</div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">{t('noSender.message')}</p>
          <Link href="/channels/whatsapp" className={`${PILL_LINK} mt-4`}>
            {t('noSender.connect')}
            <ArrowRightIcon className="size-3 rtl:rotate-180" />
          </Link>
        </div>
      </div>
      {canManage && <AdvancedPanel title={t('advanced.titleManual')} />}
    </>
  );
}

/** A catalog is not linked but a sender is connected: ready to send, with the way to link one. */
export function ReadyView({ overview }: { overview: CatalogOverview }) {
  const t = useTranslations('catalogProducts.setup');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('cat.catalog.manage');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engine = workspaceEngine(overview.senders);
  const official = isOfficialEngine(engine);
  const count = overview.senders.length;

  const autodetect = async () => {
    setBusy(true);
    setError(null);
    try {
      await autodetectCatalog();
      toast(t('autodetect.linked'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const tile = (label: string, value: number, href: string, cta: string) => (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className={KICKER}>{label}</div>
      <div className="mt-2 font-serif text-[28px] leading-none tabular-nums">
        {value.toLocaleString()}
      </div>
      <Link href={href} className={`${TEXT_LINK} mt-1 inline-block text-[10.5px]`}>
        {cta}
      </Link>
    </div>
  );

  return (
    <>
      <section
        aria-labelledby="cat-ready-title"
        className="flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-brand p-6 text-brand-foreground shadow-sm"
      >
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
            {t('ready.kicker')}
          </div>
          <h2
            id="cat-ready-title"
            className="mt-1 font-serif text-[24px] font-normal leading-tight"
          >
            {official ? t('ready.officialTitle') : t('ready.unofficialTitle')}
          </h2>
          <p className="mt-2 max-w-2xl text-[12.5px] opacity-80">
            {official
              ? t('ready.officialBody', { count, engine: engine.toUpperCase() })
              : t('ready.unofficialBody', { count })}{' '}
            {t.rich('ready.head', { b: (chunks) => <b>{chunks}</b> })}
          </p>
        </div>
        <Link
          href="/catalog/send"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-background px-5 py-2.5 text-[12.5px] font-semibold text-brand outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
        >
          {t('ready.openSend')}
          <ArrowRightIcon className="size-3 rtl:rotate-180" />
        </Link>
      </section>

      <section className={`${CARD} p-5`}>
        <div className={`${KICKER} mb-3`}>{t('senders.title')}</div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {overview.senders.map((s) => (
            <li key={s.key} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/10 text-success">
                <PhoneIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{s.label}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {senderPhone(s) || t('senders.noNumber')}
                </div>
              </div>
              <DotPill on className="shrink-0 px-2 py-0.5 text-[10px]">
                {t('senders.connected')}
              </DotPill>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {tile(t('tiles.products'), overview.totalProducts, '/store/products', t('manage'))}
        {tile(t('tiles.shops'), overview.shops.length, '/store', t('manage'))}
        {tile(t('tiles.recentSends'), overview.recentSends.length, '/catalog/activity', t('view'))}
      </div>

      {canManage && engine === 'waba' && (
        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
              <PhoneIcon className="size-6" />
            </span>
            <div className="min-w-[200px] flex-1">
              <h3 className="font-serif text-[18px] font-normal leading-tight">
                {t('autodetect.title')}
              </h3>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{t('autodetect.intro')}</p>
              {error ? (
                <p role="alert" className="mt-2 text-[11.5px] text-danger">
                  {error}
                </p>
              ) : null}
            </div>
            <Button
              variant="brand"
              className="shrink-0 rounded-full px-5"
              disabled={busy}
              onClick={() => void autodetect()}
            >
              {busy ? <Spinner /> : null}
              {t('autodetect.button')}
              <ArrowRightIcon className="size-3 rtl:rotate-180" />
            </Button>
          </div>
        </section>
      )}

      {canManage && (
        <AdvancedPanel
          open={error !== null}
          title={official ? t('advanced.titleManual') : t('advanced.titleAlso')}
        />
      )}
    </>
  );
}
