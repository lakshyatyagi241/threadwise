import { createECDH } from 'node:crypto';
import type {
  WebPushProvider,
  WebPushResult,
  WebPushSendOptions,
  WebPushTarget,
} from '../../src/infra/providers/web-push/web-push.port';

/**
 * A stand-in for the push services, so no test touches the network. It records every send and answers per endpoint: `ok` unless a
 * test scripted a status for that endpoint (410 gone, 429 retry, 403 unusable...).
 */
export class FakeWebPushProvider implements WebPushProvider {
  enabled = true;
  readonly sent: Array<{
    target: WebPushTarget;
    payload: Record<string, unknown>;
    options: WebPushSendOptions;
  }> = [];
  /** endpoint -> the answer; a function answers once per call (to script "429 then ok"). */
  private readonly scripted = new Map<string, WebPushResult | (() => WebPushResult)>();

  isEnabled(): boolean {
    return this.enabled;
  }

  answer(endpoint: string, result: WebPushResult | (() => WebPushResult)): void {
    this.scripted.set(endpoint, result);
  }

  async send(
    target: WebPushTarget,
    payload: string,
    options: WebPushSendOptions,
  ): Promise<WebPushResult> {
    this.sent.push({ target, payload: JSON.parse(payload) as Record<string, unknown>, options });
    const s = this.scripted.get(target.endpoint);
    if (!s) return { ok: true };
    return typeof s === 'function' ? s() : s;
  }
}

/** A throwaway VAPID triple for the process environment of ONE test file. Generated fresh; never a real key. */
export function useVapidEnv(): () => void {
  const keys = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
  const before = keys.map((k) => process.env[k]);
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  process.env.VAPID_PUBLIC_KEY = ecdh.getPublicKey().toString('base64url');
  // `getPrivateKey()` drops leading zero bytes (about 1 draw in 256), and the config wants exactly 32 bytes (43 characters).
  const privateKey = Buffer.alloc(32);
  ecdh.getPrivateKey().copy(privateKey, 32 - ecdh.getPrivateKey().length);
  process.env.VAPID_PRIVATE_KEY = privateKey.toString('base64url');
  process.env.VAPID_SUBJECT = 'mailto:test@example.test';
  return () => {
    keys.forEach((k, i) => {
      if (before[i] === undefined) delete process.env[k];
      else process.env[k] = before[i];
    });
  };
}

/** A made-up but well-formed browser subscription (the endpoint is unique per `n`). */
export function fakeSubscription(n: number): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  return {
    endpoint: `https://push.example.test/send/device-${n}-${'x'.repeat(40)}`,
    keys: { p256dh: `BP${'a'.repeat(85)}`, auth: 'b'.repeat(22) },
  };
}
