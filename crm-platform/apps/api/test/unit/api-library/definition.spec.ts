import { describe, expect, it } from 'vitest';
import {
  apiLibraryDefinitionTokens,
  apiLibraryIsSensitiveName,
  createApiLibraryApiSchema,
  testApiLibraryApiSchema,
  updateApiLibraryApiSchema,
} from '@crm/contracts';

const ok = {
  name: 'GetOrder',
  method: 'POST',
  url: 'https://api.example.com/orders/{{order_id}}',
  variables: [{ name: 'order_id', defaultValue: '1' }],
  headers: [{ key: 'X-Trace', value: '{{order_id}}' }],
  body: { id: '{{order_id}}' },
};

const problems = (input: unknown) => {
  const r = createApiLibraryApiSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('the definition rules', () => {
  it('accepts a complete definition and applies the defaults', () => {
    const r = createApiLibraryApiSchema.parse(ok);
    expect(r).toMatchObject({ payloadType: 'application/json', functionCode: null, mapping: [] });
    expect(r.headers[0]).toEqual({ key: 'X-Trace', value: '{{order_id}}', secret: false });
  });

  it('names: letters, digits and underscores only', () => {
    expect(problems({ ...ok, name: 'get order' })).toEqual([expect.stringContaining('name:')]);
    expect(problems({ ...ok, name: '' })[0]).toBe('name: API name is required');
    expect(problems({ ...ok, name: 'a'.repeat(65) })).toEqual([expect.stringContaining('name:')]);
  });

  it('methods: GET and DELETE carry no payload, no function and no form data', () => {
    expect(problems({ ...ok, method: 'GET' })).toContain(
      'body: GET requests cannot carry a payload',
    );
    expect(
      problems({
        ...ok,
        method: 'DELETE',
        body: null,
        functionCode: 'function processPayload(p){return p}',
      }),
    ).toEqual(['functionCode: DELETE requests have no payload to process']);
    expect(
      problems({ ...ok, method: 'GET', body: null, payloadType: 'multipart/form-data' }),
    ).toEqual(['payloadType: GET requests cannot use multipart/form-data']);
    expect(
      problems({
        ...ok,
        method: 'GET',
        body: null,
        headers: [],
        url: 'https://x.test/a',
        variables: [],
      }),
    ).toEqual([]);
    expect(problems({ ...ok, method: 'TRACE' })).not.toEqual([]);
  });

  it('every token must be declared with a default', () => {
    expect(problems({ ...ok, variables: [] })).toEqual([
      'variables: Variable "order_id" is used but has no default value',
    ]);
    expect(problems({ ...ok, variables: [{ name: 'order_id', defaultValue: '' }] })).toEqual([
      expect.stringContaining('A default value is required'),
    ]);
    expect(
      problems({
        ...ok,
        variables: [
          { name: 'order_id', defaultValue: '1' },
          { name: 'ORDER_ID', defaultValue: '2' },
        ],
      }),
    ).toEqual([expect.stringContaining('declared twice')]);
    expect(
      apiLibraryDefinitionTokens({
        url: 'https://x/{{ a }}',
        headers: [{ key: 'h', value: '{{b}}', secret: false }],
        body: { k: ['{{c}}', '{{a}}'] },
      }),
    ).toEqual(['a', 'b', 'c']);
  });

  it('url: http or https, a host, no credentials', () => {
    const base = { ...ok, method: 'GET', body: null, headers: [], variables: [] };
    expect(problems({ ...base, url: 'ftp://x.test/a' })).toEqual([
      'url: The URL must start with http:// or https://',
    ]);
    expect(problems({ ...base, url: 'not a url' })).toEqual(['url: A valid URL is required']);
    expect(problems({ ...base, url: 'https://' })).toEqual(['url: A valid URL is required']);
    expect(problems({ ...base, url: 'https://user:pw@x.test/' })).toEqual([
      'url: Put credentials in a header, not in the URL',
    ]);
    expect(problems({ ...base, url: 'http://x.test:8080/a?b=1' })).toEqual([]);
  });

  it('headers: no duplicates, none the server owns, no content-type on form data', () => {
    expect(
      problems({
        ...ok,
        headers: [
          { key: 'X-A', value: '1' },
          { key: 'x-a', value: '2' },
        ],
        variables: [{ name: 'order_id', defaultValue: '1' }],
      }),
    ).toEqual([expect.stringContaining('set twice')]);
    expect(problems({ ...ok, headers: [{ key: 'Host', value: 'x' }] })).toEqual([
      expect.stringContaining('set by the server'),
    ]);
    expect(
      problems({
        ...ok,
        payloadType: 'multipart/form-data',
        body: { a: '{{order_id}}' },
        headers: [{ key: 'Content-Type', value: 'x' }],
      }),
    ).toEqual([expect.stringContaining('multipart/form-data')]);
    expect(problems({ ...ok, headers: [{ key: 'Bad Name', value: 'x' }] })).toEqual([
      expect.stringContaining('Not a valid header name'),
    ]);
  });

  it('payload: form data is text fields; the function must define processPayload', () => {
    expect(problems({ ...ok, payloadType: 'multipart/form-data', body: { a: 1 } })).toEqual([
      'body: Every form field value must be text',
    ]);
    expect(
      problems({
        ...ok,
        payloadType: 'multipart/form-data',
        body: { a: 'x' },
        functionCode: 'function processPayload(p){return p}',
        url: 'https://x.test/a',
        variables: [],
        headers: [],
      }),
    ).toEqual(['functionCode: A processing function works on JSON payloads only']);
    expect(problems({ ...ok, functionCode: 'return 1;' })).toEqual([
      'functionCode: The code must define function processPayload(payload)',
    ]);
    expect(
      problems({ ...ok, functionCode: 'function processPayload(payload) { return payload; }' }),
    ).toEqual([]);
  });

  it('mapping and response variables: valid paths, no repeats', () => {
    expect(problems({ ...ok, mapping: [{ path: 'a..b', contactProperty: 'x' }] })).toEqual([
      expect.stringContaining('Not a valid response path'),
    ]);
    expect(
      problems({
        ...ok,
        mapping: [
          { path: 'a.b', contactProperty: 'x' },
          { path: 'a.b', contactProperty: 'y' },
        ],
      }),
    ).toEqual([expect.stringContaining('mapped twice')]);
    expect(problems({ ...ok, responseVariables: ['data.items[].id', 'data.items[0].id'] })).toEqual(
      [],
    );
  });

  it('update replaces the definition and carries the lock; a test run may omit the name', () => {
    const { name: _n, ...noName } = ok;
    expect(updateApiLibraryApiSchema.safeParse({ ...noName, rowVersion: 2 }).success).toBe(true);
    expect(updateApiLibraryApiSchema.safeParse(noName).success).toBe(false);
    expect(testApiLibraryApiSchema.safeParse(noName).success).toBe(true);
    expect(testApiLibraryApiSchema.safeParse({ ...noName, apiId: 'nope' }).success).toBe(false);
  });
});

describe('secret-looking names', () => {
  it.each([
    'Authorization',
    'X-API-Key',
    'x_api_key',
    'accessToken',
    'client-secret',
    'Cookie',
    'auth',
    'password',
    'Signature',
  ])('%s is secret', (n) => expect(apiLibraryIsSensitiveName(n)).toBe(true));
  it.each(['Accept', 'author', 'Content-Type', 'X-Trace-Id', 'page', 'name'])('%s is not', (n) =>
    expect(apiLibraryIsSensitiveName(n)).toBe(false),
  );
});
