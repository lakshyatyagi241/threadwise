/**
 * The port of the Web Push protocol (RFC 8030 delivery, RFC 8291 encryption, RFC 8292 VAPID): send one encrypted message to one browser
 * subscription. The notifications module is written against this, so tests use a fake and nothing in a test touches the network.
 */

/** A browser's push subscription. The endpoint and keys are secrets: never log or return them. */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushSendOptions {
  /** Seconds the push service may keep the message for an offline device. */
  ttlSeconds: number;
  /** `Topic` header (RFC 8030): a newer message with the same topic replaces an undelivered older one at the push service. */
  topic?: string;
  /** `Urgency` header: `high` wakes a sleeping phone, `normal` waits for the next wake-up. */
  urgency: 'very-low' | 'low' | 'normal' | 'high';
}

/**
 * What came of one send. `gone` means the subscription no longer exists (HTTP 404 or 410) and must never be used again; `retryable`
 * means a later attempt may work (429, 5xx, a network error); anything else (400, 401, 403, 413) is a refusal retrying will not fix.
 */
export type WebPushResult =
  | { ok: true }
  | { ok: false; gone: true; status: number }
  | {
      ok: false;
      gone: false;
      retryable: boolean;
      status: number | null;
      retryAfterSeconds?: number;
    };

export interface WebPushProvider {
  /** False when the deployment has no VAPID keys: the feature is off. */
  isEnabled(): boolean;
  /** Sends `payload` (already a string, at most 4 KB). Never throws for a push-service answer; resolves with the result. */
  send(target: WebPushTarget, payload: string, options: WebPushSendOptions): Promise<WebPushResult>;
}

export const WEB_PUSH_PROVIDER = Symbol('WEB_PUSH_PROVIDER');
