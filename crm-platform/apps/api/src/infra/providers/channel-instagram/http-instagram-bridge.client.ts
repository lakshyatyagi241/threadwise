import { Injectable, Logger } from '@nestjs/common';
import { addonsConfig } from '../../../config/domains/addons-extension-registry.env';
import { guardedRequest } from '../../net/guarded-http';
import type {
  BridgeAccount,
  BridgeConnection,
  BridgeResult,
  InstagramBridgeApi,
  InstagramBridgeFactory,
} from './instagram-bridge.port';

const PREFIX = '/api/wadesk';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;

type Json = Record<string, unknown>;

const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const text = (x: unknown): string =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '';

/** The engine's account list into ours: a row without an id is dropped. */
export function toAccounts(body: unknown): BridgeAccount[] {
  if (!Array.isArray(body)) return [];
  const out: BridgeAccount[] = [];
  for (const raw of body) {
    const a = obj(raw);
    const id = text(a.id).trim();
    if (id === '') continue;
    out.push({
      id,
      username: text(a.username),
      name: text(a.name),
      avatar: text(a.avatar),
      connected: typeof a.connected === 'boolean' ? a.connected : null,
    });
  }
  return out;
}

class HttpBridge implements InstagramBridgeApi {
  private readonly logger = new Logger('InstagramBridge');

  constructor(private readonly conn: BridgeConnection) {}

  private async send(
    method: 'GET' | 'POST',
    path: string,
    o: { query?: Record<string, string>; json?: Json } = {},
  ): Promise<{ status: number; json: unknown } | null> {
    let url: URL;
    try {
      url = new URL(`${this.conn.url.replace(/\/+$/, '')}${PREFIX}${path}`);
    } catch {
      return null;
    }
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    try {
      const res = await guardedRequest({
        method,
        url,
        headers: { Accept: 'application/json', 'X-Instaflow-Secret': this.conn.secret },
        body: o.json === undefined ? undefined : JSON.stringify(o.json),
        timeoutMs: TIMEOUT_MS,
        allowPrivate: addonsConfig().ADDONS_ALLOW_PRIVATE_ENGINE_URLS,
        maxBytes: MAX_BYTES,
      });
      let json: unknown = null;
      try {
        json = JSON.parse(res.body);
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (err) {
      // The address and the error message are enough to diagnose; the secret is in a header and never reaches a log.
      this.logger.warn({ path, err: (err as Error).message }, 'instagram engine call failed');
      return null;
    }
  }

  async accounts(q: { workspace?: number; ownerEmail?: string }): Promise<BridgeAccount[]> {
    const query: Record<string, string> = {};
    if (q.workspace !== undefined) query.workspace = String(q.workspace);
    if (q.ownerEmail) query.owner_email = q.ownerEmail;
    // The engine answers nothing without a scope; skip the call rather than rely on that.
    if (Object.keys(query).length === 0) return [];
    const res = await this.send('GET', '/accounts', { query });
    return res && res.status >= 200 && res.status < 300 ? toAccounts(res.json) : [];
  }

  async connectStart(workspace: number, returnUrl: string): Promise<BridgeResult<{ url: string }>> {
    const res = await this.send('POST', '/connect/start', {
      json: { workspace_id: workspace, return_url: returnUrl },
    });
    if (!res) return { ok: false, error: null, status: null };
    const j = obj(res.json);
    const url = text(j.url);
    if (res.status >= 200 && res.status < 300 && j.ok !== false && url !== '') {
      return { ok: true, data: { url } };
    }
    return { ok: false, error: text(j.error) || null, status: res.status };
  }
}

@Injectable()
export class HttpInstagramBridgeFactory implements InstagramBridgeFactory {
  with(conn: BridgeConnection): InstagramBridgeApi {
    return new HttpBridge(conn);
  }
}
