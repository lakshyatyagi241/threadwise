import { API_LIBRARY_SECRET_MASK, type ApiLibraryDetail } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildCreate,
  buildTest,
  buildUpdate,
  emptyForm,
  emptyHeader,
  fromDetail,
  fromImport,
  fullSignature,
  headerIsSecret,
  jsonStatus,
  keptSecretsAtRisk,
  originOf,
  requestSignature,
  syncVariables,
  usedTokens,
  type ApiFormState,
} from './form-model';

const form = (over: Partial<ApiFormState> = {}): ApiFormState =>
  syncVariables({ ...emptyForm(), name: 'Orders', url: 'https://api.example.com/x', ...over });

const detail = (over: Partial<ApiLibraryDetail> = {}): ApiLibraryDetail => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Orders',
  method: 'POST',
  url: 'https://api.example.com/orders',
  payloadType: 'application/json',
  hasFunction: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  rowVersion: 3,
  variables: [],
  headers: [],
  body: null,
  functionCode: null,
  mapping: [],
  responseVariables: [],
  createdById: null,
  ...over,
});

describe('variables are declared from the tokens in use', () => {
  it('finds tokens in the URL, header values and a JSON payload', () => {
    const f = form({
      method: 'POST',
      url: 'https://api.example.com/{{order_id}}',
      headers: [{ id: 'h', key: 'X-Tenant', value: '{{tenant}}', secret: false }],
      bodyText: '{"name": "{{name}}", "n": {"x": "{{order_id}}"}}',
    });
    expect(usedTokens(f)).toEqual(['order_id', 'tenant', 'name']);
    expect(f.variables.map((v) => v.name)).toEqual(['order_id', 'tenant', 'name']);
    expect(f.variables.every((v) => v.defaultValue === '')).toBe(true);
  });

  it('keeps the default of a variable that stays and drops one that goes', () => {
    const a = form({ url: 'https://x.test/{{a}}/{{b}}' });
    const withDefault = syncVariables({
      ...a,
      variables: a.variables.map((v) => (v.name === 'a' ? { ...v, defaultValue: '42' } : v)),
    });
    const next = syncVariables({ ...withDefault, url: 'https://x.test/{{a}}' });
    expect(next.variables).toEqual([{ name: 'a', source: 'contact', defaultValue: '42' }]);
  });

  it('matches names ignoring case and reads a dotted name as another API', () => {
    const a = form({ url: 'https://x.test/{{Orders.data.id}}/{{Phone}}' });
    expect(a.variables.map((v) => v.source)).toEqual(['api', 'contact']);
    const b = syncVariables({ ...a, url: 'https://x.test/{{phone}}' });
    expect(b.variables).toHaveLength(1);
  });

  it('scans a payload that is not valid JSON yet as plain text', () => {
    const f = form({ method: 'POST', bodyText: '{"a": "{{x}}", ' });
    expect(usedTokens(f)).toEqual(['x']);
  });

  it('ignores the payload of a GET', () => {
    expect(usedTokens(form({ method: 'GET', bodyText: '{"a": "{{x}}"}' }))).toEqual([]);
  });

  it('returns the same state when nothing changed', () => {
    const a = form({ url: 'https://x.test/{{a}}' });
    expect(syncVariables(a)).toBe(a);
  });
});

