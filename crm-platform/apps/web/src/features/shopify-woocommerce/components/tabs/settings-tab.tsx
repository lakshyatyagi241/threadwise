'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import type { ShopifyStore, WoocommerceStore } from '@crm/contracts';
import { formatRelative } from '@/features/auth-registration-security/shared/relative-time';
import type { Kind } from '../../lib/model';
import { Panel } from '../ui';

/** The settings tab (WD-ECOM-024): the connection's facts, the webhook address and how many webhooks are registered. */
export function SettingsTab({
  kind,
  store,
}: {
  kind: Kind;
  store: ShopifyStore | WoocommerceStore;
}) {
  const t = useTranslations('ecom.settings');
  const locale = useLocale();
  const { toast } = useToast();
  const [now] = useState(() => new Date().getTime());
  const count = Object.keys(store.webhookIds).length;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const rows: Array<[string, string]> = [
    [t('storeUrl'), store.storeUrl],
    [t('connectedAt'), when(store.connectedAt)],
    [
      t('lastVerified'),
      store.lastVerifiedAt ? formatRelative(store.lastVerifiedAt, now, locale) : '—',
    ],
    kind === 'shopify'
      ? [t('scopes'), ('scopes' in store && store.scopes) || '—']
      : [t('wooVersion'), ('storeVersion' in store && store.storeVersion) || '—'],
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(store.webhookUrl);
      toast(t('copied'), 'success');
    } catch {
      /* the address stays visible to select by hand */
    }
  };

  return (
    <Panel>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-1 break-words text-[13px]">{value}</dd>
          </div>
        ))}
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('webhookUrl')}
          </dt>
          <dd className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 font-mono text-[11px]">
              {store.webhookUrl}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              {t('copy')}
            </button>
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('registered')}
          </dt>
          <dd className="mt-1 text-[13px]">{t('registeredCount', { count })}</dd>
        </div>
      </dl>
    </Panel>
  );
}
