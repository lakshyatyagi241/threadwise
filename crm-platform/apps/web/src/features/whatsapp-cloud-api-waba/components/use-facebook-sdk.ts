'use client';

import { useEffect, useState } from 'react';
import type { WabaReadiness } from '@crm/contracts';
import { loadFacebookSdk, type FbSdk } from '../lib/facebook-sdk';

/**
 * Loads and initialises the Meta SDK as soon as the page knows Embedded Signup is ready, not on click: `FB.login` has to run
 * synchronously inside the click or mobile browsers block the popup (WD-WABA-005).
 */
export function useFacebookSdk(readiness: WabaReadiness | undefined): {
  fb: FbSdk | null;
  failed: boolean;
} {
  const [fb, setFb] = useState<FbSdk | null>(null);
  const [failed, setFailed] = useState(false);
  const appId = readiness?.embeddedSignupReady ? readiness.appId : null;
  const version = readiness?.graphVersion;

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

  return { fb, failed };
}
