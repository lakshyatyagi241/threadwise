import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Readable } from 'node:stream';
import { MEDIA_FAILURE, MediaFetchError } from './media-fetch-error';
import { assertAllowedUrl, guardedLookup, type DnsResolver, type HostPolicy } from './media-url-guard';

/**
 * One HTTP request, with the guard of `media-url-guard.ts` built in. This is the only HTTP client the media pipeline uses, for the
 * Graph lookup, the download and the upload, so none of them can reach a host the policy does not name.
 *
 * Deliberately not `fetch`: a request here connects through `guardedLookup` (the address that is checked is the address that is used),
 * never follows a redirect by itself, and its timeouts are explicit. It returns the response as a stream; the caller decides how
 * many bytes it is willing to read.
 */

export interface SafeRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** A request body: a buffer, or a stream whose length is announced by `content-length` in `headers`. */
  body?: Buffer | Readable;
  policy: HostPolicy;
  /** Time to the response headers. */
  requestTimeoutMs: number;
  /** Time a connection may be silent, while waiting or while a body flows. */
  idleTimeoutMs: number;
  signal?: AbortSignal;
  /** Replaces the system DNS resolver; tests use it to answer with a private address. */
  resolver?: DnsResolver;
}

export interface SafeResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** The body. The caller must read it or `destroy()` it. */
  body: IncomingMessage;
}

const transportError = (message: string): MediaFetchError =>
  new MediaFetchError(MEDIA_FAILURE.DOWNLOAD_FAILED, message, true);

export function safeRequest(req: SafeRequest): Promise<SafeResponse> {
  // Layer 1 runs on every request, so a redirect target the caller passes in again is checked like the first url.
  const url = assertAllowedUrl(req.url, req.policy);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<SafeResponse>((resolve, reject) => {
    if (req.signal?.aborted) return reject(transportError('The transfer was cancelled'));

    const clientReq = send(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers: { 'accept-encoding': 'identity', ...req.headers },
        agent: false, // one connection per request: nothing is reused across tenants or tokens
        lookup: guardedLookup(req.policy, req.resolver) as never,
        timeout: req.idleTimeoutMs,
      },
      (res) => {
        clearTimeout(headerTimer);
        res.on('error', () => undefined); // surfaced to whoever reads the stream
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res });
      },
    );

    const fail = (err: Error) => {
      clearTimeout(headerTimer);
      reject(
        err instanceof MediaFetchError
          ? err
          : // `EBLOCKED` comes from the lookup guard: a host that resolved to a private address.
            (err as NodeJS.ErrnoException).code === 'EBLOCKED'
            ? new MediaFetchError(MEDIA_FAILURE.URL_REJECTED, `Download address refused: ${err.message}`, false)
            : transportError(`Connection failed (${(err as NodeJS.ErrnoException).code ?? err.message})`),
      );
    };

    const headerTimer = setTimeout(
      () => clientReq.destroy(transportError('Meta did not answer in time')),
      req.requestTimeoutMs,
    );
    clientReq.on('timeout', () => clientReq.destroy(transportError('The connection went silent')));
    clientReq.on('error', fail);
    req.signal?.addEventListener('abort', () => clientReq.destroy(transportError('The transfer was cancelled')), {
      once: true,
    });

    if (!req.body) clientReq.end();
    else if (Buffer.isBuffer(req.body)) clientReq.end(req.body);
    else {
      req.body.on('error', (e) => clientReq.destroy(e));
      req.body.pipe(clientReq);
    }
  });
}

/** Reads a small body (a Graph answer) up to `max` bytes; a longer one is an error, so a hostile server cannot make us buffer without limit. */
export async function readSmallBody(res: SafeResponse, max = 256 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  try {
    for await (const chunk of res.body) {
      n += (chunk as Buffer).length;
      if (n > max) {
        res.body.destroy();
        throw new MediaFetchError(MEDIA_FAILURE.UNEXPECTED, 'Meta answered with an unexpectedly large body', false);
      }
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    if (err instanceof MediaFetchError) throw err;
    throw transportError('The connection to Meta was cut while reading its answer');
  }
  return Buffer.concat(chunks).toString('utf8');
}
