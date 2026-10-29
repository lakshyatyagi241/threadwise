import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * invoices-fetch: the invoices of a client's wallet top-ups, as Waboo's billing provider (Zoho Subscriptions) issued them.
 *
 * Waboo keeps only the provider's invoice id on a top-up and fetches the invoice when the person clicks Download Invoice, so the
 * dump holds none. This reads the ids from dumps/<client>/core.json (`walletEvents[].invoice`), asks the provider for each one
 * (`GET /invoices/<id>?include=html`) and writes dumps/<client>/zoho_invoices.json, which `wallet-invoices` loads.
 *
 * The token is the OPERATOR's: ZOHO_ACCESS_TOKEN (a read-only token for the invoices scope; it lives about an hour) and
 * ZOHO_ORGANIZATION_ID, both from the environment. It is never read from the Waboo database, never logged and never written to the
 * output file, and it is only ever sent to a zohoapis host (a wrong ZOHO_BILLING_API is refused, so the token cannot go elsewhere).
 * Read-only: nothing is created or changed at the provider. Resumable: an invoice already in the output file is not asked for again.
 */
export class InvoiceFetchError extends Error {
  /** what a stopped run had fetched, so it can be kept */
  partial?: ZohoInvoice[];
}

export interface ZohoInvoice {
  /** the provider's id: what a ledger row's `meta.legacy.waboo.invoice` holds */
  id: string;
  number: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  currency: string | null;
  total: string | null;
  status: string | null;
  html: string;
}

export interface FetchedFile {
  fetchedAt: string;
  invoices: ZohoInvoice[];
}

const DEFAULT_API = 'https://www.zohoapis.com/billing/v1';
const HOST = /^([a-z0-9-]+\.)*zohoapis\.(com|in|eu|com\.au|jp|ca|sa|com\.cn)$/;
const ID = /^\d{6,30}$/;
const MAX_HTML = 2_000_000;

/** The provider API base the token may be sent to: https, a zohoapis host, no credentials or odd port in it. */
export function apiBaseOf(raw: string | undefined): string {
  const base = (raw ?? DEFAULT_API).replace(/\/+$/, '');
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new InvoiceFetchError(`INVOICES_BAD_API: ZOHO_BILLING_API is not a URL`);
  }
  if (u.protocol !== 'https:' || !HOST.test(u.hostname) || u.username || u.password || u.port)
    throw new InvoiceFetchError(
      'INVOICES_BAD_API: ZOHO_BILLING_API must be an https zohoapis host (the token is only sent there)',
    );
  return base;
}

/** The distinct invoice ids a core.json names, in first-seen order. Anything that is not a plain number is skipped, not requested. */
export function invoiceIdsOf(events: ReadonlyArray<{ invoice?: unknown }> | undefined): {
  ids: string[];
  skipped: number;
} {
  const seen = new Set<string>();
  let skipped = 0;
  for (const e of events ?? []) {
    const v = e.invoice;
    if (v === undefined || v === null || v === '') continue;
    const id = String(v).trim();
    if (!ID.test(id)) {
      skipped++;
      continue;
    }
    seen.add(id);
  }
  return { ids: [...seen], skipped };
}

const textOf = (v: unknown): string | null =>
  typeof v === 'string' && v.trim()
    ? v.trim().slice(0, 200)
    : typeof v === 'number'
      ? String(v)
      : null;

/** One provider response -> the invoice we keep, or null when it is not the invoice asked for or has no rendered HTML. */
export function parseInvoice(id: string, body: unknown): ZohoInvoice | null {
  const inv = (body as { invoice?: Record<string, unknown> } | null)?.invoice;
  if (!inv || typeof inv !== 'object') return null;
  if (String(inv.invoice_id ?? '') !== id) return null;
  const html = inv.html_string;
  if (typeof html !== 'string' || html.length === 0 || html.length > MAX_HTML) return null;
  const date = textOf(inv.date);
  return {
    id,
    number: textOf(inv.number),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    currency: textOf(inv.currency_code),
    total: inv.total === undefined || inv.total === null ? null : textOf(String(inv.total)),
    status: textOf(inv.status),
    html,
  };
}

export interface FetchOptions {
  ids: string[];
  token: string;
  organizationId: string;
  api: string;
  /** already fetched (a resumed run) */
  have?: ZohoInvoice[];
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  paceMs?: number;
  log: (line: string) => void;
}

export interface FetchResult {
  invoices: ZohoInvoice[];
  fetched: number;
  reused: number;
  /** the provider says there is no such invoice, or it has no HTML */
  missing: string[];
  /** a request that failed for another reason (the status only; the body can hold the customer's details) */
  failed: Array<{ id: string; status: number | 'network' }>;
}

