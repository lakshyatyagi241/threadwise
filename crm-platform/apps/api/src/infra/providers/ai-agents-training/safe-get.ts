import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isBlockedAddress } from './blocked-address';

export interface SafeGetOptions {
  timeoutMs: number;
  /** The body is cut at this many bytes and the download stops there. */
  maxBytes: number;
  headers?: Record<string, string>;
  /** Tests replace the resolver; production uses the system one. */
  resolve?: (host: string) => Promise<LookupAddress[]>;
}

export interface SafeGetResponse {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}

export class BlockedAddressError extends Error {
  constructor() {
    super('addresses on private networks are not allowed');
  }
}

const systemResolve = (host: string): Promise<LookupAddress[]> =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) =>
      err ? reject(err) : resolve(addrs),
    ),
  );

/**
 * One GET to an operator-supplied address, redirects NOT followed (the caller decides, hop by hop). The address check runs inside the
 * socket's own DNS lookup, so the address that passed is the address connected to: there is no resolve-then-connect gap for DNS
 * rebinding. A host that resolves to even one blocked address is refused; an address literal is checked before anything is opened.
 */
export function safeGet(url: URL, opts: SafeGetOptions): Promise<SafeGetResponse> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 && isBlockedAddress(host)) return Promise.reject(new BlockedAddressError());
  const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const resolveHost = opts.resolve ?? systemResolve;
  return new Promise((resolve, reject) => {
    const req = doRequest(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'GET',
        headers: opts.headers,
        timeout: opts.timeoutMs,
        lookup: (hostname, options, cb) => {
          const done = cb as unknown as (...a: unknown[]) => void;
          resolveHost(hostname).then(
            (list) => {
              if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
                return done(new BlockedAddressError());
              }
              if ((options as { all?: boolean }).all) return done(null, list);
              return done(null, list[0]!.address, list[0]!.family);
            },
            (err: unknown) => done(err),
          );
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        res.on('data', (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size > opts.maxBytes) {
            // Enough: stop downloading rather than read a huge file to the end.
            res.destroy();
            chunks.splice(0, chunks.length, Buffer.concat(chunks).subarray(0, opts.maxBytes));
            finish();
          }
        });
        res.on('end', finish);
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}
