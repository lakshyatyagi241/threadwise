import { describe, expect, it } from 'vitest';
import {
  FAQ_EMBEDDING_MODELS,
  FAQ_PLATFORM_DEFAULTS,
  ERROR_CODES,
  faqRecommendedThreshold,
  updateFaqPlatformConfigSchema,
  type FaqPlatformConfig,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  LIMIT_RANGES,
  POLL_MS,
  answerRate,
  diffConfig,
  draftFromConfig,
  errorKind,
  fieldErrorsFromApi,
  pollInterval,
  progressPercent,
  riskOf,
} from './logic';
import { overviewSchema } from './queries';

const config: FaqPlatformConfig = {
  ...FAQ_PLATFORM_DEFAULTS,
  defaultThreshold: faqRecommendedThreshold(FAQ_PLATFORM_DEFAULTS.embeddingModel),
  defaultThresholdCustom: false,
  allowedModels: FAQ_EMBEDDING_MODELS.map((m) => ({ ...m })),
};
const overview = (pending: number) => ({
  config,
  platformKeyReady: true,
  stats: {
    workspacesEnabled: 1,
    faqs: 1,
    variations: 3,
    ready: 3 - pending,
    pending,
    failed: 0,
    staleModel: 0,
    matches30d: 0,
    answered30d: 0,
    embeddingTokens30d: 0,
  },
});

describe('diffConfig', () => {
  it('sends nothing when nothing changed (the API rejects an empty body)', () => {
    const r = diffConfig(config, draftFromConfig(config));
    expect(r).toEqual({ ok: true, body: {}, changed: [] });
  });

  it('sends only the fields that changed', () => {
    const d = { ...draftFromConfig(config), maxFaqs: '800', generationModel: ' openai/gpt-4o ' };
    const r = diffConfig(config, d);
    expect(r.ok && r.body).toEqual({ maxFaqs: 800, generationModel: 'openai/gpt-4o' });
    expect(r.changed.sort()).toEqual(['generationModel', 'maxFaqs']);
  });

  it('accepts 0 for the hourly semantic cap (always spelling fallback)', () => {
    const r = diffConfig(config, { ...draftFromConfig(config), semanticPerHour: '0' });
    expect(r.ok && r.body).toEqual({ semanticPerHour: 0 });
  });

  it('reports field problems instead of a body', () => {
    const r = diffConfig(config, {
      ...draftFromConfig(config),
      maxFaqs: '0',
      maxVariationsPerFaq: '12.5',
      generationModel: 'not a model!',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.maxFaqs).toEqual({ kind: 'range', ...LIMIT_RANGES.maxFaqs });
      expect(r.errors.maxVariationsPerFaq).toEqual({ kind: 'integer' });
      expect(r.errors.generationModel).toEqual({ kind: 'modelId' });
    }
  });

  it('fixes a threshold, and hands it back to the model with null', () => {
    const fix = diffConfig(config, {
      ...draftFromConfig(config),
      followModel: false,
      defaultThreshold: 0.6,
    });
    expect(fix.ok && fix.body).toEqual({ defaultThreshold: 0.6 });

    const custom = { ...config, defaultThresholdCustom: true, defaultThreshold: 0.6 };
    expect(diffConfig(custom, draftFromConfig(custom)).changed).toEqual([]);
    const back = diffConfig(custom, { ...draftFromConfig(custom), followModel: true });
    expect(back.ok && back.body).toEqual({ defaultThreshold: null });
  });

  it('leaves a model-following threshold alone while it follows', () => {
    const r = diffConfig(config, { ...draftFromConfig(config), followModel: true });
    expect(r.changed).toEqual([]);
  });

  it('keeps the local ranges equal to the contract schema', () => {
    for (const [key, { min, max }] of Object.entries(LIMIT_RANGES)) {
      const ok = (v: number) => updateFaqPlatformConfigSchema.safeParse({ [key]: v }).success;
      expect(ok(min)).toBe(true);
      expect(ok(max)).toBe(true);
      expect(ok(min - 1)).toBe(false);
      expect(ok(max + 1)).toBe(false);
    }
  });
});

describe('riskOf', () => {
  it('flags turning the engine off and a model change, not turning it on', () => {
    expect(riskOf(config, { engineEnabled: false }).engineOff).toBe(true);
    expect(riskOf({ ...config, engineEnabled: false }, { engineEnabled: true }).engineOff).toBe(
      false,
    );
    expect(riskOf(config, { embeddingModel: 'google/gemini-embedding-2' }).modelChange).toEqual({
      from: config.embeddingModel,
      to: 'google/gemini-embedding-2',
    });
    expect(riskOf(config, { maxFaqs: 3 })).toEqual({ engineOff: false, modelChange: null });
  });
});

describe('polling and progress', () => {
  it('polls every 5 s while vectors wait and stops at zero', () => {
    expect(pollInterval(overview(4))).toBe(POLL_MS);
    expect(POLL_MS).toBe(5000);
    expect(pollInterval(overview(0))).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });
  it('computes ready / (ready + pending)', () => {
    expect(progressPercent({ ready: 3, pending: 1 })).toBe(75);
    expect(progressPercent({ ready: 0, pending: 0 })).toBeNull();
    expect(answerRate(1, 4)).toBe(0.25);
    expect(answerRate(0, 0)).toBeNull();
  });
});

describe('error mapping', () => {
  const api = (
    status: number,
    code: string,
    fields: Array<{ path: string; message: string }> = [],
  ) => new ApiError(status, code, 'x', 'req-1', fields);
  it('branches on code and status, never on text', () => {
    expect(errorKind(api(422, ERROR_CODES.FAQ_MODEL_NOT_ALLOWED))).toBe('modelNotAllowed');
    expect(errorKind(api(422, ERROR_CODES.VALIDATION_FAILED))).toBe('validation');
    expect(errorKind(api(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(errorKind(api(500, 'INTERNAL'))).toBe('unexpected');
    expect(errorKind(api(400, 'UNKNOWN'))).toBe('request');
    expect(errorKind(new TypeError('failed to fetch'))).toBe('network');
  });
  it('maps errors[].path onto form fields and ignores unknown paths', () => {
    const e = api(422, ERROR_CODES.VALIDATION_FAILED, [
      { path: 'maxFaqs', message: 'a' },
      { path: 'nope', message: 'b' },
    ]);
    expect(fieldErrorsFromApi(e)).toEqual({ maxFaqs: { kind: 'invalid' } });
    expect(fieldErrorsFromApi(new Error('x'))).toEqual({});
  });
});

describe('response schema', () => {
  it('parses the overview shape the contract defines', () => {
    expect(overviewSchema.parse(overview(1)).stats.pending).toBe(1);
  });
});
