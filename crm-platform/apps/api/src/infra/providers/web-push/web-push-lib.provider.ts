import { Injectable } from '@nestjs/common';
import webpush from 'web-push';
import { webPushConfig } from '../../../config/domains/web-push.env';
import type {
  WebPushProvider,
  WebPushResult,
  WebPushSendOptions,
  WebPushTarget,
} from './web-push.port';

/** The adapter over the `web-push` library. The VAPID triple is read at send time, so an operator's change needs only a restart. */
@Injectable()
export class WebPushLibProvider implements WebPushProvider {
  isEnabled(): boolean {
    return webPushConfig().enabled;
  }

  async send(
    target: WebPushTarget,
    payload: string,
    options: WebPushSendOptions,
  ): Promise<WebPushResult> {
    const config = webPushConfig();
    if (!config.enabled) return { ok: false, gone: false, retryable: false, status: null };
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          vapidDetails: {
            subject: config.subject,
            publicKey: config.publicKey,
            privateKey: config.privateKey,
          },
          TTL: options.ttlSeconds,
          urgency: options.urgency,
          ...(options.topic ? { topic: options.topic } : {}),
          timeout: 10_000,
        },
      );
      return { ok: true };
    } catch (err) {
      // Only the status and the retry hint leave this function: the library's error carries the endpoint and the response body.
      const e = err as { statusCode?: number; headers?: Record<string, string | string[]> };
      const status = typeof e.statusCode === 'number' ? e.statusCode : null;
      if (status === 404 || status === 410) return { ok: false, gone: true, status };
      const retryAfter = Number.parseInt(String(e.headers?.['retry-after'] ?? ''), 10);
      return {
        ok: false,
        gone: false,
        // No status = the request never completed (DNS, TLS, timeout): worth another try.
        retryable: status === null || status === 429 || status >= 500,
        status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
      };
    }
  }
}
