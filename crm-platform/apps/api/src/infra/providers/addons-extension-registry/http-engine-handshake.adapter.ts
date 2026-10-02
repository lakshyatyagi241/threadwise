import { Injectable } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { addonsConfig } from '../../../config/domains/addons-extension-registry.env';
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

/** Loopback, private, link-local, CGNAT, unspecified and their IPv6 / IPv4-mapped counterparts. */
export function isPrivateAddress(address: string): boolean {
  const v = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(v) === 6) {
    return (
      v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v)
    );
  }
  return true; // not an address at all: refuse
}

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
    const allowPrivate = addonsConfig().ADDONS_ALLOW_PRIVATE_ENGINE_URLS;
    const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // An address literal never goes through the lookup below, so it is checked here.
    if (!allowPrivate && isIP(host) !== 0 && isPrivateAddress(host)) {
      return Promise.reject(new Error('addresses on private networks are not allowed'));
    }
    return new Promise((resolve, reject) => {
      const r = doRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ''),
          port: url.port || undefined,
          path: url.pathname + url.search,
          method: 'GET',
          headers,
          timeout: timeoutMs,
          lookup: (hostname, options, cb) => {
            // Node may ask for one address or all of them, so answer in the shape it asked for.
            dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
              const list = addresses as unknown as LookupAddress[];
              if (err) return (cb as (e: Error | null) => void)(err);
              if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
                return (cb as (e: Error | null) => void)(
                  new Error('addresses on private networks are not allowed'),
                );
              }
              if ((options as { all?: boolean }).all) {
                return (cb as (e: null, a: LookupAddress[]) => void)(null, list);
              }
              return (cb as (e: null, a: string, f: number) => void)(
                null,
                list[0]!.address,
                list[0]!.family,
              );
            });
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size <= MAX_BODY) chunks.push(c);
          });
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );
      r.on('timeout', () => r.destroy(new Error('timed out')));
      r.on('error', reject);
      r.end();
    });
  }
}
