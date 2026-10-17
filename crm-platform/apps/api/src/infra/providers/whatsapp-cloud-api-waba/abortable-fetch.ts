import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

/**
 * `fetch` that really closes the connection when its signal fires. Node's built-in fetch does not: an aborted request that has no
 * answer yet leaves its socket open until the server gives up, so a hung send holds a socket (and, through the caller, a worker).
 * This sends the request with `node:http(s)` and destroys it on abort, including while the answer body is still arriving.
 *
 * Bodies it cannot stream as bytes (FormData, Blob, streams) and URLs that are not http(s) go to the built-in fetch unchanged.
 */
export async function abortableFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const body = init.body;
  const bytes = body === undefined || body === null ? null : toBytes(body);
  const url = new URL(input);
  const send =
    url.protocol === 'https:' ? httpsRequest : url.protocol === 'http:' ? httpRequest : null;
  if (!send || (body !== undefined && body !== null && bytes === null)) return fetch(input, init);

  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  if (bytes && headers['content-length'] === undefined)
    headers['content-length'] = String(bytes.byteLength);

  const signal = init.signal ?? undefined;
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));

    const req = send(url, { method: init.method ?? 'GET', headers }, (res) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers as IncomingHttpHeaders)) {
        if (value === undefined) continue;
        responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const stream = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
      resolve(new Response(stream, { status: res.statusCode ?? 0, headers: responseHeaders }));
    });

    const onAbort = (): void => {
      const reason = abortReason(signal);
      req.destroy(reason as Error);
      reject(reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (cause) => {
      signal?.removeEventListener('abort', onAbort);
      reject(cause);
    });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));

    req.end(bytes ?? undefined);
  });
}

function toBytes(body: unknown): Uint8Array | null {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return null;
}

function abortReason(signal: AbortSignal | undefined): Error {
  return (
    (signal?.reason as Error | undefined) ??
    (new DOMException('This operation was aborted', 'AbortError') as Error)
  );
}
