import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isBlockedAddress } from './blocked-address';

/** Loopback, private, link-local, CGNAT, unspecified and their IPv6 / IPv4-mapped counterparts (the shared rule, `blocked-address.ts`). */
export function isPrivateAddress(address: string): boolean {
  return isBlockedAddress(address);
}

export interface GuardedRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: URL;
  headers: Record<string, string>;
  /** A body for a POST or PUT: a JSON string, or raw bytes sent exactly as given (a signed payload must not be re-serialised). */
  body?: string | Uint8Array;
  timeoutMs: number;
  /** Private, loopback and link-local destinations are refused unless this is on. */
  allowPrivate: boolean;
  /** The response body is cut at this many bytes. */
  maxBytes: number;
}

/**
 * A request to an operator-supplied address. The address check runs inside the socket's own DNS lookup, so the address that was
 * checked is the address that is connected to (no resolve-then-connect gap for DNS rebinding), and redirects are never followed.
 * `timeoutMs` is an overall deadline (connect, answer and body), and an answer larger than `maxBytes` is cut off and the connection closed.
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
    // A caller that names its own content type (any casing) keeps it; the default stays plain JSON.
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type'))
      headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(req.body));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
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
        const answer = () => ({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= req.maxBytes) return void chunks.push(c);
          // Past the cap: nobody will read the rest, so stop taking it (a hostile target can stream for as long as it likes).
          settle(() => resolve(answer()));
          r.destroy();
        });
        res.on('end', () => settle(() => resolve(answer())));
        res.on('error', (e) => settle(() => reject(e)));
        // A connection that closes before the answer is complete must still end the call.
        res.on('close', () => settle(() => reject(new Error('connection closed before the answer was complete'))));
      },
    );
    // `timeout` above only fires when the socket goes quiet, so a target that trickles a byte at a time would never trip it. This is the
    // overall deadline: `timeoutMs` is how long the target has, in total, to finish its answer.
    deadline = setTimeout(() => r.destroy(new Error('timed out')), req.timeoutMs);
    r.on('timeout', () => r.destroy(new Error('timed out')));
    r.on('error', (e) => settle(() => reject(e)));
    r.end(req.body);
  });
}