describe('validation with the shared rules', () => {
  it('asks for a default value of every variable, on the variable', () => {
    const r = buildCreate(form({ url: 'https://x.test/{{order_id}}' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fields['variable:order_id']).toMatch(/default value/i);
  });

  it('accepts a filled definition and trims the URL', () => {
    const f = form({ url: ' https://x.test/{{id}} ' });
    const r = buildCreate({
      ...f,
      variables: [{ name: 'id', source: 'contact', defaultValue: '1' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.url).toBe('https://x.test/{{id}}');
  });

  it('says why the name or the URL is wrong', () => {
    const r = buildCreate(form({ name: '', url: 'ftp://x.test' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.fields.name).toBeTruthy();
      expect(r.errors.fields.url).toBeTruthy();
    }
  });

  it('reports a payload that is not JSON or not an object', () => {
    const bad = buildCreate(form({ method: 'POST', bodyText: '{"a": ' }));
    expect(!bad.ok && bad.errors.fields.body).toMatch(/valid JSON/);
    const scalar = buildCreate(form({ method: 'POST', bodyText: '5' }));
    expect(!scalar.ok && scalar.errors.fields.body).toMatch(/object or list/);
  });

  it('sends no body for an empty payload and none at all for a GET', () => {
    const post = buildCreate(form({ method: 'POST', bodyText: '  ' }));
    expect(post.ok && post.input.body).toBeNull();
    const get = buildCreate(form({ method: 'GET', bodyText: '{"a":1}' }));
    expect(get.ok && get.input.body).toBeNull();
  });

  it('turns form-data rows into an object of text', () => {
    const f = form({
      method: 'POST',
      payloadType: 'multipart/form-data',
      fieldRows: [
        { id: '1', key: 'a', value: 'x' },
        { id: '2', key: ' ', value: 'dropped' },
      ],
    });
    const r = buildCreate(f);
    expect(r.ok && r.input.body).toEqual({ a: 'x' });
  });

  it('refuses a duplicate header on the right row', () => {
    const f = form({
      headers: [
        { id: 'one', key: 'X-A', value: '1', secret: false },
        { id: 'two', key: 'x-a', value: '2', secret: false },
      ],
    });
    const r = buildCreate(f);
    expect(!r.ok && Object.keys(r.errors.fields)).toEqual(['header:two']);
  });

  it('puts the function only on JSON requests that carry a payload', () => {
    const base = {
      method: 'POST' as const,
      useFunction: true,
      functionCode: 'function processPayload(p){return p}',
    };
    const json = buildCreate(form(base));
    expect(json.ok && json.input.functionCode).toContain('processPayload');
    const get = buildCreate(form({ ...base, method: 'GET' }));
    expect(get.ok && get.input.functionCode).toBeNull();
    const off = buildCreate(form({ ...base, useFunction: false }));
    expect(off.ok && off.input.functionCode).toBeNull();
  });

  it('requires processPayload in the code', () => {
    const r = buildCreate(form({ method: 'POST', useFunction: true, functionCode: 'return 1' }));
    expect(!r.ok && r.errors.fields.functionCode).toMatch(/processPayload/);
  });

  it('flags a mapping path twice and a bad path on its row', () => {
    const f = form({
      mapping: [
        { id: 'm1', path: 'data.id', contactProperty: 'email', defaultValue: '' },
        { id: 'm2', path: 'data.id', contactProperty: 'phone', defaultValue: '' },
        { id: 'm3', path: 'bad path', contactProperty: 'phone', defaultValue: '' },
      ],
    });
    const r = buildCreate(f);
    expect(!r.ok && Object.keys(r.errors.fields).sort()).toEqual(['mapping:m2', 'mapping:m3']);
  });

  it('update carries the row version and has no name', () => {
    const r = buildUpdate(form(), 7);
    expect(r.ok && r.input.rowVersion).toBe(7);
    expect(r.ok && 'name' in r.input).toBe(false);
  });

  it('a test body carries the saved id so a kept secret can be used', () => {
    const r = buildTest(form(), '00000000-0000-4000-8000-000000000001');
    expect(r.ok && r.input.apiId).toBe('00000000-0000-4000-8000-000000000001');
    const anon = buildTest(form({ name: '' }));
    expect(anon.ok && anon.input.name).toBeUndefined();
  });
});

describe('json feedback', () => {
  it.each([
    ['', 'empty'],
    ['  ', 'empty'],
    ['{"a":1}', 'valid'],
    ['[1,2]', 'valid'],
    ['{"a":', 'invalid'],
    ['5', 'shape'],
    ['"x"', 'shape'],
  ])('%j is %s', (text, expected) => expect(jsonStatus(text)).toBe(expected));
});

describe('secrets', () => {
  const saved = detail({
    headers: [
      { key: 'Authorization', value: API_LIBRARY_SECRET_MASK, secret: true },
      { key: 'X-Plain', value: 'ok', secret: false },
    ],
  });

  it('shows a saved secret as the mask and sends the mask back when it is untouched', () => {
    const f = fromDetail(saved);
    expect(f.headers[0]!.value).toBe(API_LIBRARY_SECRET_MASK);
    const r = buildUpdate(f, 3);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.input.headers[0]).toEqual({ key: 'Authorization', value: '********', secret: true });
  });

  it('sends the new value once the person replaces it', () => {
    const f = fromDetail(saved);
    const r = buildUpdate(
      { ...f, headers: f.headers.map((h, i) => (i === 0 ? { ...h, value: 'Bearer new' } : h)) },
      3,
    );
    expect(r.ok && r.input.headers[0]!.value).toBe('Bearer new');
  });

  it('treats a header named like a secret as secret whatever the box says', () => {
    expect(headerIsSecret({ key: 'X-API-Key', secret: false })).toBe(true);
    expect(headerIsSecret({ key: 'X-Plain', secret: false })).toBe(false);
    expect(headerIsSecret({ key: 'X-Plain', secret: true })).toBe(true);
  });

  it('warns only when a kept secret meets a new host', () => {
    const f = fromDetail(saved);
    expect(keptSecretsAtRisk(saved.url, f)).toBe(false);
    expect(keptSecretsAtRisk(saved.url, { ...f, url: 'https://api.example.com/other' })).toBe(
      false,
    );
    expect(keptSecretsAtRisk(saved.url, { ...f, url: 'https://evil.example.net/orders' })).toBe(
      true,
    );
    expect(keptSecretsAtRisk(saved.url, { ...f, url: 'http://api.example.com/orders' })).toBe(true);
    const retyped = {
      ...f,
      url: 'https://evil.example.net/orders',
      headers: f.headers.map((h) => ({ ...h, value: 'new' })),
    };
    expect(keptSecretsAtRisk(saved.url, retyped)).toBe(false);
  });

  it('compares scheme, host and port', () => {
    expect(originOf('HTTPS://Api.Example.com:8443/x?y=1')).toBe('https://api.example.com:8443');
    expect(originOf('{{base}}/x')).toBeNull();
  });
});

describe('loading and importing', () => {
  it('reads a saved JSON API back into the form', () => {
    const f = fromDetail(
      detail({
        body: { name: '{{name}}' },
        variables: [{ name: 'name', source: 'contact', defaultValue: 'Ann' }],
        mapping: [{ path: 'data.id', contactProperty: 'order_id', defaultValue: '' }],
        responseVariables: ['data.id'],
        functionCode: 'function processPayload(p){return p}',
      }),
    );
    expect(JSON.parse(f.bodyText)).toEqual({ name: '{{name}}' });
    expect(f.useFunction).toBe(true);
    expect(f.mapping[0]).toMatchObject({ path: 'data.id', contactProperty: 'order_id' });
    expect(f.responseVariables).toEqual(['data.id']);
  });

  it('reads a saved form-data API into rows', () => {
    const f = fromDetail(detail({ payloadType: 'multipart/form-data', body: { a: 'x', b: 'y' } }));
    expect(f.fieldRows.map((r) => [r.key, r.value])).toEqual([
      ['a', 'x'],
      ['b', 'y'],
    ]);
    expect(f.bodyText).toBe('');
  });

  it('builds a form from an imported request and ticks secret headers', () => {
    const f = fromImport({
      method: 'POST',
      url: 'https://api.example.com/a',
      headers: [
        { key: 'Authorization', value: 'Bearer t' },
        { key: 'Accept', value: 'json' },
      ],
      body: { id: 1 },
      payloadType: 'application/json',
    });
    expect(f.method).toBe('POST');
    expect(f.headers.map((h) => h.secret)).toEqual([true, false]);
    expect(JSON.parse(f.bodyText)).toEqual({ id: 1 });
  });
});

describe('signatures', () => {
  it('a test result stays valid when only the mapping or name changes, and not when the request does', () => {
    const f = form();
    expect(requestSignature({ ...f, name: 'Other' })).toBe(requestSignature(f));
    expect(
      requestSignature({
        ...f,
        mapping: [{ id: 'm', path: 'a', contactProperty: 'b', defaultValue: '' }],
      }),
    ).toBe(requestSignature(f));
    expect(requestSignature({ ...f, url: 'https://api.example.com/y' })).not.toBe(
      requestSignature(f),
    );
    expect(
      requestSignature({ ...f, headers: [{ ...emptyHeader(), key: 'X-A', value: '1' }] }),
    ).not.toBe(requestSignature(f));
  });

  it('the unsaved-changes signature sees every field', () => {
    const f = form();
    expect(fullSignature({ ...f, name: 'Other' })).not.toBe(fullSignature(f));
    expect(fullSignature({ ...f, responseVariables: ['a'] })).not.toBe(fullSignature(f));
    expect(fullSignature(f)).toBe(fullSignature({ ...f }));
  });
});
