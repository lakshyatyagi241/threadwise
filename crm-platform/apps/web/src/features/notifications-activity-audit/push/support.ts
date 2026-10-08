import type { PushSubscriptionInput } from '@crm/contracts';

/**
 * The pure parts of browser notifications (Web Push) on this device: what this browser can do, which of the states the card is in,
 * and the small conversions the browser API needs. No React, no network, and no `window` access except in `readPushEnv`, so every
 * state is tested without a browser.
 */

/** What the card shows. `checking` is only the first render, before the browser has been asked. */
export type PushUiState =
  | 'checking'
  /** The deployment has no push keys: the card does not exist for the person. */
  | 'unconfigured'
  /** This browser has no service workers or no Push API (an old browser, an embedded view, a plain http page). */
  | 'unsupported'
  /** iPhone or iPad Safari outside an installed web app: Apple only delivers web push to a Home Screen app. */
  | 'needs_install'
  /** The person blocked notifications for this site in the browser; only the browser's own settings can undo it. */
  | 'blocked'
  /** Possible, not enabled on this device yet. */
  | 'off'
  /** Enabled on this device. */
  | 'on';

export interface PushEnv {
  /** `navigator.serviceWorker` exists. */
  serviceWorker: boolean;
  /** `PushManager` exists. */
  pushManager: boolean;
  /** `Notification` exists. */
  notification: boolean;
  permission: NotificationPermission | 'unsupported';
  /** A secure context (https or localhost): service workers and push need one. */
  secure: boolean;
  /** iPhone, iPad or iPod (including iPadOS reporting as a Mac with a touch screen). */
  ios: boolean;
  /** Running as an installed web app (Home Screen / standalone window). */
  standalone: boolean;
}

/** What this browser supports, read once on the client. Everything is guarded: a failure means "not supported". */
export function readPushEnv(win: Window & typeof globalThis = window): PushEnv {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  let permission: PushEnv['permission'] = 'unsupported';
  try {
    if (typeof win.Notification !== 'undefined') permission = win.Notification.permission;
  } catch {
    permission = 'unsupported';
  }
  const ua = nav.userAgent ?? '';
  const ios =
    /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  let standalone = nav.standalone === true;
  try {
    standalone = standalone || win.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    /* ignore */
  }
  return {
    serviceWorker: 'serviceWorker' in nav,
    pushManager: typeof (win as { PushManager?: unknown }).PushManager !== 'undefined',
    notification: typeof win.Notification !== 'undefined',
    permission,
    secure: win.isSecureContext === true,
    ios,
    standalone,
  };
}

/**
 * The card's state. `subscribed` is whether THIS browser holds a push subscription the server knows (so "on" is never claimed for a
 * device the server would not push to).
 */
export function pushUiState(input: {
  configured: boolean;
  env: PushEnv | null;
  subscribed: boolean;
}): PushUiState {
  if (!input.configured) return 'unconfigured';
  const env = input.env;
  if (!env) return 'checking';
  const capable = env.serviceWorker && env.pushManager && env.notification && env.secure;
  if (!capable) return env.ios && !env.standalone ? 'needs_install' : 'unsupported';
  if (env.permission === 'denied') return 'blocked';
  if (env.permission === 'granted' && input.subscribed) return 'on';
  return 'off';
}

/** The VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** `PushSubscription` to the request body, or null when the browser did not give both keys. */
export function subscriptionToInput(sub: {
  toJSON(): { endpoint?: string; expirationTime?: number | null; keys?: Record<string, string> };
}): PushSubscriptionInput | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

/** True when the browser's saved subscription was made with this key (a changed deployment key makes it useless). */
export function sameApplicationKey(
  existing: ArrayBuffer | null | undefined,
  publicKey: string,
): boolean {
  if (!existing) return false;
  const wanted = urlBase64ToUint8Array(publicKey);
  const have = new Uint8Array(existing);
  return have.length === wanted.length && have.every((b, i) => b === wanted[i]);
}

/**
 * A link the service worker asked this page to open. Only a path on this site is followed (the worker checks too; the page does not
 * trust a message just because a worker sent it).
 */
export function safeInternalPath(url: unknown, origin: string): string | null {
  if (typeof url !== 'string' || url === '') return null;
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/** The result of "Send a test notification", as the card words it. */
export type TestOutcome = 'sent' | 'none_reachable' | 'no_device';

export function testOutcome(result: { sent: number; failed: number }): TestOutcome {
  if (result.sent > 0) return 'sent';
  if (result.failed > 0) return 'none_reachable';
  return 'no_device';
}

/** Local storage key holding the server's id of this browser's device. */
export const PUSH_DEVICE_KEY = 'crm.push.device';
