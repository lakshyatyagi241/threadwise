import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  ApiLibraryBody,
  ApiLibraryErrorKind,
  ApiLibraryMethod,
  ApiLibraryPayloadType,
} from '@crm/contracts';
import {
  SafeFetch,
  UnsafeMediaUrlError,
} from '../../infra/providers/node-bridge-runtime/safe-fetch';
import { runUserCode } from '../../infra/sandbox/code-sandbox';
import {
  buildMultipart,
  maskHeaders,
  maskJson,
  maskJsonText,
  maskResponseHeaders,
  maskUrl,
  renderBody,
  renderHeaders,
  renderUrl,
  truncateText,
  type OutHeader,
  type VariableValues,
} from './api-library.rules';

/** How long the target has to answer, and how much of the answer is read. */
export const RUN_TIMEOUT_MS = 15_000;
export const RUN_MAX_RESPONSE_BYTES = 1024 * 1024;
/** The processing function gets this long (the sandbox adds a hard kill a second later). */
export const FUNCTION_TIMEOUT_MS = 3_000;
/** What a run hands back to a screen, and what a log keeps. */
export const RESPONSE_TEXT_LIMIT = 64 * 1024;
export const LOG_BODY_LIMIT = 16 * 1024;

const USER_AGENT = 'GetaApiLibrary/1';

/** A definition with its secret headers in the clear, ready to run. Never persisted, never logged. */
export interface RunnableDefinition {
  method: ApiLibraryMethod;
  url: string;
  payloadType: ApiLibraryPayloadType;
  headers: Array<{ key: string; value: string; secret: boolean }>;
  body: ApiLibraryBody;
  functionCode: string | null;
  /** A flow step can run twice if its write loses the compare-and-set: a receiver that honours this key sees one request. Not on GET. */
  idempotencyKey?: string;
}

export interface RunOutcome {
  ok: boolean;
  status: number | null;
  durationMs: number;
  errorKind: ApiLibraryErrorKind | null;
  error: string | null;
  /** What was sent, secrets masked (null when the run stopped before a request existed). */
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  } | null;
  response: {
    headers: Record<string, string | string[]>;
    contentType: string | null;
    bodyText: string;
    bodyJson: unknown;
    truncated: boolean;
    sizeBytes: number;
  } | null;
  /** The payload after the processing function (null: no function). */
  processedPayload: unknown;
}

const fail = (
  started: number,
  errorKind: ApiLibraryErrorKind,
  error: string,
  extra: Partial<RunOutcome> = {},
): RunOutcome => ({
  ok: false,
  status: null,
  durationMs: Date.now() - started,
  errorKind,
  error,
  request: null,
  response: null,
  processedPayload: null,
  ...extra,
});

/** What the person is told when SafeFetch refuses or loses a request (its own wording talks about "media"). */
export function describeFetchError(err: unknown): { kind: ApiLibraryErrorKind; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof UnsafeMediaUrlError) {
    if (/blocked/i.test(message))
      return {
        kind: 'blocked',
        message: 'This address is on a private or internal network, so it cannot be called.',
      };
    if (/resolved/i.test(message))
      return { kind: 'network', message: 'The host name could not be found.' };
    return { kind: 'invalid', message: 'The URL is not a valid http or https address.' };
  }
  if (/timed out/i.test(message))
    return { kind: 'timeout', message: `No answer within ${RUN_TIMEOUT_MS / 1000} seconds.` };
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ECONNREFUSED')
    return { kind: 'network', message: 'The server refused the connection.' };
  if (code === 'ECONNRESET') return { kind: 'network', message: 'The connection was reset.' };
  if (code === 'ENOTFOUND')
    return { kind: 'network', message: 'The host name could not be found.' };
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code?.startsWith('ERR_TLS') ||
    code?.startsWith('UNABLE_TO') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  )
    return {
      kind: 'network',
      message: 'The secure connection could not be set up (certificate problem).',
    };
  if (code === 'ERR_INVALID_CHAR' || code === 'ERR_INVALID_HTTP_TOKEN')
    return { kind: 'invalid', message: 'A header holds characters that are not allowed.' };
  return { kind: 'network', message: 'The request could not be completed.' };
}

/**
 * Runs one saved-API definition: fills the variables in, reshapes the JSON payload with the owner's function in the sandbox, sends the
 * request through SafeFetch and writes down what happened with every secret masked. It never throws: every failure is an outcome with
 * an `errorKind`, because a flow must be able to leave by its error port and a test must be able to show the reason.
 *
 * SSRF: SafeFetch resolves the host, refuses private, loopback, link-local and metadata addresses, connects to the address it
 * checked (no second lookup), and does not follow redirects, so a public host cannot send the call to an internal one. Time and
 * size are capped (RUN_TIMEOUT_MS, RUN_MAX_RESPONSE_BYTES). The function runs in `infra/sandbox` (node:vm in a worker thread with a
 * time and memory limit; no require, process, fs or network); it is never `eval`ed in this process.
 */
