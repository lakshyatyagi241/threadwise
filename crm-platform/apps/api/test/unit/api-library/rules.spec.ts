import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { API_LIBRARY_SECRET_MASK } from '@crm/contracts';
import {
  applyMapping,
  buildMultipart,
  extractByPath,
  logResponseText,
  maskHeaders,
  maskJson,
  maskJsonText,
  maskResponseHeaders,
  maskUrl,
  looksBinary,
  readAnswer,
  scrubSecretHeaders,
  scrubSecretValues,
  secretValuesOf,
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
    // A user and password in the address are hidden in what is stored and shown; the path and query are kept
    expect(maskUrl('https://qauser:FAKE@httpbin.org/basic-auth/qauser/FAKE')).toBe(
      `https://${API_LIBRARY_SECRET_MASK}@httpbin.org/basic-auth/qauser/FAKE`,
    );
    expect(maskUrl('https://u@x.test:8443/p?q=a@b')).toBe(
      `https://${API_LIBRARY_SECRET_MASK}@x.test:8443/p?q=a@b`,
    );
    expect(maskUrl('https://x.test/p/a@b?api_key=K')).toBe(
      `https://x.test/p/a@b?api_key=${API_LIBRARY_SECRET_MASK}`,
    );
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

describe('the answer a log keeps', () => {
  const answer = (bodyText: string, extra: Partial<Parameters<typeof logResponseText>[0]> = {}) =>
    logResponseText({
      bodyText,
      contentType: null,
      headers: {},
      sizeBytes: Buffer.byteLength(bodyText),
      ...extra,
    });

  it('keeps a text answer as it is', () => {
    expect(answer('{"id":7}', { contentType: 'application/json' })).toBe('{"id":7}');
  });

  it('replaces an answer with a NUL character (a binary body) by a note of its size and type', () => {
    const bodyText = '\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR';
    const note = answer(bodyText, { contentType: 'image/png', sizeBytes: 163 });
    expect(note).toBe('[binary answer: 163 bytes, image/png]');
    expect(note).not.toContain('\u0000');
  });

  it('says so when the binary answer names no content type and was sent compressed', () => {
    const note = answer('\u001f\u008b\u0008\u0000\u0000\u0000', {
      sizeBytes: 26,
      headers: { 'content-encoding': 'gzip' },
    });
    expect(note).toBe('[binary answer: 26 bytes, no content type, content-encoding gzip]');
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

describe('readAnswer', () => {
  it('unpacks a gzip answer and counts the real bytes', () => {
    const text = JSON.stringify({ hello: 'world' });
    const out = readAnswer(
      gzipSync(text),
      { 'content-encoding': 'gzip', 'content-type': 'application/json' },
      1 << 20,
    );
    expect(out).toEqual({ text, isText: true, sizeBytes: text.length });
  });

  it('names a file instead of printing it as symbols, with its byte size', () => {
    const png = Buffer.alloc(102_400, 7);
    const out = readAnswer(png, { 'content-type': 'image/png' }, 1 << 20);
    expect(out.isText).toBe(false);
    expect(out.sizeBytes).toBe(102_400);
    expect(out.text).toContain('image/png');
    expect(out.text).toContain('102400 bytes');
  });

  it('treats a NUL byte as binary even with a text type, and plain text as text', () => {
    expect(looksBinary('text/plain', Buffer.from([65, 0, 66]))).toBe(true);
    expect(readAnswer(Buffer.from('plain'), { 'content-type': 'text/plain' }, 100).isText).toBe(
      true,
    );
  });

  it('does not throw on a broken compressed answer', () => {
    const out = readAnswer(Buffer.from('not gzip'), { 'content-encoding': 'gzip' }, 100);
    expect(out.isText).toBe(false);
    expect(out.text).toContain('could not be unpacked');
  });
});

describe('secrets the other server repeats back', () => {
  const url = 'https://httpbin.org/get?api_key=QAFAKEKEY777&token=QAFAKETOK888&page=2';
  const secrets = secretValuesOf(url, [
    { key: 'Authorization', value: 'Bearer abcd1234', secret: true },
    { key: 'Accept', value: 'application/json', secret: false },
  ]);

  it('collects secret query values and secret header values, not ordinary ones', () => {
    expect(secrets).toEqual(
      expect.arrayContaining(['QAFAKEKEY777', 'QAFAKETOK888', 'Bearer abcd1234', 'abcd1234']),
    );
    expect(secrets).not.toContain('2');
    expect(secrets).not.toContain('application/json');
  });

  it('takes the password of an address as a secret, and hides it where the address is repeated', () => {
    const creds = secretValuesOf('https://qauser:QAFAKEPASS9@httpbin.org/basic-auth/qauser/x', []);
    expect(creds).toEqual(['QAFAKEPASS9']);
    expect(
      scrubSecretValues('{"url":"https://qauser:QAFAKEPASS9@httpbin.org"}', creds),
    ).not.toContain('QAFAKEPASS9');
    expect(secretValuesOf('https://httpbin.org/x', [])).toEqual([]);
  });

  it('hides them wherever the reply repeats them, encoded or not', () => {
    const reply = JSON.stringify({
      args: { api_key: 'QAFAKEKEY777', token: 'QAFAKETOK888', page: '2' },
      url: 'https://httpbin.org/get?token=QAFAKETOK888',
      auth: 'Bearer abcd1234',
    });
    const out = scrubSecretValues(reply, secrets);
    expect(out).not.toContain('QAFAKEKEY777');
    expect(out).not.toContain('QAFAKETOK888');
    expect(out).not.toContain('abcd1234');
    expect(out).toContain('"page":"2"');
    expect(
      scrubSecretValues('a%20b%2Bc', secretValuesOf('https://x.test/?token=a%20b%2Bc', [])),
    ).toBe(scrubSecretValues('a%20b%2Bc', ['a b+c']));
  });

  it('hides them in response headers too', () => {
    const h = scrubSecretHeaders(
      { 'x-echo': 'token=QAFAKETOK888', 'content-type': 'application/json' },
      secrets,
    );
    expect(h['x-echo']).not.toContain('QAFAKETOK888');
    expect(h['content-type']).toBe('application/json');
  });
});
