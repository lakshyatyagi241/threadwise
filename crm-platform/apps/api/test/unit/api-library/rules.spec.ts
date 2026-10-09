import { describe, expect, it } from 'vitest';
import { API_LIBRARY_SECRET_MASK } from '@crm/contracts';
import {
  applyMapping,
  buildMultipart,
  extractByPath,
  maskHeaders,
  maskJson,
  maskJsonText,
  maskResponseHeaders,
  maskUrl,
  renderBody,
  renderHeaders,
  renderText,
  renderUrl,
  resolveVariables,
  sameOrigin,
  urlWithDefaults,
  responseVariableValues,
  truncateText,
  valueToText,
} from '../../../src/modules/api-library/api-library.rules';

const vars = (o: Record<string, string>) =>
  new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

describe('variable merge', () => {
  const declared = [
    { name: 'order_id', source: 'flow' as const, defaultValue: '1' },
    { name: 'Phone', source: 'contact' as const, defaultValue: '000' },
    { name: 'Orders.data.id', source: 'api' as const, defaultValue: 'x' },
  ];

  it('uses the defaults when nothing else answers', async () => {
    const out = await resolveVariables(declared);
    expect(Object.fromEntries(out)).toEqual({ order_id: '1', phone: '000', 'orders.data.id': 'x' });
  });

  it('prefers an override, then the lookup, then the default; an empty answer counts as none', async () => {
    const out = await resolveVariables(declared, {
      overrides: { ORDER_ID: '42', phone: '' },
      lookup: async (n) => (n === 'Phone' ? '+9199' : n === 'order_id' ? 'from-run' : ''),
    });
    expect(out.get('order_id')).toBe('42');
    expect(out.get('phone')).toBe('+9199');
    expect(out.get('orders.data.id')).toBe('x');
  });
});

describe('rendering', () => {
  const v = vars({ name: 'A & B', id: '7', base: 'https://api.example.com/v1', token: 'T0K' });

  it('percent-encodes values in the path and query but not in the host part', () => {
    expect(renderUrl('{{base}}/orders/{{id}}?name={{name}}', v)).toBe(
      'https://api.example.com/v1/orders/7?name=A%20%26%20B',
    );
    expect(renderUrl('https://{{id}}.example.com/x', v)).toBe('https://7.example.com/x');
  });

  it('fills header values, drops line breaks, and flags secret-looking names', () => {
    const out = renderHeaders(
      [
        { key: 'Authorization', value: 'Bearer {{token}}', secret: false },
        { key: 'X-Note', value: 'a\r\nInjected: 1', secret: false },
        { key: 'X-Plain', value: '{{id}}', secret: false },
      ],
      v,
    );
    expect(out[0]).toEqual({ key: 'Authorization', value: 'Bearer T0K', secret: true });
    expect(out[1]!.value).toBe('a Injected: 1');
    expect(out[2]).toMatchObject({ value: '7', secret: false });
  });

  it('fills every string leaf of a JSON payload and leaves numbers alone', () => {
    expect(renderBody({ a: '{{id}}', n: 5, deep: [{ x: 'k={{name}}' }], ok: true }, v)).toEqual({
      a: '7',
      n: 5,
      deep: [{ x: 'k=A & B' }],
      ok: true,
    });
    expect(renderBody(null, v)).toBeNull();
    expect(renderText('{{missing}}!', v)).toBe('!');
  });

  it('builds a multipart body of text fields', () => {
    const body = buildMultipart({ a: '1', 'b"c': '2' }, 'XYZ');
    expect(body).toBe(
      '--XYZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n' +
        '--XYZ\r\nContent-Disposition: form-data; name="b_c"\r\n\r\n2\r\n--XYZ--\r\n',
    );
  });
});

describe('where a kept secret may go', () => {
  it('compares scheme, host and port, not the path', () => {
    expect(sameOrigin('https://a.test/x?y=1', 'https://a.test/other')).toBe(true);
    expect(sameOrigin('https://a.test/x', 'http://a.test/x')).toBe(false);
    expect(sameOrigin('https://a.test/x', 'https://b.test/x')).toBe(false);
    expect(sameOrigin('https://a.test:8443/x', 'https://a.test/x')).toBe(false);
    expect(sameOrigin('nonsense', 'https://a.test')).toBe(false);
    expect(
      sameOrigin(
        urlWithDefaults('{{base}}/orders', [{ name: 'base', defaultValue: 'https://a.test/v1' }]),
        'https://a.test/other',
      ),
    ).toBe(true);
  });
});

