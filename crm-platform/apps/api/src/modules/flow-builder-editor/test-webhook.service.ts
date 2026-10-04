import { Injectable } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import type { FlbTestWebhookRequest, FlbTestWebhookResponse } from '@crm/contracts';
import { guardSsrf, type Resolver } from './ssrf-guard';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const TIMEOUT_MS = 15_000;
const KEEP_CHARS = 4000;
const MAX_BYTES = 1_000_000;
const USER_AGENT = 'WaDesk-FlowTest/1.0';

/**
 * `{{ name }}` (spaces allowed; a dotted key such as `response.id` is looked up literally, not as a path). As in WaDesk, a
 * variable that is not set becomes an empty string (the live runtime does the same), unlike the chat preview, which keeps it.
 */
export function substitute(text: string, vars: Record<string, unknown> | null | undefined): string {
  if (!text) return '';
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, raw: string) => {
    const v = vars?.[raw.trim()];
    return v === undefined || v === null
      ? ''
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
  });
}

/**
 * The Webhook node's "fire the real request" call in the Test runner (WD-FLB-024). Substitutes variables, sends with the
 * operator's method / headers / body, refuses redirects (fail closed on 3xx) and private destinations, and never lets a
 * failure become an HTTP error: the builder shows `{ ok: false, error }` in the chat log and continues.
 */
@Injectable()
export class TestWebhookService {
  /** Overridden in tests; production resolves with the system resolver. */
  resolver?: Resolver;

  async run(req: FlbTestWebhookRequest): Promise<FlbTestWebhookResponse> {
    const vars = req.vars ?? {};
    const url = substitute(req.url ?? '', vars).trim();
    if (!url) return { ok: false, error: 'No URL configured on the webhook node.' };

    const verdict = await guardSsrf(url, this.resolver);
    if (!verdict.ok) return { ok: false, error: `Blocked: ${verdict.reason}` };

    const asked = (req.method ?? 'POST').toUpperCase();
    const method = METHODS.has(asked) ? asked : 'POST';
    // Content-Type defaults to JSON as in WaDesk; custom headers may replace it (any casing); a body goes out with the node's own type.
    const contentType = req.contentType || 'application/json';
    // WaDesk's HTTP client always identifies itself (some endpoints refuse a request with no User-Agent); so do we.
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Content-Type': contentType,
    };
    for (const h of req.headers ?? []) {
      const k = (h.key ?? '').trim();
      if (!k) continue;
      for (const existing of Object.keys(headers))
        if (existing.toLowerCase() === k.toLowerCase()) delete headers[existing];
      headers[k] = substitute(h.value ?? '', vars);
    }
    const body = method !== 'GET' && method !== 'HEAD' ? substitute(req.body ?? '', vars) : '';
    if (body) {
      for (const existing of Object.keys(headers))
        if (existing.toLowerCase() === 'content-type') delete headers[existing];
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    try {
      const out = await this.send(verdict, method, headers, body);
      const ct = String(out.headers['content-type'] ?? '');
      let json: Record<string, unknown> | null = null;
      if (ct.toLowerCase().includes('json')) {
        try {
          const parsed: unknown = JSON.parse(out.text);
          if (Array.isArray(parsed))
            json = Object.fromEntries(parsed.map((v, i) => [String(i), v]));
          else if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
        } catch {
          json = null;
        }
      }
      return {
        ok: true,
        status: out.status,
        success: out.status >= 200 && out.status < 300,
        response: out.text.slice(0, KEEP_CHARS),
        json,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Request failed: ${String((err as Error).message ?? err).slice(0, 200)}`,
      };
    }
  }

  /** Connects to the already-checked address with the original host name for the Host header and TLS name. */
  protected send(
    v: { url: URL; address: string; family: 4 | 6 },
    method: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
    const secure = v.url.protocol === 'https:';
    const mod = secure ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          host: v.address,
          family: v.family,
          port: v.url.port || (secure ? 443 : 80),
          path: `${v.url.pathname}${v.url.search}`,
          method,
          headers: { Host: v.url.host, ...headers },
          ...(secure ? { servername: v.url.hostname } : {}),
          timeout: TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size <= MAX_BYTES) chunks.push(c);
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout after 15 s')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}
