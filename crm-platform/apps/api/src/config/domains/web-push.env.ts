/**
 * Web Push settings (BL-097, docs/specs/realtime-notifications.md section 14). Read straight from the environment like the other
 * notification settings, at call time so tests can change it between runs.
 *
 * The feature is ON only when the whole VAPID triple is present and well formed; anything less leaves it fully off and invisible (the
 * public-key route says `enabled: false`, the producers enqueue nothing, the web app shows no card). A half-configured deployment never
 * crashes the app.
 *
 * Generate a pair once per deployment with `npx web-push generate-vapid-keys`; changing it later makes every stored subscription
 * unusable (the browser ties a subscription to the public key it was created with), so people simply enable again.
 */
export interface WebPushConfig {
  enabled: boolean;
  /** base64url, the "application server key" the browser subscribes with. Public. */
  publicKey: string;
  /** base64url. Secret: never logged, never returned. */
  privateKey: string;
  /** `mailto:ops@example.com` or an https URL; the push services use it to contact the operator. */
  subject: string;
  /** How long a push service keeps an undelivered push for an offline device. */
  ttlSeconds: number;
}

/** An uncompressed P-256 point is 65 bytes (87 base64url characters); the private scalar 32 bytes (43). */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;
const PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/;
const SUBJECT = /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/;

export function webPushConfig(env: NodeJS.ProcessEnv = process.env): WebPushConfig {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = (env.VAPID_SUBJECT ?? '').trim();
  const ttl = Number.parseInt(env.WEB_PUSH_TTL_SECONDS ?? '', 10);
  return {
    enabled: PUBLIC_KEY.test(publicKey) && PRIVATE_KEY.test(privateKey) && SUBJECT.test(subject),
    publicKey,
    privateKey,
    subject,
    ttlSeconds: Number.isFinite(ttl) && ttl >= 60 && ttl <= 86_400 ? ttl : 4 * 3600,
  };
}