describe('masking', () => {
  it('masks secret headers, secret-looking query parameters and JSON keys', () => {
    expect(
      maskHeaders([
        { key: 'Authorization', value: 'Bearer abc', secret: true },
        { key: 'Accept', value: 'json', secret: false },
      ]),
    ).toEqual({ Authorization: API_LIBRARY_SECRET_MASK, Accept: 'json' });
    expect(maskUrl('https://x.test/p?a=1&api_key=SECRET&token=T#frag')).toBe(
      `https://x.test/p?a=1&api_key=${API_LIBRARY_SECRET_MASK}&token=${API_LIBRARY_SECRET_MASK}#frag`,
    );
    expect(maskUrl('https://x.test/p')).toBe('https://x.test/p');
    expect(
      maskJson({ user: 'u', password: 'p', nested: { accessToken: 't', list: [{ secret: 's' }] } }),
    ).toEqual({
      user: 'u',
      password: API_LIBRARY_SECRET_MASK,
      nested: { accessToken: API_LIBRARY_SECRET_MASK, list: [{ secret: API_LIBRARY_SECRET_MASK }] },
    });
    expect(maskJsonText('not json')).toBe('not json');
    // JSON cut in the middle cannot be parsed: the secret-looking pairs are masked in the text
    expect(
      maskJsonText('{"a":1,"access_token":"abc.def","nested":{"password":12345},"tail":"cut here'),
    ).toBe(
      `{"a":1,"access_token":"${API_LIBRARY_SECRET_MASK}","nested":{"password":"${API_LIBRARY_SECRET_MASK}"},"tail":"cut here`,
    );
    expect(JSON.parse(maskJsonText('{"client_secret":"z","a":1}'))).toEqual({
      client_secret: API_LIBRARY_SECRET_MASK,
      a: 1,
    });
  });

  it('masks cookies and secret-looking response headers, keeps the rest', () => {
    expect(
      maskResponseHeaders({
        'set-cookie': ['a=1', 'b=2'],
        'content-type': 'application/json',
        'x-api-key': 'k',
      }),
    ).toEqual({
      'set-cookie': [API_LIBRARY_SECRET_MASK, API_LIBRARY_SECRET_MASK],
      'content-type': 'application/json',
      'x-api-key': API_LIBRARY_SECRET_MASK,
    });
  });

  it('cuts a long text and says so', () => {
    expect(truncateText('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
    expect(truncateText('abc', 3)).toEqual({ text: 'abc', truncated: false });
  });
});

describe('response paths', () => {
  const body = {
    data: {
      id: 9,
      name: 'Ada',
      tags: ['a', 'b'],
      items: [
        { sku: 'S1', parts: ['p1', 'p2'] },
        { sku: 'S2', parts: ['p3'] },
      ],
    },
    ok: true,
    empty: '',
    nothing: null,
  };

  it('reads one value, one element, and every element', () => {
    expect(extractByPath(body, 'data.id')).toEqual({ found: true, value: 9 });
    expect(extractByPath(body, 'data.items[1].sku')).toEqual({ found: true, value: 'S2' });
    expect(extractByPath(body, 'data.items[].sku')).toEqual({ found: true, value: ['S1', 'S2'] });
    expect(extractByPath(body, 'data.items[].parts[]')).toEqual({
      found: true,
      value: ['p1', 'p2', 'p3'],
    });
    expect(extractByPath(body, 'data.tags.1')).toEqual({ found: true, value: 'b' });
  });

  it('reports a missing path, never throws, and does not read inherited properties', () => {
    expect(extractByPath(body, 'data.nope').found).toBe(false);
    expect(extractByPath(body, 'data.items[5].sku').found).toBe(false);
    expect(extractByPath(body, 'data.id[]').found).toBe(false);
    expect(extractByPath(body, 'a..b').found).toBe(false);
    expect(extractByPath(body, 'data.constructor').found).toBe(false);
    expect(extractByPath(body, '__proto__.x').found).toBe(false);
    expect(extractByPath(null, 'a').found).toBe(false);
  });

  it('writes a value as text: lists of plain values joined, records as JSON', () => {
    expect(valueToText(['a', 2, true])).toBe('a, 2, true');
    expect(valueToText({ a: 1 })).toBe('{"a":1}');
    expect(valueToText(null)).toBe('');
    expect(valueToText(undefined)).toBe('');
    expect(valueToText(12.5)).toBe('12.5');
  });

  it('maps response fields to contact properties, falling back to the default and skipping when there is none', () => {
    const out = applyMapping(
      [
        { path: 'data.name', contactProperty: 'first_name', defaultValue: 'n/a' },
        { path: 'data.missing', contactProperty: 'city', defaultValue: 'Pune' },
        { path: 'empty', contactProperty: 'title', defaultValue: '' },
        { path: 'data.items[].sku', contactProperty: 'skus', defaultValue: '' },
      ],
      body,
    );
    expect(out).toEqual([
      { contactProperty: 'first_name', value: 'Ada', fromDefault: false },
      { contactProperty: 'city', value: 'Pune', fromDefault: true },
      { contactProperty: 'skus', value: 'S1, S2', fromDefault: false },
    ]);
  });

  it('lists the response variables a flow reads as ApiName.path, empty when the answer lacks them', () => {
    expect(responseVariableValues('Orders', ['data.id', 'data.nope', 'data.tags'], body)).toEqual({
      'Orders.data.id': 9,
      'Orders.data.nope': '',
      'Orders.data.tags': ['a', 'b'],
    });
  });
});

describe('numbered pages', () => {
  it('derives the totals: at least one page, hasMore until the last, empty beyond it', async () => {
    const { numberedPage } = await import('../../../src/modules/api-library/api-library.mapper');
    expect(numberedPage(['a', 'b'], 5, 1, 2)).toMatchObject({
      data: ['a', 'b'],
      total: 5,
      pageSize: 2,
      totalPages: 3,
      page: {
        page: 1,
        hasMore: true,
        nextCursor: null,
        total: 5,
        totalPages: 3,
        pageSize: 2,
        limit: 2,
      },
    });
    expect(numberedPage(['e'], 5, 3, 2).page.hasMore).toBe(false);
    expect(numberedPage([], 5, 9, 2)).toMatchObject({ data: [], total: 5, totalPages: 3 });
    expect(numberedPage([], 0, 1, 25)).toMatchObject({ total: 0, totalPages: 1 });
  });
});
