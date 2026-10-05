import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  GETA_PUBLISH_STEPS,
  GETA_SYNC_STATES,
  NO_GETA_SYNC,
  flowDetailSchema,
  flowGetaSyncSchema,
  getaPublishSettingsSchema,
  parseGetaChatbotRecord,
  setFlowGetaChatbotRequestSchema,
  updateGetaPublishSettingsRequestSchema,
} from '@crm/contracts';

/** Contracts of Geta console publishing. All values are fake. */
const record = {
  id: 'fakeBot1',
  bot_id: '00000000-0000-4000-8000-000000000001',
  name: 'Fake bot \u{1F916}',
  chatbot_status: false,
  extra_unknown_field: { keep: ['me'] },
};

describe('chatbot record parsing', () => {
  it('accepts a bare record and keeps every field, known or not', () => {
    const r = parseGetaChatbotRecord(JSON.stringify(record));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record).toEqual(record);
  });

  it('unwraps a pasted request body { chatbot: {...} }', () => {
    const r = parseGetaChatbotRecord(JSON.stringify({ chatbot: record }));
    expect(r.ok && r.record.id).toBe('fakeBot1');
  });

  it('requires id and bot_id', () => {
    for (const bad of [
      { id: 'x' },
      { bot_id: 'x' },
      { id: '', bot_id: 'x' },
      { id: 1, bot_id: 'x' },
    ]) {
      const r = parseGetaChatbotRecord(JSON.stringify(bad));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses text that is not an object, without echoing it', () => {
    for (const bad of ['', 'not json', '[1]', '"s"', '12', 'null']) {
      const r = parseGetaChatbotRecord(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok && bad.length > 3) expect(r.message).not.toContain(bad);
    }
  });

  it('refuses a record over the size limit', () => {
    const big = JSON.stringify({ ...record, pad: 'x'.repeat(262_200) });
    expect(parseGetaChatbotRecord(big).ok).toBe(false);
  });
});

describe('settings request', () => {
  it('lets every field be left out, set or cleared with null', () => {
    expect(updateGetaPublishSettingsRequestSchema.parse({})).toEqual({});
    const p = updateGetaPublishSettingsRequestSchema.parse({
      baseUrl: 'https://api.example.test',
      authorization: null,
      chatbotRecord: JSON.stringify(record),
    });
    expect(p.authorization).toBeNull();
    expect(p.getaHost).toBeUndefined();
  });

  it('keeps a token exactly as given apart from surrounding whitespace (no Bearer is added)', () => {
    const p = updateGetaPublishSettingsRequestSchema.parse({ authorization: '  Bearer fake-1  ' });
    expect(p.authorization).toBe('Bearer fake-1');
  });

  it('refuses a token with a newline or a non-printable character (header injection)', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\u0000b', 'café', '']) {
      expect(
        updateGetaPublishSettingsRequestSchema.safeParse({ getaHost: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('refuses a base URL that is not a URL', () => {
    expect(updateGetaPublishSettingsRequestSchema.safeParse({ baseUrl: 'geta' }).success).toBe(
      false,
    );
  });

  it('the per-flow record request takes text or null', () => {
    expect(setFlowGetaChatbotRequestSchema.parse({ chatbotRecord: null }).chatbotRecord).toBeNull();
    expect(setFlowGetaChatbotRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('responses', () => {
  it('the settings response has flags and a summary and no field that could hold a secret', () => {
    const shape = Object.keys(getaPublishSettingsSchema.shape).sort();
    expect(shape).toEqual(
      [
        'authorizationSet',
        'baseUrl',
        'chatbot',
        'configured',
        'getaHostSet',
        'mode',
        'origin',
        'updatedAt',
      ].sort(),
    );
  });

  it('the sync state vocabulary', () => {
    expect([...GETA_SYNC_STATES]).toEqual(['none', 'not_configured', 'pending', 'live', 'failed']);
    expect([...GETA_PUBLISH_STEPS]).toEqual(['configuration_update', 'publish_bot']);
    expect(flowGetaSyncSchema.parse(NO_GETA_SYNC)).toEqual(NO_GETA_SYNC);
  });

  it('the flow detail carries the sync as an optional field', () => {
    expect(flowDetailSchema.shape.getaSync.isOptional()).toBe(true);
  });

  it('registers the error codes', () => {
    expect(ERROR_CODES.FLB_GETA_NOT_CONFIGURED).toBe('FLB_GETA_NOT_CONFIGURED');
    expect(ERROR_CODES.FLB_GETA_SETTINGS_INVALID).toBe('FLB_GETA_SETTINGS_INVALID');
    expect(ERROR_CODES.FLB_GETA_NOT_RETRYABLE).toBe('FLB_GETA_NOT_RETRYABLE');
  });
});
