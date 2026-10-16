/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A fake of the CRM's add-on API (`/api/v1/sheets-addon`) for the Apps Script harness: the same envelope, status codes and per-row answers
 * the real server gives, with failures a test can queue. It is the unit-test double; the e2e test runs the same Code.gs against the real
 * Nest app instead.
 */
import {
  NetworkFailure,
  type FetchHandler,
  type HarnessRequest,
  type HarnessResponse,
} from './apps-script-harness';

export const FAKE_KEY = `wsn_live_${'0123456789abcdef'.repeat(2)}`;
export const FAKE_ORIGIN = 'https://crm.example.test';
export const FAKE_HOOK_URL = `${FAKE_ORIGIN}/api/v1/sheets-addon/webhook/${FAKE_KEY}`;
const BASE = '/api/v1/sheets-addon';
const MAX_ROWS = 500;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface FakeCall {
  method: string;
  path: string;
  event?: string;
  rows?: number;
  bytes: number;
  /** The body as the server parsed it. */
  body?: any;
}

interface StoredContact {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  attributes: Record<string, unknown>;
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HarnessResponse => ({
  status,
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...headers },
});

export const keyInvalid = (): HarnessResponse =>
  json(401, {
    ok: false,
    code: 'EXT_KEY_INVALID',
    error: 'The key is missing, revoked or replaced. Create a new one in your account.',
    requestId: 'req-401',
  });

export class FakeCrm {
  key = FAKE_KEY;
  readonly calls: FakeCall[] = [];
  readonly contacts: StoredContact[] = [];
  /** One-shot answers used before the normal handling, oldest first. A function may throw `NetworkFailure`. */
  readonly queue: Array<(request: HarnessRequest) => HarnessResponse | undefined> = [];
  /** Which capabilities `/health` says the key has. */
  can = { read_contacts: true, write_contacts: true, read_catalog: true, write_catalog: true };
  /** Virtual milliseconds every answer takes. */
  delayMs = 0;
  private seq = 0;

  readonly handler: FetchHandler = (request) => this.handle(request);

  /** Answers the next call with this response (once). */
  answerNext(response: HarnessResponse | ((r: HarnessRequest) => HarnessResponse)): void {
    this.queue.push((r) => (typeof response === 'function' ? response(r) : response));
  }
  /** Makes the next call fail like a network error. */
  failNextWithNetworkError(message = 'DNS error: https://crm.example.test'): void {
    this.queue.push(() => {
      throw new NetworkFailure(message);
    });
  }

  callsTo(path: string): FakeCall[] {
    return this.calls.filter((c) => c.path === path);
  }
  /** Rows the server was sent for each webhook/sync call, flattened. */
  sentRows(path = '/webhook'): any[] {
    return this.callsTo(path).flatMap((c) => (c.body?.rows as unknown[]) ?? []);
  }

  private handle(request: HarnessRequest): HarnessResponse {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
    const bytes = Buffer.byteLength(request.body ?? '', 'utf8');
    const call: FakeCall = { method: request.method, path, bytes };
    try {
      call.body = JSON.parse(request.body ?? '');
      call.rows = Array.isArray(call.body.rows) ? call.body.rows.length : undefined;
      call.event = call.body.event;
    } catch {
      // a GET, or a body that is not JSON
    }
    this.calls.push(call);
    const forced = this.queue.shift();
    if (forced) {
      const out = forced(request);
      if (out) return { delayMs: this.delayMs, ...out };
    }
    const res = this.route(request, url, path, call, bytes);
    return { delayMs: this.delayMs, ...res };
  }

