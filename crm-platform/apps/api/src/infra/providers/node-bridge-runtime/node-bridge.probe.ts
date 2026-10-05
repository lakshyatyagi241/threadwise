import { Injectable } from '@nestjs/common';
import type { NodeBridgeTestResult } from '@crm/contracts';

const TIMEOUT_MS = 5_000;

/**
 * TW-NODE-052: prove an address and token against the real bridge. `GET {url}/api/refresh-settings` is what Reference's
 * "Test connection" calls: the route sits behind the bridge's token guard, so a 401 or 403 means "reached it, token wrong".
 * Redirects are not followed, so a bridge address cannot bounce the request somewhere else.
 */
@Injectable()
export class NodeBridgeProbe {
  async probe(serverUrl: string, token: string): Promise<NodeBridgeTestResult> {
    try {
      const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/refresh-settings`, {
        headers: { 'X-Node-Token': token, Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message: `Reached the bridge but the token was rejected (${res.status}). Check the X-Node-Token.`,
        };
      }
      if (res.ok) return { ok: true, message: 'Connected — bridge reachable and token accepted.' };
      return { ok: false, message: `Bridge responded with HTTP ${res.status}.` };
    } catch {
      return {
        ok: false,
        message: 'Could not reach the bridge — check the URL and that the Node service is running.',
      };
    }
  }
}
