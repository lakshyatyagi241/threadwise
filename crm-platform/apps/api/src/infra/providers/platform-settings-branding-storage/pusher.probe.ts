import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';

export interface PusherCredentials {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

/** Signs a Pusher Channels REST call (exported for the unit test). */
export function signPusherRequest(
  c: PusherCredentials,
  body: string,
  now: number = Math.floor(Date.now() / 1000),
): { path: string; query: string } {
  const path = `/apps/${c.appId}/events`;
  const params: Record<string, string> = {
    auth_key: c.key,
    auth_timestamp: String(now),
    auth_version: '1.0',
    body_md5: createHash('md5').update(body).digest('hex'),
  };
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const signature = createHmac('sha256', c.secret).update(`POST\n${path}\n${sorted}`).digest('hex');
  return { path, query: `${sorted}&auth_signature=${signature}` };
}

/**
 * TW-SET-041: prove the saved credentials by firing a throwaway event, over HTTP (no SDK, so the check
 * works on a bare install, unlike Reference's, which needed a composer package the runtime never used).
 */
@Injectable()
export class PusherProbe {
  /** Overridable in tests. */
  baseUrl(cluster: string): string {
    return `https://api-${cluster}.pusher.com`;
  }

  async probe(c: PusherCredentials): Promise<{ ok: boolean; message: string }> {
    if (!c.appId || !c.key || !c.secret) {
      return { ok: false, message: 'Fill in App ID, Key and Secret first.' };
    }
    const body = JSON.stringify({
      name: 'ping',
      channels: ['crm-realtime-test'],
      data: JSON.stringify({ at: new Date().toISOString() }),
    });
    const { path, query } = signPusherRequest(c, body);
    try {
      const res = await fetch(`${this.baseUrl(c.cluster || 'mt1')}${path}?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        return {
          ok: true,
          message: 'Connected - Pusher accepted a test event. Real-time is live.',
        };
      }
      const detail = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
      return {
        ok: false,
        message: `Pusher rejected the credentials: HTTP ${res.status} ${detail}`.trim(),
      };
    } catch (err) {
      return { ok: false, message: `Pusher could not be reached: ${(err as Error).message}` };
    }
  }
}