  private route(
    request: HarnessRequest,
    url: URL,
    path: string,
    call: FakeCall,
    bytes: number,
  ): HarnessResponse {
    if (url.origin !== FAKE_ORIGIN) throw new NetworkFailure(`DNS error: ${request.url}`);
    if (bytes > MAX_BODY_BYTES) {
      return json(413, {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'The request body is too large.',
      });
    }
    const auth = request.headers.Authorization ?? request.headers.authorization ?? '';
    const pathKey = /\/webhook\/([^/]+)$/.exec(path)?.[1];
    const token = auth.replace(/^Bearer\s+/i, '') || pathKey;
    if (token !== this.key) return keyInvalid();

    if (path === '/health' && request.method === 'get') {
      return json(200, {
        ok: true,
        user: { id: 'u1', name: 'Asha Rao', email: 'asha@example.test' },
        workspace: { id: 'w1', name: 'Acme Co' },
        can: this.can,
        limits: { max_rows: MAX_ROWS, max_pull: 500 },
      });
    }
    if (
      request.method !== 'post' &&
      !(request.method === 'get' && /^\/(contacts|shops)$/.test(path))
    ) {
      return json(404, { ok: false, code: 'NOT_FOUND', error: 'Not found.' });
    }

    if (path === '/contacts' || path === '/shops') {
      if (path === '/shops') return json(200, { ok: true, shops: [] });
      const limit = Number(url.searchParams.get('limit') ?? 200);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const page = this.contacts.slice(start, start + limit);
      const next = start + limit;
      return json(200, {
        ok: true,
        contacts: page.map((c) => ({
          ...c,
          is_unsubscribed: false,
          created_at: '',
          updated_at: '',
        })),
        next_cursor: next < this.contacts.length ? String(next) : null,
        has_more: next < this.contacts.length,
      });
    }

    let body: any;
    try {
      body = JSON.parse(request.body ?? '');
    } catch {
      return json(400, { ok: false, code: 'VALIDATION_FAILED', error: 'The body is not JSON.' });
    }
    call.body = body;
    call.rows = Array.isArray(body.rows) ? body.rows.length : undefined;
    call.event = body.event;
    if (path === '/webhook' || /^\/webhook\/[^/]+$/.test(path) || path === '/contacts/sync') {
      if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_ROWS) {
        return json(422, {
          ok: false,
          code: 'VALIDATION_FAILED',
          error: `Send 1 to ${MAX_ROWS} rows.`,
        });
      }
      const isHook = path !== '/contacts/sync';
      if (isHook && !['test', 'edit', 'schedule'].includes(body.event)) {
        return json(422, { ok: false, code: 'VALIDATION_FAILED', error: 'Unknown event.' });
      }
      const fields = Object.keys(body.rows[0]?.values ?? {});
      if (body.event === 'test') {
        return json(200, {
          ok: true,
          event: 'test',
          received: body.rows.length,
          written: false,
          fields,
        });
      }
      const results = body.rows.map((row: Record<string, unknown>, index: number) =>
        this.upsert(row, index),
      );
      const count = (s: string) => results.filter((r: { status: string }) => r.status === s).length;
      const summary = {
        created: count('created'),
        updated: count('updated'),
        unchanged: count('unchanged'),
        failed: count('failed'),
        total: count('created') + count('updated'),
      };
      return json(
        200,
        isHook
          ? {
              ok: true,
              event: body.event,
              received: body.rows.length,
              written: true,
              summary,
              results,
              fields,
            }
          : { ok: true, summary, results },
      );
    }
    return json(404, { ok: false, code: 'NOT_FOUND', error: 'Not found.' });
  }

  private upsert(row: Record<string, unknown>, index: number): Record<string, unknown> {
    const ref = row.ref;
    const out = (status: string, extra: Record<string, unknown> = {}) => ({
      index,
      ...(ref !== undefined ? { ref } : {}),
      status,
      ...extra,
    });
    const email =
      typeof row.email === 'string' && row.email.trim()
        ? row.email.trim().toLowerCase()
        : undefined;
    const phoneRaw = row.phone === undefined || row.phone === '' ? undefined : String(row.phone);
    const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, '') : undefined;
    if (!email && !phone) {
      return out('failed', {
        error: {
          code: 'VALIDATION_FAILED',
          field: 'email',
          message: 'Give an email or a phone number.',
        },
      });
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return out('failed', {
        error: {
          code: 'VALIDATION_FAILED',
          field: 'email',
          message: 'This is not an email address.',
        },
      });
    }
    if (email?.startsWith('boom')) {
      return out('failed', {
        error: { code: 'INTERNAL', message: 'This row could not be saved. Try it again.' },
      });
    }
    const found = this.contacts.find(
      (c) => (email && c.email === email) || (phone && c.phone === phone),
    );
    const attrs = (row.attributes as Record<string, unknown>) ?? {};
    if (!found) {
      const id = `c${++this.seq}`;
      this.contacts.push({
        id,
        name: row.name as string | undefined,
        email,
        phone,
        attributes: { ...attrs },
      });
      return out('created', { id });
    }
    let changed = false;
    if (typeof row.name === 'string' && row.name && row.name !== found.name) {
      found.name = row.name;
      changed = true;
    }
    if (email && !found.email) {
      found.email = email;
      changed = true;
    }
    if (phone && !found.phone) {
      found.phone = phone;
      changed = true;
    }
    for (const [k, v] of Object.entries(attrs)) {
      if (JSON.stringify(found.attributes[k]) !== JSON.stringify(v)) {
        found.attributes[k] = v;
        changed = true;
      }
    }
    return out(changed ? 'updated' : 'unchanged', { id: found.id });
  }
}
