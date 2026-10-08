'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from '@crm/ui';
import {
  shopifyEmbeddedConfigSchema,
  shopifyEmbeddedStatusSchema,
  type ShopifyEmbeddedStatus,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

/** Shopify's App Bridge script: it adds `window.shopify`, which hands out the session token. */
const APP_BRIDGE = 'https://cdn.shopify.com/shopifycloud/app-bridge.js';

type ShopifyGlobal = { idToken: () => Promise<string> };
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; status: ShopifyEmbeddedStatus }
  | { kind: 'invalid' }
  | { kind: 'off' }
  | { kind: 'error' };

function loadAppBridge(clientId: string): Promise<ShopifyGlobal> {
  return new Promise((resolve, reject) => {
    const meta = document.createElement('meta');
    meta.name = 'shopify-api-key';
    meta.content = clientId;
    document.head.appendChild(meta);
    const script = document.createElement('script');
    script.src = APP_BRIDGE;
    script.onload = () => {
      const g = (window as unknown as { shopify?: ShopifyGlobal }).shopify;
      if (g) resolve(g);
      else reject(new Error('App Bridge did not start'));
    };
    script.onerror = () => reject(new Error('App Bridge did not load'));
    document.head.appendChild(script);
  });
}

/**
 * The `/shopify` screen as Shopify's admin shows it (WD-ECOM-038): only the connection state of the store, read with the App Bridge
 * session token. No menu, and no sign-in: it is read-only. Connecting or changing the store happens in the full app, opened in its
 * own tab (a sign-in form does not belong inside an iframe).
 */
export function EmbeddedShopify() {
  const t = useTranslations('ecom.embedded');
  const search = useSearchParams();
  const shop = search.get('shop') ?? '';
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    const set = (s: State) => live && setState(s);
    (async () => {
      const cfg = await apiFetch('/shopify/embedded/config', {
        schema: shopifyEmbeddedConfigSchema,
      });
      if (!cfg.appEnabled || !cfg.clientId) return set({ kind: 'off' });
      const bridge = await loadAppBridge(cfg.clientId);
      const sessionToken = await bridge.idToken();
      const status = await apiFetch('/shopify/embedded/session', {
        method: 'POST',
        body: { sessionToken, shop },
        schema: shopifyEmbeddedStatusSchema,
      });
      set({ kind: 'ready', status });
    })().catch((e: unknown) => {
      if (e instanceof ApiError && e.code === 'ECOM_SESSION_TOKEN_INVALID')
        set({ kind: 'invalid' });
      else if (e instanceof ApiError && e.code === 'ECOM_NOT_CONFIGURED') set({ kind: 'off' });
      else set({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [shop]);

  return (
    <main className="mx-auto max-w-xl px-4 py-8" data-testid="shopify-embedded">
      <h1 className="mb-4 text-lg font-semibold">{t('title')}</h1>
      {state.kind === 'loading' && (
        <div className="grid min-h-[20vh] place-items-center">
          <Spinner />
        </div>
      )}
      {state.kind === 'invalid' && <Alert tone="danger">{t('invalid')}</Alert>}
      {state.kind === 'off' && <Alert tone="warning">{t('off')}</Alert>}
      {state.kind === 'error' && <Alert tone="danger">{t('error')}</Alert>}
      {state.kind === 'ready' && (
        <section className="space-y-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{state.status.shop}</p>
          <p className="font-medium" data-testid="embedded-state">
            {state.status.connected ? t('connected') : t('notConnected')}
          </p>
          <p className="text-sm">{state.status.message}</p>
          {state.status.store && (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">{t('store')}</dt>
              <dd>{state.status.store.storeName ?? state.status.shop}</dd>
              <dt className="text-muted-foreground">{t('plan')}</dt>
              <dd>{state.status.store.shopPlan ?? '-'}</dd>
              <dt className="text-muted-foreground">{t('lastVerified')}</dt>
              <dd>
                {state.status.store.lastVerifiedAt
                  ? new Date(state.status.store.lastVerifiedAt).toLocaleString()
                  : '-'}
              </dd>
            </dl>
          )}
          <a
            className="inline-block text-sm font-medium underline"
            href="/shopify"
            target="_blank"
            rel="noopener noreferrer"
          >
            {state.status.connected ? t('openApp') : t('openToConnect')}
          </a>
        </section>
      )}
    </main>
  );
}
