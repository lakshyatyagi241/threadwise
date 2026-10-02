import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

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

export interface GuardedRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: URL;
  headers: Record<string, string>;
  /** A JSON body for a POST or PUT. */
  body?: string;
  timeoutMs: number;
  /** Private, loopback and link-local destinations are refused unless this is on. */
  allowPrivate: boolean;
  /** The response body is cut at this many bytes. */
  maxBytes: number;
}

/**
 * A request to an operator-supplied address. The address check runs inside the socket's own DNS lookup, so the address that was
 * checked is the address that is connected to (no resolve-then-connect gap for DNS rebinding), and redirects are never followed.
 */
export function guardedRequest(
  req: GuardedRequest,
): Promise<{ status: number; body: string; headers: IncomingHttpHeaders }> {
  const { url, allowPrivate } = req;
  const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // An address literal never goes through the lookup below, so it is checked here.
  if (!allowPrivate && isIP(host) !== 0 && isPrivateAddress(host)) {
    return Promise.reject(new Error('addresses on private networks are not allowed'));
  }
  const headers = { ...req.headers };
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(req.body));
  }
  return new Promise((resolve, reject) => {
    const r = doRequest(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: req.method,
        headers,
        timeout: req.timeoutMs,
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
          if (size <= req.maxBytes) chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          }),
        );
        res.on('error', reject);
      },
    );
    r.on('timeout', () => r.destroy(new Error('timed out')));
    r.on('error', reject);
    r.end(req.body);
  });
}
