import { describe, expect, it } from 'vitest';
import type { FaqSettings } from '@crm/contracts';
import {
  activePreset,
  clampThreshold,
  formFromSettings,
  presetsFor,
  settingsDirty,
  toSettingsInput,
} from './settings-model';

const base: FaqSettings = {
  enabled: false,
  threshold: 0.45,
  minMargin: 0,
  logQueries: true,
  isDefault: true,
  engineEnabled: true,
  embeddingModel: 'openai/text-embedding-3-large',
  recommendedThreshold: 0.45,
  tunedForModel: null,
  modelChanged: false,
  limits: { maxFaqs: 500, maxVariationsPerFaq: 60 },
  usage: { faqs: 0, variations: 0 },
  rowVersion: null,
  updatedAt: null,
};

describe('toSettingsInput', () => {
  it('the first save sends no rowVersion', () => {
    const input = toSettingsInput({ ...formFromSettings(base), enabled: true }, base);
    expect(input).toEqual({ enabled: true, threshold: 0.45, minMargin: 0, logQueries: true });
    expect('rowVersion' in input).toBe(false);
  });
  it('a later save sends the version it read', () => {
    const input = toSettingsInput(formFromSettings(base), { ...base, rowVersion: 4 });
    expect(input.rowVersion).toBe(4);
  });
  it('rounds slider noise to whole percents', () => {
    expect(
      toSettingsInput(
        { ...formFromSettings(base), threshold: 0.4500000001, minMargin: 0.1000001 },
        base,
      ),
    ).toMatchObject({
      threshold: 0.45,
      minMargin: 0.1,
    });
  });
});

describe('presets', () => {
  it('hang off the recommended value with the stated caps', () => {
    expect(presetsFor(0.45)).toEqual({ strict: 0.55, balanced: 0.45, forgiving: 0.35 });
    expect(presetsFor(0.7)).toEqual({ strict: 0.8, balanced: 0.7, forgiving: 0.6 });
    expect(presetsFor(0.93).strict).toBe(0.95);
    expect(presetsFor(0.25).forgiving).toBe(0.2);
  });
  it('finds the active preset or none for a custom value', () => {
    expect(activePreset(0.55, 0.45)).toBe('strict');
    expect(activePreset(0.45, 0.45)).toBe('balanced');
    expect(activePreset(0.5, 0.45)).toBeNull();
  });
  it('clamps to the range the screens offer and detects changes', () => {
    expect(clampThreshold(2)).toBe(0.99);
    expect(clampThreshold(0)).toBe(0.05);
    expect(
      settingsDirty(formFromSettings(base), { ...formFromSettings(base), logQueries: false }),
    ).toBe(true);
  });
});
