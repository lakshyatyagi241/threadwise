import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  InvoiceFetchError,
  accessTokenOf,
  accountsBaseOf,
  apiBaseOf,
  fetchInvoices,
  invoiceIdsOf,
  invoicesFetch,
  parseInvoice,
  readInvoices,
} from '../invoices/zoho';

const API = 'https://www.zohoapis.com/billing/v1';
const body = (id: string, over: Record<string, unknown> = {}) => ({
  invoice: {
    invoice_id: id,
    number: 'INV-000123',
    date: '2026-10-15',
    currency_code: 'INR',
    total: 2000,
    status: 'paid',
    html_string: '<html><body>Invoice</body></html>',
    ...over,
  },
});
const json = (status: number, b: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers });
const idOf = (u: string) => u.split('/invoices/')[1]!.split('?')[0]!;
const noSleep = async () => undefined;
const base = {
  token: 'tok_secret',
  organizationId: '60001',
  api: API,
  sleep: noSleep,
  paceMs: 0,
  log: () => undefined,
};

describe('which invoices a client has', () => {
  it('takes the distinct plain-number ids of the wallet events and skips the rest', () => {
    expect(
      invoiceIdsOf([
        { invoice: '3500650000008567084' },
        { invoice: '3500650000008567084' },
        { invoice: null },
        { invoice: '' },
        {},
        { invoice: '../../etc' },
        { invoice: 3500650000008567085 > 0 ? '3500650000008567085' : '' },
      ]),
    ).toEqual({ ids: ['3500650000008567084', '3500650000008567085'], skipped: 1 });
    expect(invoiceIdsOf(undefined)).toEqual({ ids: [], skipped: 0 });
  });
});

describe('what a provider response is worth keeping', () => {
  it('keeps the fields and the HTML', () => {
    expect(parseInvoice('3500650000008567084', body('3500650000008567084'))).toEqual({
      id: '3500650000008567084',
      number: 'INV-000123',
      date: '2026-10-15',
      currency: 'INR',
      total: '2000',
      status: 'paid',
      html: '<html><body>Invoice</body></html>',
    });
  });
  it('refuses another invoice, no HTML, and a body that is not an invoice', () => {
    expect(parseInvoice('3500650000008567084', body('3500650000008567099'))).toBeNull();
    expect(
      parseInvoice('3500650000008567084', body('3500650000008567084', { html_string: '' })),
    ).toBeNull();
    expect(parseInvoice('3500650000008567084', {})).toBeNull();
    expect(parseInvoice('3500650000008567084', null)).toBeNull();
  });
  it('drops a date that is not a day', () => {
    expect(
      parseInvoice('3500650000008567084', body('3500650000008567084', { date: '15/10/2026' }))
        ?.date,
    ).toBeNull();
  });
});

describe('where the token may go', () => {
  it('only to an https zohoapis host', () => {
    expect(apiBaseOf(undefined)).toBe(API);
    expect(apiBaseOf('https://www.zohoapis.in/billing/v1/')).toBe(
      'https://www.zohoapis.in/billing/v1',
    );
    for (const bad of [
      'http://www.zohoapis.com/billing/v1',
      'https://evil.example.com/billing/v1',
      'https://www.zohoapis.com.evil.io/billing/v1',
      'https://user:pw@www.zohoapis.com/billing/v1',
      'https://www.zohoapis.com:8443/billing/v1',
      'not a url',
    ])
      expect(() => apiBaseOf(bad)).toThrow(InvoiceFetchError);
  });
});

