import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Browser notifications (Web Push, BL-097, docs/specs/realtime-notifications.md section 18): an OS-level notification for the events a
 * person already gets bell rows for, on the devices where they allowed it, even with the CRM closed.
 *
 * A device is one browser profile's push subscription. The subscription's endpoint and keys are SECRETS (whoever holds them can push to
 * that browser), so they travel exactly once, from the browser to `POST /v2/notifications/push/subscriptions`, and no response ever
 * carries them: the device list is `id`, a human `label`, `createdAt` and `lastUsedAt` only.
 */

/** Most devices one person keeps. A new one past the cap drops the least recently used. */
export const PUSH_MAX_DEVICES_PER_USER = 10;

/**
 * `GET /v2/notifications/push/public-key`. `enabled: false` (and `publicKey: null`) when the deployment has no VAPID keys: the feature is
 * invisible and the web app shows nothing. A 200 either way, so a browser console is not filled with 404s on every page.
 */
export const pushPublicKeyResponseSchema = z.object({
  enabled: z.boolean(),
  /** The VAPID application server key, base64url, for `pushManager.subscribe({ applicationServerKey })`. */
  publicKey: z.string().min(1).nullable(),
});
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>;

/**
 * `POST /v2/notifications/push/subscriptions`: the shape of `PushSubscription.toJSON()`. Idempotent per (person, endpoint): the same
 * browser subscribing again refreshes its keys and returns the same device. The endpoint must be https (push services are).
 */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((v) => v.startsWith('https://'), { message: 'Push endpoints are https' }),
  expirationTime: z.number().nullish(),
  keys: z.object({
    p256dh: z
      .string()
      .min(16)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+={0,2}$/),
    auth: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+={0,2}$/),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

/** One of the caller's devices. Never the endpoint, never the keys. */
export const pushDeviceSchema = z.object({
  id: uuidSchema,
  /** "Chrome on Windows", worked out from the browser's user agent when it subscribed. */
  label: z.string(),
  createdAt: z.string().datetime(),
  /** The last time the push service accepted a push to this device; null = never. */
  lastUsedAt: z.string().datetime().nullable(),
});
export type PushDevice = z.infer<typeof pushDeviceSchema>;

export const pushDeviceListResponseSchema = z.object({ items: z.array(pushDeviceSchema) });
export type PushDeviceListResponse = z.infer<typeof pushDeviceListResponseSchema>;

/**
 * `POST /v2/notifications/push/test`: which channels the test went through. It writes a real `test` bell row for the caller and announces it
 * live (`inApp`), and sends a Web Push to the caller's devices (`sent` / `failed`), so one press exercises every way a person is told.
 */
export const pushTestResponseSchema = z.object({
  /**
   * A bell row was written and announced over the live socket (the bell number, the toast and the tab title follow). False when the person
   * turned the bell off for the test type, or the workspace owner did.
   */
  inApp: z.boolean(),
  /** Devices the push service accepted the test for. */
  sent: z.number().int().nonnegative(),
  /** Devices that could not be reached right now (removed by the browser, or the push service refused). */
  failed: z.number().int().nonnegative(),
});
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;

/**
 * What the service worker receives (the encrypted push payload). Short keys are not worth it; every field is already bounded. `silent`
 * updates the notification without a sound or a buzz. No message body beyond the 80-character preview the bell row already holds.
 */
export const pushPayloadSchema = z.object({
  v: z.literal(1),
  title: z.string().max(100),
  body: z.string().max(100),
  /** Notifications with the same tag replace each other: one per conversation. */
  tag: z.string().max(120),
  /** Same-origin path to open on click (`/inbox?conversation=...`). The service worker checks it again. */
  url: z.string().max(500),
  silent: z.boolean(),
  /** The bell row, so a click can mark it read and the worker can tell a test from a real one. */
  notificationId: uuidSchema.nullable(),
  test: z.boolean(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;
