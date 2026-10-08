'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { notificationsApi } from '../api/service';
import { saveDeviceId, savedDeviceId, subscribeNow } from './client';
import { safeInternalPath } from './support';

/**
 * What the service worker may ask of an open tab (BL-097):
 *  - `crm-push-open`: a notification was clicked and the worker could not move an existing tab itself (a tab it does not control), so
 *    this page goes to the link (a path on this site only; the page checks again, it does not trust a message because a worker sent it);
 *  - `crm-push-resubscribe`: the browser rotated or dropped the push subscription, so this device, if it was enabled, subscribes again
 *    and tells the server (the worker cannot: it has no session).
 *
 * Mounted once for the signed-in app. Does nothing in a browser without service workers, and never asks for permission.
 */
export function usePushWorkerMessages(): void {
  const router = useRouter();
  const latest = useRef(router);
  useEffect(() => {
    latest.current = router;
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === 'crm-push-open') {
        const path = safeInternalPath(data.url, window.location.origin);
        if (path) latest.current.push(path);
      } else if (data?.type === 'crm-push-resubscribe') {
        void resubscribe();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
}

/** Only for a device that was enabled here before (a saved device id) and still has the browser's permission. */
async function resubscribe(): Promise<void> {
  const previous = savedDeviceId();
  if (!previous || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }
  try {
    const key = await notificationsApi.pushPublicKey();
    if (!key.enabled || !key.publicKey) return;
    const device = await notificationsApi.addPushDevice(await subscribeNow(key.publicKey));
    saveDeviceId(device.id);
    if (device.id !== previous)
      await notificationsApi.removePushDevice(previous).catch(() => undefined);
  } catch {
    /* the next visit to Account, Notifications shows the device as off and offers Enable */
  }
}
