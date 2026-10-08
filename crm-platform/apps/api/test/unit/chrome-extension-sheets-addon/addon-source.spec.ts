import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EXT_SHEETS_FILE_NAMES } from '@crm/contracts';

const DIR = join(__dirname, '..', '..', '..', 'assets', 'google-sheets-addon');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

/** `Code.gs` loaded with no Google services: only its pure helpers are called here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => any;
function load(): Record<string, Fn> {
  const sandbox: Record<string, unknown> = {};
  const exportNames = [
    'maskKey_',
    'isValidKey_',
    'normalizeHeader_',
    'mapHeaders_',
    'rowsFromValues_',
    'chunk_',
    'statusText_',
    'applyResults_',
    'interpretResponse_',
    'describeFailure_',
    'parseRetryAfter_',
    'buildQuery_',
    'contactLine_',
    'contactColumns_',
    'validShopOptions_',
  ];
  // Top-level `const` and `function` of a script are visible to a later script in the same context.
  runInNewContext(`${read('Code.gs')}\nthis.__api = { ${exportNames.join(', ')} };`, sandbox);
  return sandbox.__api as Record<string, Fn>;
}
const api = load();

describe('add-on source folder', () => {
  it('holds exactly the six files the download serves', () => {
    for (const name of EXT_SHEETS_FILE_NAMES) expect(read(name).length).toBeGreaterThan(50);
  });

  it('declares CRM_BASE once, on one line, in the form the download rewrites', () => {
    const code = read('Code.gs');
    const rewrite = /const\s+CRM_BASE\s*=\s*(?:'[^']*'|"[^"]*");/g;
    expect(code.match(rewrite)).toEqual(["const CRM_BASE = 'https://api.example.com';"]);
  });

  it('asks Google for the three narrow scopes only, on the V8 runtime', () => {
    const manifest = JSON.parse(read('appsscript.json')) as {
      runtimeVersion: string;
      oauthScopes: string[];
    };
    expect(manifest.runtimeVersion).toBe('V8');
    expect(manifest.oauthScopes.sort()).toEqual([
      'https://www.googleapis.com/auth/script.container.ui',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/spreadsheets.currentonly',
    ]);
  });

  it('keeps the key out of logs, documents and the dialogs', () => {
    const code = read('Code.gs');
    expect(code).not.toMatch(/Logger\.|console\./);
    expect(code).toMatch(/getUserProperties\(\)/);
    // The document properties hold the shop and never the key (a sheet can be shared).
    expect(code).not.toMatch(/docProps_\(\)\.(?:set|get)Property\(PROP_KEY/);
    for (const page of ['Dialog.html', 'Settings.html', 'Help.html']) {
      expect(read(page)).not.toMatch(/innerHTML|document\.write|eval\(/);
    }
  });
});

describe('key helpers', () => {
  const key = `wsn_live_${'0123456789abcdef'.repeat(2)}`;
  it('masks a key to its prefix and last 8 characters', () => {
    expect(api.maskKey_!(key)).toBe('wsn_live_••••••••89abcdef');
    expect(api.maskKey_!(key)).not.toContain(key.slice(9, 25));
    expect(api.maskKey_!('')).toBe('');
    expect(api.maskKey_!('short')).toBe('');
  });
  it('accepts only a well-formed key, ignoring surrounding spaces', () => {
    expect(api.isValidKey_!(` ${key}\n`)).toBe(true);
    expect(api.isValidKey_!(key.toUpperCase())).toBe(false);
    expect(api.isValidKey_!('wsn_live_abc')).toBe(false);
    expect(api.isValidKey_!(undefined)).toBe(false);
  });
});

describe('header mapping and rows', () => {
  it('matches headers however they are spelled and takes the first match', () => {
    const m = api.mapHeaders_!(
      ['E-mail', 'First name', 'Phone Number', 'attr:city', 'CRM status', 'email'],
      {
        email: ['email'],
        first_name: ['firstname'],
        phone: ['phone', 'phonenumber'],
      },
      true,
    );
    expect(m.columns).toEqual({ email: 0, first_name: 1, phone: 2 });
    expect(m.attributes).toEqual({ city: 3 });
    expect(m.status).toBe(4);
  });

  it('builds contact rows: blanks are left out, dates become text, blank rows are skipped, ref is the sheet row', () => {
    const date = new Date('2026-10-07T09:00:00.000Z');
    const read = api.rowsFromValues_!(
      [
        ['Name', 'Email', 'Phone', 'attr:city', 'Unsubscribed'],
        ['Ann', 'ann@example.com', 9876543210, 'Pune', ''],
        ['', '', '', '', ''],
        ['Raj', '', '+1 415 555 0101', '', 'no'],
        ['Dee', date, '', '', ''],
      ],
      'contacts',
    );
    expect(read.problem).toBe('');
    expect(read.rows).toEqual([
      {
        ref: 2,
        name: 'Ann',
        email: 'ann@example.com',
        phone: 9876543210,
        attributes: { city: 'Pune' },
      },
      { ref: 4, name: 'Raj', phone: '+1 415 555 0101', is_unsubscribed: 'no' },
      { ref: 5, name: 'Dee', email: '2026-10-07T09:00:00.000Z' },
    ]);
  });

  it('refuses a contact sheet without email or phone, and a product sheet without name and price', () => {
    expect(api.rowsFromValues_!([['Name'], ['Ann']], 'contacts').problem).toMatch(/email or phone/);
    expect(
      api.rowsFromValues_!(
        [
          ['name', 'sku'],
          ['Tee', 'T1'],
        ],
        'products',
      ).problem,
    ).toMatch(/name and price/);
    expect(api.rowsFromValues_!([], 'contacts').problem).toMatch(/empty/);
  });

  it('keeps a blank stock cell (unlimited) but leaves other blank product cells out', () => {
    const read = api.rowsFromValues_!(
      [
        ['Name', 'Price', 'SKU', 'Stock', 'Active'],
        ['Tee', 499, '', '', ''],
        ['Cap', '19.99', 'CAP-1', 5, 'no'],
      ],
      'products',
    );
    expect(read.rows).toEqual([
      { ref: 2, name: 'Tee', price: 499, stock: '' },
      { ref: 3, name: 'Cap', price: '19.99', sku: 'CAP-1', stock: 5, active: 'no' },
    ]);
  });

  it('splits rows into chunks of at most the size', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => i);
    expect(api.chunk_!(rows, 500).map((c: number[]) => c.length)).toEqual([500, 500, 201]);
    expect(api.chunk_!([], 500)).toEqual([]);
  });
});

describe('results and totals', () => {
  it('counts each row result, writes a status per sheet row and reports failures with their field', () => {
    const totals = { created: 0, updated: 0, unchanged: 0, failed: 0, notSent: 0 };
    const sent = [{ ref: 2 }, { ref: 3 }, { ref: 5 }, { ref: 6 }];
    const applied = api.applyResults_!(totals, sent, [
      { index: 0, status: 'created' },
      { index: 1, status: 'unchanged' },
      {
        index: 2,
        status: 'failed',
        error: { code: 'VALIDATION_FAILED', message: 'Not a usable phone number.', field: 'phone' },
      },
    ]);
    expect(totals).toEqual({ created: 1, updated: 0, unchanged: 1, failed: 2, notSent: 0 });
    expect(applied.texts).toEqual({
      2: 'created',
      3: 'unchanged',
      5: 'failed: phone: Not a usable phone number.',
      6: 'no result returned',
    });
    expect(applied.problems[0]).toBe('Row 5: phone: Not a usable phone number.');
  });
});

describe('reading answers', () => {
  it('reads a 200 with ok:true as success', () => {
    const r = api.interpretResponse_!(200, '{"ok":true,"x":1}', {});
    expect(r).toMatchObject({ ok: true, data: { x: 1 } });
  });

  it.each([
    [401, 'EXT_KEY_INVALID', /Create a new one/],
    [401, 'EXT_KEY_MISSING', /Settings/],
    [403, 'EXT_APP_NOT_INSTALLED', /admin to install/],
    [413, 'PAYLOAD_TOO_LARGE', /fewer rows/],
  ])('turns %i %s into a readable message', (status, code, text) => {
    const r = api.interpretResponse_!(status, JSON.stringify({ ok: false, code, error: 'x' }), {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
    expect(r.message).toMatch(text);
  });

  it('shows the server sentence for 403 FORBIDDEN and 422, with the field details and request id', () => {
    const r = api.interpretResponse_!(
      422,
      JSON.stringify({
        ok: false,
        code: 'VALIDATION_FAILED',
        error: 'Send at least one row.',
        details: { rows: ['Send at least one row'] },
        requestId: 'req-1',
      }),
      {},
    );
    expect(r).toMatchObject({
      message: 'Send at least one row.',
      details: { rows: ['Send at least one row'] },
      requestId: 'req-1',
    });
    expect(
      api.interpretResponse_!(
        403,
        '{"ok":false,"code":"FORBIDDEN","error":"Your role may not."}',
        {},
      ).message,
    ).toBe('Your role may not.');
  });

  it('reads Retry-After on a 429 in any header case and says how long to wait', () => {
    const r = api.interpretResponse_!(
      429,
      '{"ok":false,"code":"RATE_LIMITED","error":"Slow down"}',
      {
        'retry-after': '17',
      },
    );
    expect(r.retryAfter).toBe(17);
    expect(r.message).toBe('Too many requests. Wait 17 seconds and try again.');
    expect(api.parseRetryAfter_!('abc')).toBe(0);
  });

  it('survives a body that is not JSON', () => {
    const r = api.interpretResponse_!(502, '<html>bad gateway</html>', {});
    expect(r).toMatchObject({ ok: false, code: 'HTTP_502' });
    // 200 without ok:true is a failure too
    expect(api.interpretResponse_!(200, '{"foo":1}', {}).ok).toBe(false);
  });

  it('builds a query string and skips empty values', () => {
    expect(api.buildQuery_!({ limit: 500, cursor: '', q: 'a b' })).toBe('?limit=500&q=a%20b');
    expect(api.buildQuery_!(undefined)).toBe('');
  });
});

describe('contact lines and shop form', () => {
  it('lays out a pulled contact with one column per custom property', () => {
    const contacts = [
      { id: '1', name: 'A', email: 'a@x.co', is_unsubscribed: true, attributes: { city: 'Pune' } },
      { id: '2', attributes: { age: 3, city: 'Goa' } },
    ];
    const keys = api.contactColumns_!(contacts);
    expect(keys).toEqual(['age', 'city']);
    expect(api.contactLine_!(contacts[0], keys)).toEqual([
      '1',
      'A',
      '',
      '',
      'a@x.co',
      '',
      '',
      'yes',
      '',
      '',
      '',
      'Pune',
    ]);
  });

  it('validates the shop form', () => {
    expect(api.validShopOptions_!({ shopName: ' ', currency: 'rupee' }).errors).toEqual({
      shopName: 'Give the shop a name.',
      currency: 'Use a 3-letter currency code such as INR or USD.',
    });
    const ok = api.validShopOptions_!({ shopName: ' Corner ', currency: 'inr' });
    expect(ok.errors).toEqual({});
    expect([ok.name, ok.currency]).toEqual(['Corner', 'INR']);
  });
});