describe('fetching', () => {
  it('asks once per id with the token in the header only, and keeps each invoice', async () => {
    const urls: string[] = [];
    const auth: Array<string | undefined> = [];
    const r = await fetchInvoices({
      ...base,
      ids: ['3500650000008567084', '3500650000008567085'],
      fetchFn: (async (u: string, init?: RequestInit) => {
        urls.push(u);
        auth.push((init?.headers as Record<string, string>).Authorization);
        return json(200, body(u.split('/invoices/')[1]!.split('?')[0]!));
      }) as unknown as typeof fetch,
    });
    expect(r.fetched).toBe(2);
    expect(urls[0]).toBe(`${API}/invoices/3500650000008567084?include=html&organization_id=60001`);
    expect(urls.join()).not.toContain('tok_secret');
    expect(auth).toEqual(['Zoho-oauthtoken tok_secret', 'Zoho-oauthtoken tok_secret']);
  });

  it('does not ask again for what it already has, so a run can be resumed', async () => {
    let calls = 0;
    const have = parseInvoice('3500650000008567084', body('3500650000008567084'))!;
    const r = await fetchInvoices({
      ...base,
      ids: ['3500650000008567084'],
      have: [have],
      fetchFn: (async () => {
        calls++;
        return json(200, {});
      }) as unknown as typeof fetch,
    });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ reused: 1, fetched: 0 });
  });

  it('reports a missing invoice and a failed one, keeping the rest', async () => {
    const r = await fetchInvoices({
      ...base,
      ids: ['3500650000008567001', '3500650000008567002', '3500650000008567003'],
      fetchFn: (async (u: string) => {
        if (idOf(u).endsWith('001')) return json(404);
        if (idOf(u).endsWith('002')) return json(400, { message: 'customer@example.com' });
        return json(200, body('3500650000008567003'));
      }) as unknown as typeof fetch,
    });
    expect(r.missing).toEqual(['3500650000008567001']);
    expect(r.failed).toEqual([{ id: '3500650000008567002', status: 400 }]);
    expect(JSON.stringify(r)).not.toContain('customer@example.com');
    expect(r.invoices.map((i) => i.id)).toEqual(['3500650000008567003']);
  });

  it('waits and tries again after a rate limit', async () => {
    let n = 0;
    const waits: number[] = [];
    const r = await fetchInvoices({
      ...base,
      sleep: async (ms) => void waits.push(ms),
      ids: ['3500650000008567084'],
      fetchFn: (async () =>
        ++n === 1
          ? json(429, {}, { 'retry-after': '3' })
          : json(200, body('3500650000008567084'))) as unknown as typeof fetch,
    });
    expect(r.fetched).toBe(1);
    expect(waits).toContain(3000);
  });

  it('stops at a refused token and hands back what it had fetched', async () => {
    let err: InvoiceFetchError | null = null;
    await fetchInvoices({
      ...base,
      ids: ['3500650000008567001', '3500650000008567002'],
      fetchFn: (async (u: string) =>
        idOf(u).endsWith('001')
          ? json(200, body('3500650000008567001'))
          : json(401)) as unknown as typeof fetch,
    }).catch((e) => (err = e));
    expect(err).toBeInstanceOf(InvoiceFetchError);
    expect(String((err as unknown as Error).message)).toContain('INVOICES_UNAUTHORIZED');
    expect((err as unknown as InvoiceFetchError).partial?.map((i) => i.id)).toEqual([
      '3500650000008567001',
    ]);
  });
});

describe('the command', () => {
  const dumps = () => {
    const d = mkdtempSync(join(tmpdir(), 'inv-'));
    mkdirSync(join(d, 'c1'), { recursive: true });
    writeFileSync(
      join(d, 'c1', 'core.json'),
      JSON.stringify({ walletEvents: [{ invoice: '3500650000008567084' }] }),
    );
    return d;
  };
  it('refuses to run without a token', async () => {
    await expect(
      invoicesFetch({ dumpsDir: dumps(), client: 'c1', env: {}, log: () => undefined }),
    ).rejects.toThrow('INVOICES_NO_TOKEN');
  });
  it('writes the file without the token, and the loader reads it back', async () => {
    const d = dumps();
    await invoicesFetch({
      dumpsDir: d,
      client: 'c1',
      env: { ZOHO_ACCESS_TOKEN: 'tok_secret', ZOHO_ORGANIZATION_ID: '60001' },
      fetchFn: (async () => json(200, body('3500650000008567084'))) as unknown as typeof fetch,
      log: () => undefined,
    });
    const raw = readFileSync(join(d, 'c1', 'zoho_invoices.json'), 'utf8');
    expect(raw).not.toContain('tok_secret');
    expect(readInvoices(d, 'c1')).toMatchObject({
      rejected: 0,
      invoices: [{ id: '3500650000008567084' }],
    });
  });
  it('the loader refuses an unfit entry and a missing file', () => {
    const d = dumps();
    writeFileSync(
      join(d, 'c1', 'zoho_invoices.json'),
      JSON.stringify({
        invoices: [
          { id: '3500650000008567084', html: 'ok' },
          { id: '3500650000008567084', html: 'dup' },
          { id: 'x', html: 'bad id' },
          { id: '3500650000008567085', html: '' },
          { id: '3500650000008567086', html: 'nul\u0000' },
        ],
      }),
    );
    expect(readInvoices(d, 'c1')).toMatchObject({ rejected: 4, invoices: [{ html: 'ok' }] });
    expect(() => readInvoices(d, 'nobody')).toThrow('WALLETINVOICES_NO_FILE');
  });
});

