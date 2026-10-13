import { GROWTH_CONFIG_DEFAULTS, GROWTH_FEATURES, type GrowthSettings } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  configFromForm,
  controlsDirty,
  formFromSettings,
  parseCustomPhrases,
  parseServiceRules,
  toSettingsInput,
} from './controls-model';

const settings = (over: Partial<GrowthSettings> = {}): GrowthSettings => ({
  available: true,
  features: Object.fromEntries(
    GROWTH_FEATURES.map((f) => [f, false]),
  ) as GrowthSettings['features'],
  config: GROWTH_CONFIG_DEFAULTS,
  rowVersion: 3,
  enrichmentConfigured: false,
  ...over,
});

describe('service rules', () => {
  it('reads one rule per line, with an optional last number', () => {
    expect(
      parseServiceRules('Battery change | purchase_date | 700 | 760\nService | last_service | 180'),
    ).toEqual({
      rules: [
        { label: 'Battery change', dateField: 'purchase_date', afterDays: 700, untilDays: 760 },
        { label: 'Service', dateField: 'last_service', afterDays: 180 },
      ],
      badLine: null,
    });
  });
  it('names the first line that is not in the form', () => {
    expect(parseServiceRules('ok | d | 1\nnonsense').badLine).toBe(2);
    expect(parseServiceRules('a | b | many').badLine).toBe(1);
    expect(parseServiceRules('').rules).toEqual([]);
  });
});

describe('phrases', () => {
  it('reads phrase = intent and refuses an intent that does not exist', () => {
    expect(parseCustomPhrases('view warranty slip = post_purchase').phrases).toEqual([
      { phrase: 'view warranty slip', intent: 'post_purchase' },
    ]);
    expect(parseCustomPhrases('hello = nothing').badLine).toBe(1);
    expect(parseCustomPhrases('no equals sign').badLine).toBe(1);
  });
});

describe('the form', () => {
  it('round trips the stored settings', () => {
    const s = settings({
      config: {
        ...GROWTH_CONFIG_DEFAULTS,
        statusFields: ['repair_status'],
        serviceRules: [{ label: 'Battery', dateField: 'bought', afterDays: 700, untilDays: 760 }],
        customPhrases: [{ phrase: 'warranty', intent: 'post_purchase' }],
        extraMaskTerms: ['Acme'],
      },
    });
    const f = formFromSettings(s);
    const built = configFromForm(f);
    expect(built.ok && built.config).toEqual(s.config);
    expect(controlsDirty(f, formFromSettings(s))).toBe(false);
  });

  it('refuses numbers outside the contract', () => {
    const f = { ...formFromSettings(settings()), hotLeadConfidence: '0.1' };
    expect(configFromForm(f)).toEqual({ ok: false, problem: { field: 'numbers' } });
  });

  it('saves only the switches that changed and no config when no threshold changed', () => {
    const s = settings();
    const base = formFromSettings(s);
    const form = { ...base, features: { ...base.features, quality: true } };
    const r = toSettingsInput(form, base, s);
    expect(r).toEqual({ ok: true, input: { rowVersion: 3, features: { quality: true } } });
  });

  it('sends the whole configuration when a threshold changed', () => {
    const s = settings();
    const base = formFromSettings(s);
    const r = toSettingsInput({ ...base, lapsedDays: '90' }, base, s);
    expect(r.ok && r.input.config?.lapsedDays).toBe(90);
    expect(r.ok && r.input.features).toBeUndefined();
  });
});
