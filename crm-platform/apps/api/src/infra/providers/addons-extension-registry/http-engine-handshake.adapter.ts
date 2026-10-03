import { Injectable } from '@nestjs/common';
import { addonsConfig } from '../../../config/domains/addons-extension-registry.env';
import { guardedRequest } from '../../net/guarded-http';
import type {
  EngineHandshakePort,
  HandshakeRequest,
  HandshakeResult,
} from './engine-handshake.port';

/** The sibling products' contract: GET <base>/api/threadwise/handshake with the shared secret in a product header. */
const PATH = '/api/threadwise/handshake';
const HEADER = { instagram: 'X-Instaflow-Secret', email: 'X-Mailtrixy-Secret' } as const;
const SERVICE = { instagram: 'instaflow', email: 'mailtrixy' } as const;
const TIMEOUT_MS = { instagram: 12_000, email: 15_000 } as const;
const MAX_BODY = 64 * 1024;

/**
 * Real HTTP adapter. The address check runs inside the socket's own DNS lookup, so the address that was checked is
 * the address that is connected to (no resolve-then-connect gap for DNS rebinding), and redirects are never
 * followed. Private, loopback and link-local destinations are refused unless ADDONS_ALLOW_PRIVATE_ENGINE_URLS is on
 * (Reference had no guard at all, TW-ADD-017 rule 6).
 */
@Injectable()
export class HttpEngineHandshakeAdapter implements EngineHandshakePort {
  async handshake(req: HandshakeRequest): Promise<HandshakeResult> {
    const instagram = req.engine === 'instagram';
    // The email client reports one generic sentence and never makes a call without both a URL and a secret.
    const generic = `Could not verify a ${req.brand} deployment at that URL - check the URL and shared secret.`;
    if (!instagram && (!req.url || !req.secret)) return { ok: false, reason: generic };

    let target: URL;
    try {
      target = new URL(req.url + PATH);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('scheme');
    } catch {
      return {
        ok: false,
        reason: instagram ? `Could not reach ${req.brand} at that URL (invalid address).` : generic,
      };
    }

    let res: { status: number; body: string };
    try {
      res = await this.get(
        target,
        {
          [HEADER[req.engine]]: req.secret,
          Accept: 'application/json',
        },
        TIMEOUT_MS[req.engine],
      );
    } catch (err) {
      if (!instagram) return { ok: false, reason: generic };
      return {
        ok: false,
        reason: `Could not reach ${req.brand} at that URL (${(err as Error).message}).`,
      };
    }

    if (!instagram) {
      return res.status >= 200 && res.status < 300 && this.acknowledges(res.body, req.engine)
        ? { ok: true, reason: null }
        : { ok: false, reason: generic };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `Secret rejected by ${req.brand} (HTTP ${res.status}).` };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, reason: `${req.brand} returned HTTP ${res.status}.` };
    }
    return this.acknowledges(res.body, req.engine)
      ? { ok: true, reason: null }
      : {
          ok: false,
          reason: `Reached the URL but it did not respond as an ${req.brand} deployment.`,
        };
  }

  /** 2xx counts only when the JSON says `ok === true` or names the right service. */
  private acknowledges(body: string, engine: 'instagram' | 'email'): boolean {
    try {
      const json = JSON.parse(body) as { ok?: unknown; service?: unknown };
      return json.ok === true || json.service === SERVICE[engine];
    } catch {
      return false;
    }
  }

  private get(
    url: URL,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<{ status: number; body: string }> {
    return guardedRequest({
      method: 'GET',
      url,
      headers,
      timeoutMs,
      allowPrivate: addonsConfig().ADDONS_ALLOW_PRIVATE_ENGINE_URLS,
      maxBytes: MAX_BODY,
    });
  }
}