describe('the access token of a run (refresh token)', () => {
  const creds = {
    ZOHO_CLIENT_ID: '1000.CLIENT',
    ZOHO_CLIENT_SECRET: 'sec_client_secret',
    ZOHO_REFRESH_TOKEN: '1000.refresh_secret',
  };
  const ok = (calls: Array<{ url: string; body: string }>) =>
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return json(200, { access_token: 'minted_access', expires_in: 3600 });
    }) as unknown as typeof fetch;

  it('uses ZOHO_ACCESS_TOKEN as it is when it is set, and asks nobody', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    expect(await accessTokenOf({ ...creds, ZOHO_ACCESS_TOKEN: ' direct ' }, ok(calls))).toBe(
      'direct',
    );
    expect(calls).toEqual([]);
  });

  it('asks the Zoho login server for a token with the refresh token, in the body only', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    expect(await accessTokenOf(creds, ok(calls))).toBe('minted_access');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://accounts.zoho.com/oauth/v2/token');
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('1000.refresh_secret');
    expect(form.get('client_id')).toBe('1000.CLIENT');
    expect(form.get('client_secret')).toBe('sec_client_secret');
  });

  it('follows ZOHO_ACCOUNTS_URL for another region', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    await accessTokenOf({ ...creds, ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.in/' }, ok(calls));
    expect(calls[0]!.url).toBe('https://accounts.zoho.in/oauth/v2/token');
  });

  it('never sends the secret to a host that is not a Zoho login server', () => {
    for (const bad of [
      'http://accounts.zoho.com',
      'https://accounts.zoho.com.evil.test',
      'https://evil.test/accounts.zoho.com',
      'https://user:pw@accounts.zoho.com',
      'https://accounts.zoho.com:8443',
      'https://accounts.zoho.com/path',
      'https://www.zohoapis.com',
      'not a url',
    ])
      expect(() => accountsBaseOf(bad), bad).toThrow('INVOICES_BAD_ACCOUNTS');
    expect(accountsBaseOf(undefined)).toBe('https://accounts.zoho.com');
  });

  it('says what is missing, and what Zoho refused, without repeating a secret', async () => {
    await expect(accessTokenOf({ ZOHO_CLIENT_ID: 'x' })).rejects.toThrow('INVOICES_NO_TOKEN');
    const refused = (async () => json(400, { error: 'invalid_code' })) as unknown as typeof fetch;
    const err = (await accessTokenOf(creds, refused).catch((e: Error) => e)) as Error;
    expect(err).toBeInstanceOf(InvoiceFetchError);
    expect(err.message).toContain('INVOICES_TOKEN_REFUSED');
    expect(err.message).toContain('invalid_code');
    for (const s of Object.values(creds)) expect(err.message).not.toContain(s);
    const down = (async () => {
      throw new Error('ECONNRESET sec_client_secret');
    }) as unknown as typeof fetch;
    const net = (await accessTokenOf(creds, down).catch((e: Error) => e)) as Error;
    expect(net.message).toContain('INVOICES_TOKEN_NETWORK');
    expect(net.message).not.toContain('sec_client_secret');
  });

  it('invoicesFetch runs on the minted token and writes nothing of the credentials', async () => {
    const d = mkdtempSync(join(tmpdir(), 'inv-'));
    mkdirSync(join(d, 'c1'), { recursive: true });
    writeFileSync(
      join(d, 'c1', 'core.json'),
      JSON.stringify({ walletEvents: [{ invoice: '3500650000008567084' }] }),
    );
    const auth: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/v2/token'))
        return json(200, { access_token: 'minted_access' });
      auth.push(String((init?.headers as Record<string, string>).Authorization));
      return json(200, body('3500650000008567084'));
    }) as unknown as typeof fetch;
    await invoicesFetch({
      dumpsDir: d,
      client: 'c1',
      env: { ...creds, ZOHO_ORGANIZATION_ID: '60001' },
      fetchFn,
      log: () => undefined,
    });
    expect(auth).toEqual(['Zoho-oauthtoken minted_access']);
    const raw = readFileSync(join(d, 'c1', 'zoho_invoices.json'), 'utf8');
    for (const s of [...Object.values(creds), 'minted_access']) expect(raw).not.toContain(s);
  });
});
