'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadFacebookSdk, type FbSdk } from '@/lib/facebook-sdk';
import { useCatalogLoginConfig } from '../api/catalog';

export type CatalogLoginResult = { kind: 'code'; code: string } | { kind: 'cancelled' };

/**
 * Meta's catalog login popup. The token of WhatsApp Embedded Signup cannot create a catalog (it lacks `catalog_management`), so
 * the catalog has its own login configuration. `required` is true when the operator has set it up; the SDK is loaded as soon as
 * it is, because `FB.login` has to run synchronously inside the click or the browser blocks the popup.
 */
export function useCatalogLogin() {
  const config = useCatalogLoginConfig().data;
  const [fb, setFb] = useState<FbSdk | null>(null);
  const [failed, setFailed] = useState(false);
  const appId = config?.ready ? config.appId : null;
  const version = config?.graphVersion;

  useEffect(() => {
    if (!appId || !version) return;
    let live = true;
    loadFacebookSdk(appId, version).then(
      (sdk) => live && setFb(sdk),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [appId, version]);

  /** Opens the popup. Call it synchronously from the click handler, before any await. */
  const open = useCallback((): Promise<CatalogLoginResult> => {
    const configId = config?.configId;
    return new Promise((resolve) => {
      if (!fb || !configId) return resolve({ kind: 'cancelled' });
      fb.login(
        (res) => {
          const code = res.authResponse?.code;
          resolve(code ? { kind: 'code', code } : { kind: 'cancelled' });
        },
        { config_id: configId, response_type: 'code', override_default_response_type: true },
      );
    });
  }, [fb, config?.configId]);

  return { required: Boolean(config?.ready), ready: Boolean(fb), failed, open };
}
