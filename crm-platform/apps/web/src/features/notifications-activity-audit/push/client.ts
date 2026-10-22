import type { PushSubscriptionInput } from '@crm/contracts';
import {
  PUSH_ASKED_KEY,
  PUSH_DEVICE_KEY,
  sameApplicationKey,
  subscriptionToInput,
  urlBase64ToUint8Array,
} from './support';

/**
 * The browser side of Web Push for this device: register the service worker, ask for permission, subscribe, unsubscribe. Every call
 * may reject (the browser can refuse at any step); callers turn a rejection into the card's "something went wrong" line.
 *
 * Permission is requested ONLY inside `enableOnThisDevice`, which the Enable click and the arrival prompt call. Nothing else here runs on
 * page load except silent reads that never ask for anything.
 */

const WORKER = '/sw.js';

/** The id the server gave this browser's device, remembered so the list can say "this device" (the list never carries an endpoint). */
export function savedDeviceId(): string | null {
  try {
    return window.localStorage.getItem(PUSH_DEVICE_KEY);
  } catch {
    return null;
  }
}

export function saveDeviceId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(PUSH_DEVICE_KEY, id);
    else window.localStorage.removeItem(PUSH_DEVICE_KEY);
  } catch {
    /* blocked storage: the device still works, it just is not labelled "this device" */
  }
}

/** Whether the automatic permission ask already ran in this browser tab session (the arrival prompt; see its comment). */
export function askedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(PUSH_ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberAskedThisSession(): void {
  try {
    window.sessionStorage.setItem(PUSH_ASKED_KEY, '1');
  } catch {
    /* blocked storage: the banner still asks, the browser decides whether to show its prompt again */
  }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register(WORKER, { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** This browser's push subscription, or null. Never asks for permission and never registers the worker. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export class PermissionNotGranted extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(`Notification permission: ${permission}`);
    this.name = 'PermissionNotGranted';
  }
}

/** Subscribes (or reuses the subscription when it was made with this key). Needs permission already granted. */
export async function subscribeNow(publicKey: string): Promise<PushSubscriptionInput> {
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameApplicationKey(sub.options?.applicationServerKey, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const input = subscriptionToInput(sub);
  if (!input) throw new Error('The browser gave no subscription keys.');
  return input;
}

/** Asks the browser for permission (call from a click handler only), then subscribes with the deployment's key. */
export async function enableOnThisDevice(publicKey: string): Promise<PushSubscriptionInput> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PermissionNotGranted(permission);
  return subscribeNow(publicKey);
}

/** Drops this browser's subscription (the push service forgets it too). */
export async function disableOnThisDevice(): Promise<void> {
  const sub = await currentSubscription();
  await sub?.unsubscribe();
}
