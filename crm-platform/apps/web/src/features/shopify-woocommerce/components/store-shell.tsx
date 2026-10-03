'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog, cn, useToast } from '@crm/ui';
import type { ShopifyStore, StoreDashboard, WoocommerceStore } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { formatRelative } from '@/features/auth-registration-security/shared/relative-time';
import { ApiError } from '@/lib/api/errors';
import { KEYS, disconnectStore, syncStore } from '../api/ecom';
import { TABS, isHealthy, tabBadge, type Kind, type Tab } from '../lib/model';
import { ShopifyGlyph, SyncIcon, UnplugIcon, WooGlyph } from './ecom-icons';
import { pillLink } from './ui';

const host = (url: string): string => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
};

/**
 * The connected store frame (WD-ECOM-004): status card, the tab rail with counts, the webhook health card, and the page header with
 * "Sync now". Sync queues the import and answers at once; the dashboard is read again a moment later so new rows show.
 */
export function StoreShell({
  kind,
  store,
  tab,
  dashboard,
  planVersion,
  children,
}: {
  kind: Kind;
  store: ShopifyStore | WoocommerceStore;
  tab: Tab;
  dashboard: StoreDashboard | undefined;
  planVersion?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations('ecom.shell');
  const c = useTranslations('ecom.common');
  const locale = useLocale();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const canConnect = useCan('ecom.connect');
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [now] = useState(() => new Date().getTime());
  const name = store.storeName || (kind === 'woocommerce' ? host(store.storeUrl) : store.storeUrl);
  const last = dashboard?.recentLogs[0];
  const tabLabel = (id: Tab) =>
    kind === 'woocommerce' && id === 'offers' ? t('offersWoo') : t(`tabs.${id}`);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await syncStore(kind, store.id);
      if (res.ok) {
        toast(t('syncQueued'), 'success');
        await qc.invalidateQueries({ queryKey: KEYS.all });
        // The import runs in the background; read again shortly so what it brought in shows up.
        window.setTimeout(() => void qc.invalidateQueries({ queryKey: KEYS.all }), 6000);
      } else {
        toast(res.message ?? t('syncFailed'), 'danger');
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('syncFailed'), 'danger');
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectStore(kind, store.id);
      toast(t('disconnectDone'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
      router.replace(`/${kind}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('syncFailed'), 'danger');
    } finally {
      setDisconnecting(false);
      setConfirming(false);
    }
  };

  const Glyph = kind === 'shopify' ? ShopifyGlyph : WooGlyph;
  const status =
    store.status === 'active'
      ? t('status.active')
      : store.status === 'error'
        ? t('status.error')
        : t('status.other', { status: store.status });

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-xl',
                  kind === 'shopify' ? 'bg-[#F1F9EC]' : 'bg-[#F3EEF9]',
                )}
              >
                <Glyph className="size-7" />
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-mono text-[10px] text-success">
                <span className="size-1.5 rounded-full bg-success" />
                {status}
              </span>
            </div>
            <div className="mt-3 text-[18px] leading-tight">{name}</div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
              {kind === 'woocommerce' ? `${host(store.storeUrl)} · WooCommerce` : store.storeUrl}
            </div>
            {planVersion && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                {kind === 'shopify' ? `${t('plan')} ` : 'WC v'}
                <span className="font-medium text-foreground">{planVersion}</span>
              </div>
            )}
          </div>

          <nav
            className="rounded-2xl border border-border bg-background p-2 shadow-sm"
            aria-label={t('store')}
          >
            <div className="px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('store')}
            </div>
            {TABS.map((id) => {
              const badge = dashboard ? tabBadge(id, dashboard) : null;
              return (
                <Link
                  key={id}
                  href={`/${kind}?tab=${id}`}
                  aria-current={id === tab ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between rounded-lg px-3 py-2 text-[13px] transition hover:bg-muted',
                    id === tab && 'bg-brand/10 font-semibold text-brand',
                  )}
                >
                  <span>{tabLabel(id)}</span>
                  {badge !== null && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {badge.toLocaleString(locale)}
                    </span>
                  )}
                </Link>
              );
            })}
            <div className="px-3 pb-1.5 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('related')}
            </div>
            <Link
              href="/dashboard"
              className="flex items-center rounded-lg px-3 py-2 text-[13px] hover:bg-muted"
            >
              {t('allIntegrations')}
            </Link>
            {canConnect && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-danger hover:bg-danger/10"
              >
                <UnplugIcon className="size-3.5" />
                {t('disconnect')}
              </button>
            )}
          </nav>

          <div className="rounded-2xl border border-border bg-background p-4 text-xs shadow-sm">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <span
                className={cn(
                  'size-2 rounded-full',
                  dashboard && isHealthy(dashboard.recentLogs, now) ? 'bg-success' : 'bg-border',
                )}
              />
              {dashboard && isHealthy(dashboard.recentLogs, now) ? t('healthy') : t('noRecent')}
            </div>
            <div className="leading-relaxed text-muted-foreground">
              {last ? (
                <>
                  {t('lastEvent')}{' '}
                  <span className="font-mono text-foreground">{last.eventType}</span> ·{' '}
                  {formatRelative(last.createdAt, now, locale)}
                </>
              ) : kind === 'shopify' ? (
                t('triggerShopify')
              ) : (
                t('triggerWoo')
              )}
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {c('integrations')} / {kind === 'shopify' ? 'Shopify' : 'WooCommerce'} /{' '}
                {tabLabel(tab)}
              </div>
              <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
                {name} <span className="italic text-brand">{tabLabel(tab).toLowerCase()}</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {t(`desc.${kind}.${tab}`)}
              </p>
            </div>
            {canConnect && (
              <button
                type="button"
                onClick={() => void sync()}
                disabled={syncing}
                className={pillLink}
              >
                <SyncIcon className="size-3.5" />
                {syncing ? t('syncing') : t('sync')}
              </button>
            )}
          </div>
          {children}
        </section>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t('disconnectTitle', { name })}
        message={kind === 'shopify' ? t('disconnectShopify') : t('disconnectWoo')}
        confirmLabel={t('disconnect')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={disconnecting}
        onConfirm={() => void disconnect()}
        onClose={() => setConfirming(false)}
      />
    </main>
  );
}
