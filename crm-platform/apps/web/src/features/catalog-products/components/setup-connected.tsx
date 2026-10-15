'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, cn, useToast } from '@crm/ui';
import type { CatalogOverview, CatalogSummary } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { disconnectCatalog, KEYS, syncProducts } from '../api/catalog';
import { bucket, providerLabel, truncate } from '../lib/format';
import { showHealth } from '../lib/health';
import { waiting, type SyncCounts } from '../lib/sync-model';
import { ManageCatalogPanel } from './catalog-manage';
import { HealthCard } from './health-card';
import { CARD, KICKER, ProductThumb, SyncPill, TEXT_LINK, TH } from './parts';
import { AutomationForm, CommerceForm } from './settings-forms';
import { SyncPanel } from './sync-panel';
import { useErrorText } from './use-error-text';

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className={KICKER}>{label}</div>
      <div className={cn('mt-2 font-serif text-[28px] leading-none tabular-nums', tone)}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

/** One row of the products table with its own "Sync" link: pushes just that product. */
function SyncOne({ id, canManage }: { id: string; canManage: boolean }) {
  const t = useTranslations('catalogProducts.setup.table');
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | 'skipped' | 'failed'>('idle');
  if (!canManage) return null;
  const run = async () => {
    setState('busy');
    try {
      const res = await syncProducts({ productIds: [id] });
      setState(res.pushed > 0 ? 'queued' : 'skipped');
      void qc.invalidateQueries({ queryKey: KEYS.overview });
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 1500);
  };
  return (
    <button
      type="button"
      disabled={state === 'busy'}
      onClick={() => void run()}
      className={cn(TEXT_LINK, 'text-[11px]')}
    >
      {state === 'busy' ? '…' : t(`sync.${state}`)}
    </button>
  );
}

/** The most recently updated products with their Meta status. */
function ProductsTable({
  products,
  canManage,
}: {
  products: CatalogOverview['products'];
  canManage: boolean;
}) {
  const t = useTranslations('catalogProducts.setup.table');
  return (
    <section className={cn(CARD, 'overflow-hidden')}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h3 className="font-serif text-[18px] font-normal leading-tight">{t('title')}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t.rich('hint', { b: (chunks) => <b>{chunks}</b> })}
          </p>
        </div>
        <Link href="/store/products" className={cn(TEXT_LINK, 'text-[11.5px]')}>
          {t('manage')}
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="border-b border-border bg-muted text-muted-foreground">
            <tr>
              <th className={cn(TH, 'px-5')}>{t('product')}</th>
              <th className={TH}>{t('sku')}</th>
              <th className={cn(TH, 'text-end')}>{t('price')}</th>
              <th className={TH}>{t('availability')}</th>
              <th className={TH}>{t('metaStatus')}</th>
              <th className={cn(TH, 'px-5')}>
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  {t('empty')}{' '}
                  <Link href="/store/products/create" className={TEXT_LINK}>
                    {t('addOne')}
                  </Link>
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ProductThumb url={p.imageUrl} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name}</div>
                        {p.category ? (
                          <div className="font-mono text-[10.5px] text-muted-foreground">
                            {p.category}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3 font-mono text-[11px]">{p.sku || '—'}</td>
                  <td className="px-2 py-3 text-end font-semibold tabular-nums">
                    {p.priceDisplay}
                  </td>
                  <td className="px-2 py-3 text-[11.5px]">{p.effectiveAvailability}</td>
                  <td className="px-2 py-3">
                    <SyncPill status={p.metaSyncStatus} />
                    {p.metaLastError ? (
                      <div
                        className="mt-1 max-w-[200px] truncate text-[10px] text-danger"
                        title={p.metaLastError}
                      >
                        {truncate(p.metaLastError, 60)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-end">
                    <SyncOne id={p.id} canManage={canManage} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A Meta catalog is linked: the header card, the counters, health, sync, the two settings forms and the products table. */
export function ConnectedView({
  overview,
  catalog,
}: {
  overview: CatalogOverview;
  catalog: CatalogSummary;
}) {
  const t = useTranslations('catalogProducts.setup');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('cat.catalog.manage');
  const [live, setLive] = useState<SyncCounts | null>(null);
  const [askDisconnect, setAskDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const counts: SyncCounts = live ?? {
    synced: bucket(overview.statusBuckets, 'synced'),
    pending: bucket(overview.statusBuckets, 'pending'),
    failed: bucket(overview.statusBuckets, 'failed'),
  };

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: KEYS.all });
    setLive(null);
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectCatalog();
      toast(t('disconnected'), 'success');
      setAskDisconnect(false);
      await refresh();
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand p-5 text-brand-foreground shadow-sm">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
            {t('header.connected', { provider: providerLabel(catalog.provider) })}
          </div>
          <h2 className="mt-1 font-serif text-[22px] font-normal leading-tight">
            {catalog.catalogName || t('header.defaultName')}
          </h2>
          <div className="mt-1 font-mono text-[11px] opacity-80">ID {catalog.catalogId}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/catalog/send"
            className="inline-flex items-center rounded-full border border-brand-foreground/30 bg-brand-foreground/10 px-3 py-2 text-[11.5px] font-medium outline-none hover:bg-brand-foreground/20 focus-visible:ring-2 focus-visible:ring-brand-foreground"
          >
            {t('header.sendProducts')}
          </Link>
          {canManage && (
            <Button
              variant="ghost"
              className="rounded-full border border-brand-foreground/30 px-3 text-[11.5px] font-normal hover:bg-brand-foreground/10 hover:text-brand-foreground"
              onClick={() => setAskDisconnect(true)}
            >
              {t('header.disconnect')}
            </Button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={t('tiles.total')} value={overview.totalProducts} />
        <Tile label={t('tiles.synced')} value={counts.synced} tone="text-success" />
        <Tile label={t('tiles.pending')} value={counts.pending} tone="text-warning" />
        <Tile label={t('tiles.failed')} value={counts.failed} tone="text-danger" />
      </div>

      {showHealth(overview.health) && (
        <HealthCard health={overview.health} score={overview.health.score} />
      )}

      <SyncPanel
        waiting={waiting(overview.statusBuckets)}
        canManage={canManage}
        onCounts={setLive}
        onChanged={() => void refresh()}
      />

      <CommerceForm key={`c-${catalog.rowVersion}`} catalog={catalog} canManage={canManage} />
      <AutomationForm key={`a-${catalog.rowVersion}`} catalog={catalog} canManage={canManage} />

      <ProductsTable products={overview.products} canManage={canManage} />

      {canManage && <ManageCatalogPanel key={`m-${catalog.rowVersion}`} catalog={catalog} />}

      <ConfirmDialog
        open={askDisconnect}
        title={t('disconnectTitle')}
        message={t('disconnectConfirm')}
        confirmLabel={t('header.disconnect')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={disconnecting}
        onConfirm={() => void disconnect()}
        onClose={() => setAskDisconnect(false)}
      />
    </>
  );
}
