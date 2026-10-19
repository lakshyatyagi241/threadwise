import { describe, expect, it } from 'vitest';
import type { FaqSettings } from '@crm/contracts';
import {
  activePreset,
  clampBand,
  clampThreshold,
  fallbackInput,
  formFromSettings,
  presetsFor,
  settingsDirty,
  toSettingsInput,
  verifyRange,
} from './settings-model';

const base: FaqSettings = {
  enabled: false,
  threshold: 0.45,
  minMargin: 0,
  logQueries: true,
  verifyMode: 'off',
  verifyBand: 0.1,
  fallbackMessage: null,
  verifyAvailable: true,
  verifyModel: 'openai/gpt-4o-mini',
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
    expect(input).toEqual({
      enabled: true,
      threshold: 0.45,
      minMargin: 0,
      logQueries: true,
      verifyMode: 'off',
      verifyBand: 0.1,
      fallbackMessage: null,
    });
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

describe('the second check', () => {
  it('is part of the form, the dirty check and the saved body', () => {
    const form = formFromSettings({ ...base, verifyMode: 'borderline', verifyBand: 0.2 });
    expect(form).toMatchObject({ verifyMode: 'borderline', verifyBand: 0.2 });
    expect(settingsDirty(form, formFromSettings(base))).toBe(true);
    expect(settingsDirty(form, { ...form, verifyBand: 0.1 })).toBe(true);
    expect(settingsDirty(form, { ...form })).toBe(false);
    // The slider's float noise is not an edit.
    expect(settingsDirty(form, { ...form, verifyBand: 0.2000001 })).toBe(false);
    expect(toSettingsInput(form, { ...base, rowVersion: 2 })).toMatchObject({
      verifyMode: 'borderline',
      verifyBand: 0.2,
      rowVersion: 2,
    });
  });
  it('keeps the band inside what the API accepts, at both edges', () => {
    expect(clampBand(0)).toBe(0.01);
    expect(clampBand(0.01)).toBe(0.01);
    expect(clampBand(0.3)).toBe(0.3);
    expect(clampBand(0.9)).toBe(0.3);
    expect(clampBand(0.1000001)).toBe(0.1);
    const edge = { ...formFromSettings(base), verifyBand: 5 };
    expect(toSettingsInput(edge, base).verifyBand).toBe(0.3);
  });
  it('says which scores are checked: from the bar up to the bar plus the band, at most 100%', () => {
    expect(verifyRange(0.5, 0.1)).toEqual({ from: 50, to: 60 });
    expect(verifyRange(0.45, 0.01)).toEqual({ from: 45, to: 46 });
    expect(verifyRange(0.45, 0.3)).toEqual({ from: 45, to: 75 });
    expect(verifyRange(0.99, 0.3)).toEqual({ from: 99, to: 100 });
    // A band outside the offered range is read as the nearest edge.
    expect(verifyRange(0.5, 0)).toEqual({ from: 50, to: 51 });
  });
});

describe('fallbackInput', () => {
  it('changes only the fallback text and sends it exactly as typed', () => {
    const current = { ...base, rowVersion: 3, threshold: 0.6 };
    const input = fallbackInput(current, ' Sorry,  we did nt get that!! ');
    expect(input.fallbackMessage).toBe(' Sorry,  we did nt get that!! ');
    expect(input).toMatchObject({ threshold: 0.6, rowVersion: 3, enabled: false });
  });
  it('an emptied box removes the fallback', () => {
    expect(fallbackInput({ ...base, fallbackMessage: 'x' }, '').fallbackMessage).toBeNull();
  });
});