export async function fetchInvoices(o: FetchOptions): Promise<FetchResult> {
  const fetchFn = o.fetchFn ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pace = o.paceMs ?? 300;
  const have = new Map((o.have ?? []).map((i) => [i.id, i]));
  const out: FetchResult = { invoices: [], fetched: 0, reused: 0, missing: [], failed: [] };
  for (const id of o.ids) {
    const kept = have.get(id);
    if (kept) {
      out.invoices.push(kept);
      out.reused++;
      continue;
    }
    const url = `${o.api}/invoices/${id}?include=html&organization_id=${encodeURIComponent(o.organizationId)}`;
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      let res: Response;
      try {
        res = await fetchFn(url, { headers: { Authorization: `Zoho-oauthtoken ${o.token}` } });
      } catch {
        if (attempt === 3) out.failed.push({ id, status: 'network' });
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        const e = new InvoiceFetchError(
          `INVOICES_UNAUTHORIZED: the provider refused the token (${res.status}). It lives about an hour: make a new one, set ZOHO_ACCESS_TOKEN and run again; the invoices fetched so far are kept`,
        );
        e.partial = out.invoices;
        throw e;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 3) out.failed.push({ id, status: res.status });
        const wait = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(wait) && wait > 0 ? wait * 1000 : 2000 * (attempt + 1));
        continue;
      }
      done = true;
      if (res.status === 404) {
        out.missing.push(id);
        break;
      }
      if (!res.ok) {
        out.failed.push({ id, status: res.status });
        break;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* not JSON: treated as missing below */
      }
      const inv = parseInvoice(id, body);
      if (inv) {
        out.invoices.push(inv);
        out.fetched++;
      } else out.missing.push(id);
    }
    if (out.invoices.length % 25 === 0 && out.invoices.length > 0)
      o.log(`  invoices  ${out.invoices.length} of ${o.ids.length}`);
    await sleep(pace);
  }
  return out;
}

/** The invoices of the file that are fit to store; the rest are counted. */
export function readInvoices(
  dumpsDir: string,
  client: string,
): { invoices: ZohoInvoice[]; rejected: number } {
  let file: FetchedFile;
  try {
    file = JSON.parse(
      readFileSync(join(dumpsDir, client, 'zoho_invoices.json'), 'utf8'),
    ) as FetchedFile;
  } catch (e) {
    throw new Error(
      `WALLETINVOICES_NO_FILE: dumps/${client}/zoho_invoices.json is missing or not JSON (run invoices-fetch first): ${(e as Error).message}`,
    );
  }
  const seen = new Set<string>();
  const invoices: ZohoInvoice[] = [];
  let rejected = 0;
  for (const i of file.invoices ?? []) {
    const ok =
      typeof i?.id === 'string' &&
      ID.test(i.id) &&
      !seen.has(i.id) &&
      typeof i.html === 'string' &&
      i.html.length > 0 &&
      i.html.length <= 2_000_000 &&
      !i.html.includes('\u0000');
    if (!ok) {
      rejected++;
      continue;
    }
    seen.add(i.id);
    invoices.push(i);
  }
  return { invoices, rejected };
}

export interface InvoicesFetchOptions {
  dumpsDir: string;
  client: string;
  env: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  log: (line: string) => void;
}

/** The command: core.json -> ids -> provider -> dumps/<client>/zoho_invoices.json. */
export async function invoicesFetch(o: InvoicesFetchOptions): Promise<FetchResult> {
  const token = o.env.ZOHO_ACCESS_TOKEN?.trim();
  const organizationId = o.env.ZOHO_ORGANIZATION_ID?.trim();
  if (!token || !organizationId)
    throw new InvoiceFetchError(
      'INVOICES_NO_TOKEN: set ZOHO_ACCESS_TOKEN (a read-only Zoho Subscriptions token for invoices) and ZOHO_ORGANIZATION_ID',
    );
  const api = apiBaseOf(o.env.ZOHO_BILLING_API);
  const dir = join(o.dumpsDir, o.client);
  let core: { walletEvents?: Array<{ invoice?: unknown }> };
  try {
    core = JSON.parse(readFileSync(join(dir, 'core.json'), 'utf8')) as typeof core;
  } catch (e) {
    throw new InvoiceFetchError(
      `INVOICES_NO_CORE: dumps/${o.client}/core.json is missing or not JSON: ${(e as Error).message}`,
    );
  }
  const { ids, skipped } = invoiceIdsOf(core.walletEvents);
  o.log(
    `  invoices  ${ids.length} invoice id(s) named by the wallet events${skipped ? `; ${skipped} not a plain number, not requested` : ''}`,
  );
  let have: ZohoInvoice[] = [];
  try {
    have = (JSON.parse(readFileSync(join(dir, 'zoho_invoices.json'), 'utf8')) as FetchedFile)
      .invoices;
  } catch {
    /* first run */
  }
  const save = (invoices: ZohoInvoice[]) => {
    mkdirSync(dir, { recursive: true });
    const file: FetchedFile = { fetchedAt: new Date().toISOString(), invoices };
    writeFileSync(join(dir, 'zoho_invoices.json'), JSON.stringify(file));
  };
  try {
    const r = await fetchInvoices({
      ids,
      token,
      organizationId,
      api,
      have,
      fetchFn: o.fetchFn,
      log: o.log,
    });
    save(r.invoices);
    o.log(
      `  invoices  ${r.fetched} fetched, ${r.reused} already in the file, ${r.missing.length} not at the provider, ${r.failed.length} failed -> dumps/${o.client}/zoho_invoices.json`,
    );
    if (r.missing.length > 0) o.log(`  invoices  not found: ${r.missing.slice(0, 20).join(', ')}`);
    if (r.failed.length > 0)
      o.log(
        `  invoices  failed (run again to retry): ${r.failed
          .slice(0, 20)
          .map((f) => `${f.id}:${f.status}`)
          .join(', ')}`,
      );
    return r;
  } catch (e) {
    // an expired token mid-run: keep what the file already had, the run is resumable
    if (e instanceof InvoiceFetchError && (e.partial?.length ?? have.length) > 0)
      save(e.partial ?? have);
    throw e;
  }
}
