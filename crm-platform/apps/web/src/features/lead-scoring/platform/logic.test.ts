import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  LSC_MODELS,
  LSC_PLATFORM_DEFAULTS,
  updateLscPlatformConfigSchema,
  type LscPlatformConfig,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  LIMIT_RANGES,
  OTHER_MODEL,
  diffConfig,
  draftFromConfig,
  durationText,
  errorKind,
  fieldErrorsFromApi,
  knownReason,
  pricePerMillionDigits,
  riskOf,
  usdDigits,
} from './logic';
import { overviewSchema, runsSchema } from './queries';

const config: LscPlatformConfig = {
  ...LSC_PLATFORM_DEFAULTS,
  models: LSC_MODELS.map((m) => ({ ...m })),
};
const totals = {
  scores: 10,
  failed: 1,
  promptTokens: 1000,
  completionTokens: 200,
  costUsd: '0.00123456',
  avgCostPerScoreUsd: '0.00012345',
  platformCostUsd: '0.00100000',
};

describe('diffConfig', () => {
  it('sends nothing when nothing changed (the API rejects an empty body)', () => {
    expect(diffConfig(config, draftFromConfig(config))).toEqual({
      ok: true,
      body: {},
      changed: [],
    });
  });

  it('sends only the fields that changed', () => {
    const d = {
      ...draftFromConfig(config),
      scoresPerHour: '50',
      modelPick: 'inception/mercury-2.5',
    };
    const r = diffConfig(config, d);
    expect(r.ok && r.body).toEqual({ scoresPerHour: 50, model: 'inception/mercury-2.5' });
    expect([...r.changed].sort()).toEqual(['model', 'scoresPerHour']);
  });

  it('accepts 0 for the hourly cap (no limit)', () => {
    const r = diffConfig(config, { ...draftFromConfig(config), scoresPerHour: '0' });
    expect(r.ok && r.body).toEqual({ scoresPerHour: 0 });
  });

  it('sends a typed model id trimmed, and only when it differs', () => {
    const d = { ...draftFromConfig(config), modelPick: OTHER_MODEL, customModel: ' acme/model-x ' };
    expect(diffConfig(config, d).ok && (diffConfig(config, d) as { body: unknown }).body).toEqual({
      model: 'acme/model-x',
    });
    const same = { ...draftFromConfig(config), modelPick: OTHER_MODEL, customModel: config.model };
    expect(diffConfig(config, same)).toEqual({ ok: true, body: {}, changed: [] });
  });

  it('starts on the custom option when the saved model is not on the list', () => {
    const saved = { ...config, model: 'acme/model-x' };
    expect(draftFromConfig(saved)).toMatchObject({
      modelPick: OTHER_MODEL,
      customModel: 'acme/model-x',
    });
    expect(diffConfig(saved, draftFromConfig(saved)).changed).toEqual([]);
  });

  it('reports field problems instead of a body', () => {
    const r = diffConfig(config, {
      ...draftFromConfig(config),
      retentionDays: '3',
      scoresPerHour: '1.5',
      modelPick: OTHER_MODEL,
      customModel: 'not a model!',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.retentionDays).toEqual({ kind: 'range', ...LIMIT_RANGES.retentionDays });
      expect(r.errors.scoresPerHour).toEqual({ kind: 'integer' });
      expect(r.errors.model).toEqual({ kind: 'modelId' });
    }
  });

  it('agrees with the contract schema on the number ranges', () => {
    for (const key of ['scoresPerHour', 'retentionDays'] as const) {
      const { min, max } = LIMIT_RANGES[key];
      expect(updateLscPlatformConfigSchema.safeParse({ [key]: min }).success).toBe(true);
      expect(updateLscPlatformConfigSchema.safeParse({ [key]: max }).success).toBe(true);
      expect(updateLscPlatformConfigSchema.safeParse({ [key]: min - 1 }).success).toBe(false);
      expect(updateLscPlatformConfigSchema.safeParse({ [key]: max + 1 }).success).toBe(false);
    }
  });
});

