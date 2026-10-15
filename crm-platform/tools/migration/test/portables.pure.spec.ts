import { describe, expect, it } from 'vitest';
import { apiLibrary, chatLabels, outboundWebhooks, waForms } from '../transform/portables';
import type { Ctx } from '../transform/types';

const ctx = { fallbackAt: '2026-06-01T00:00:00.000Z', ref: () => undefined } as unknown as Ctx;
const rowsOf = (o: any) => {
  expect(o.kind).toBe('rows');
  return o.rows[0].row as Record<string, any>;
};
const codes = (o: any): string[] => (o.soft ?? []).map((s: any) => s.code);

describe('whatsapp_flow -> wa_forms', () => {
  const doc = { _id: 'aaaaaaaaaaaaaaaaaaaa1234', name: 'Trip Form!', status: 'PUBLISHED', meta_id: '123', template_flow: { version: '3', screens: [] }, mapping_object: { email: 'email' }, created_time: new Date('2026-02-27') };
  it('loads as an unpublished draft with no Meta id and keeps the raw definition', () => {
    const o = waForms.transform(doc, ctx);
    const r = rowsOf(o);
    expect(r.status).toBe('draft');
    expect(r.slug).toMatch(/^trip-form-[a-z0-9]{6}$/);
    expect(r.definition_json.legacyWaboo.template_flow.version).toBe('3');
    expect(codes(o)).toEqual(expect.arrayContaining(['FORM_NOT_PUBLISHED', 'FORM_DEFINITION_RAW']));
    expect(waForms.tables.wa_forms!.constants).toMatchObject({ meta_flow_id: null, provider_config_id: null, published_at: null });
  });
  it('excludes a deleted form', () => {
    expect(waForms.transform({ ...doc, is_deleted: true }, ctx).kind).toBe('exclude');
  });
});

describe('api_library -> api_library_apis', () => {
  const doc = { _id: 'bbbbbbbbbbbbbbbbbbbb5678', name: 'My API-1', method: 'post', url: 'https://x.test/a?api_key=SECRET&q=1', payload_type: 'application/json', header: { Authorization: 'Bearer ZZZ', 'X-Plain': 'v' }, body: { email: '{{email}}' } };
  it('blanks secrets, sanitizes the name, never copies a secret value', () => {
    const o = apiLibrary.transform(doc, ctx);
    const r = rowsOf(o);
    expect(r.name).toMatch(/^[A-Za-z0-9_]{1,64}$/);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://x.test/a?api_key=&q=1');
    expect(r.headers).toEqual([{ key: 'Authorization', value: '', secret: true }, { key: 'X-Plain', value: 'v', secret: false }]);
    expect(JSON.stringify(o)).not.toContain('ZZZ');
    expect(JSON.stringify(o)).not.toContain('SECRET');
    expect(codes(o)).toEqual(expect.arrayContaining(['API_NAME_CHANGED', 'API_HEADER_SECRET_BLANKED', 'API_URL_SECRET_BLANKED', 'API_TOKENS_UNDECLARED']));
  });
  it('quarantines a method WaDesk does not have', () => {
    expect(apiLibrary.transform({ ...doc, method: 'TRACE' }, ctx).kind).toBe('quarantine');
  });
});

describe('quarantine-only handlers', () => {
  it('webhooks and chatlabels write nothing', () => {
    expect(outboundWebhooks.transform({}, ctx)).toMatchObject({ kind: 'quarantine', code: 'WEBHOOK_URL_NEEDS_ENCRYPTION' });
    expect(chatLabels.transform({}, ctx)).toMatchObject({ kind: 'quarantine', code: 'LABEL_LINK_UNVERIFIED' });
  });
});