@Injectable()
export class ApiLibraryRunner {
  /** Overridable in tests, which serve from 127.0.0.1 (`safeFetch.isBlocked`). */
  readonly safeFetch = new SafeFetch();

  async run(def: RunnableDefinition, values: VariableValues): Promise<RunOutcome> {
    const started = Date.now();
    const url = renderUrl(def.url, values).trim();
    const headers: OutHeader[] = renderHeaders(def.headers, values);
    if (
      def.idempotencyKey &&
      def.method !== 'GET' &&
      !headers.some((h) => h.key.toLowerCase() === 'idempotency-key')
    )
      headers.push({ key: 'Idempotency-Key', value: def.idempotencyKey, secret: false });

    let body: ApiLibraryBody = null;
    let processed: unknown = null;
    let sendBody: string | undefined;
    let snapshotBody: string | null = null;
    const sendHeaders: Record<string, string> = { 'user-agent': USER_AGENT, accept: '*/*' };
    for (const h of headers) sendHeaders[h.key] = h.value;

    const hasBody = def.method === 'POST' || def.method === 'PUT' || def.method === 'PATCH';
    // A function with no payload written yet gets an empty object to build on (the old console started every payload as `{}`).
    const source =
      def.body ??
      (hasBody && def.payloadType === 'application/json' && def.functionCode?.trim() ? {} : null);
    if (hasBody && source !== null) {
      body = renderBody(source, values);
      if (def.payloadType === 'multipart/form-data') {
        const fields = (body ?? {}) as Record<string, string>;
        const boundary = `----GetaApiLibrary${randomBytes(12).toString('hex')}`;
        sendBody = buildMultipart(fields, boundary);
        sendHeaders['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        snapshotBody = JSON.stringify(maskJson(fields));
      } else {
        if (def.functionCode !== null && def.functionCode.trim() !== '') {
          const ran = await runUserCode(
            `${def.functionCode}\nreturn processPayload(functionArgs);`,
            { functionArgs: body },
            { timeoutMs: FUNCTION_TIMEOUT_MS },
          );
          if (!ran.ok)
            return fail(
              started,
              'function',
              `The processing function failed: ${ran.error ?? 'unknown error'}`,
            );
          if (ran.result === null || typeof ran.result !== 'object')
            return fail(
              started,
              'function',
              'processPayload must return the payload (an object or a list).',
            );
          body = ran.result as ApiLibraryBody;
          processed = ran.result;
        }
        sendBody = JSON.stringify(body);
        if (!headers.some((h) => h.key.toLowerCase() === 'content-type'))
          sendHeaders['Content-Type'] = 'application/json';
        snapshotBody = maskJsonText(sendBody);
      }
      sendHeaders['Content-Length'] = String(Buffer.byteLength(sendBody));
    }

    const request = {
      method: def.method,
      url: maskUrl(url),
      headers: {
        ...maskHeaders(headers),
        ...(sendBody !== undefined && !headers.some((h) => h.key.toLowerCase() === 'content-type')
          ? { 'Content-Type': sendHeaders['Content-Type']! }
          : {}),
      },
      body: snapshotBody === null ? null : truncateText(snapshotBody, LOG_BODY_LIMIT).text,
    };

    try {
      const res = await this.safeFetch.request(url, {
        method: def.method,
        headers: sendHeaders,
        body: sendBody,
        timeoutMs: RUN_TIMEOUT_MS,
        maxBytes: RUN_MAX_RESPONSE_BYTES,
        truncate: true,
      });
      const contentType =
        typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null;
      const truncated = res.truncated === true;
      let bodyJson: unknown = null;
      if (!truncated && res.text.trim() !== '') {
        try {
          bodyJson = JSON.parse(res.text);
        } catch {
          /* not JSON: the text is all there is */
        }
      }
      const ok = res.status >= 200 && res.status < 300;
      return {
        ok,
        status: res.status,
        durationMs: Date.now() - started,
        errorKind: ok ? null : 'status',
        error: ok
          ? null
          : res.status >= 300 && res.status < 400
            ? `The server answered HTTP ${res.status} (redirects are not followed).`
            : `The server answered HTTP ${res.status}.`,
        request,
        response: {
          headers: maskResponseHeaders(res.headers),
          contentType,
          bodyText: truncateText(res.text, RESPONSE_TEXT_LIMIT).text,
          bodyJson,
          truncated: truncated || res.text.length > RESPONSE_TEXT_LIMIT,
          sizeBytes: Buffer.byteLength(res.text),
        },
        processedPayload: processed,
      };
    } catch (err) {
      const d = describeFetchError(err);
      return fail(started, d.kind, d.message, { request, processedPayload: processed });
    }
  }
}