describe('riskOf', () => {
  it('flags turning the platform on or off, and nothing else', () => {
    expect(riskOf(config, { platformEnabled: true })).toEqual({
      turningOn: true,
      turningOff: false,
    });
    expect(riskOf({ ...config, platformEnabled: true }, { platformEnabled: false })).toEqual({
      turningOn: false,
      turningOff: true,
    });
    expect(riskOf(config, { scoresPerHour: 5 })).toEqual({ turningOn: false, turningOff: false });
  });
});

describe('usdDigits', () => {
  it('never rounds a real cost to zero', () => {
    for (const v of ['0.0001', '0.00012345', '0.00000123', '0.00000001', '0.0123', '12.3']) {
      const shown = Number(Number(v).toFixed(usdDigits(v)));
      expect(shown, v).toBeGreaterThan(0);
    }
  });
  it('uses cents for zero and whole dollars', () => {
    expect(usdDigits('0')).toBe(2);
    expect(usdDigits('0.00000000')).toBe(2);
    expect(usdDigits('42.5')).toBe(2);
  });
  it('shows a typical score cost with six places', () => {
    expect(usdDigits('0.0001')).toBe(6);
  });
});

describe('small helpers', () => {
  it('formats prices per million tokens', () => {
    expect(pricePerMillionDigits(0.1)).toEqual({ min: 2, max: 2 });
    expect(pricePerMillionDigits(0.045)).toEqual({ min: 2, max: 3 });
  });
  it('formats durations', () => {
    expect(durationText(null)).toBeNull();
    expect(durationText(420)).toEqual({ unit: 'ms', value: 420 });
    expect(durationText(1234)).toEqual({ unit: 's', value: 1.2 });
  });
  it('knows the reason codes the API writes', () => {
    expect(knownReason('hourly_limit')).toBe('hourly_limit');
    expect(knownReason('something_new')).toBeNull();
    expect(knownReason(null)).toBeNull();
  });
});

describe('errors', () => {
  it('picks the message from the status and code, never the wording', () => {
    expect(errorKind(new Error('x'))).toBe('network');
    expect(errorKind(new ApiError(403, 'FORBIDDEN', 'x'))).toBe('forbidden');
    expect(errorKind(new ApiError(404, 'NOT_FOUND', 'x'))).toBe('notFound');
    expect(errorKind(new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'x'))).toBe('validation');
    expect(errorKind(new ApiError(400, 'WHATEVER', 'x'))).toBe('request');
    expect(errorKind(new ApiError(500, 'INTERNAL', 'x'))).toBe('unexpected');
  });
  it('maps errors[].path to fields and ignores other paths', () => {
    const e = new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'x', 'r', [
      { path: 'model', message: 'bad' },
      { path: 'nope', message: 'bad' },
    ]);
    expect(fieldErrorsFromApi(e)).toEqual({ model: { kind: 'invalid' } });
    expect(fieldErrorsFromApi(new Error('x'))).toEqual({});
  });
});

describe('response schemas', () => {
  it('accept the contract shapes', () => {
    expect(
      overviewSchema.safeParse({
        config,
        platformKeyReady: true,
        workspacesEnabled: 2,
        contactsScored: 7,
        last24h: totals,
        last30d: { ...totals, avgCostPerScoreUsd: null },
      }).success,
    ).toBe(true);
    expect(
      runsSchema.safeParse({
        data: [
          {
            id: 'r1',
            createdAt: '2026-10-12T10:00:00.000Z',
            contactId: null,
            contactName: null,
            status: 'skipped',
            trigger: 'backfill',
            score: null,
            previousScore: null,
            reasons: [],
            model: null,
            promptTokens: 0,
            completionTokens: 0,
            costUsd: '0.00000000',
            costSource: 'none',
            billedAgainst: 'none',
            durationMs: null,
            error: 'hourly_limit',
            workspaceId: 'w1',
            workspaceName: 'Acme',
          },
        ],
        page: { nextCursor: null, hasMore: false, limit: 25 },
      }).success,
    ).toBe(true);
  });
  it('refuse a cost that is not a decimal string', () => {
    expect(
      overviewSchema.safeParse({
        config,
        platformKeyReady: true,
        workspacesEnabled: 0,
        contactsScored: 0,
        last24h: { ...totals, costUsd: 0.5 },
        last30d: totals,
      }).success,
    ).toBe(false);
  });
});
