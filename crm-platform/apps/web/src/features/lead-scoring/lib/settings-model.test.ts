import type { LscSettings } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { formFromSettings, readiness, settingsDirty, toSettingsInput } from './settings-model';

const settings = (over: Partial<LscSettings> = {}): LscSettings => ({
  enabled: false,
  autoScore: false,
  chatDigest: false,
  stageSuggestions: false,
  chatDigestAvailable: false,
  pendingSuggestions: 0,
  platformEnabled: true,
  model: 'openai/gpt-4o-mini',
  keySource: 'admin',
  eligibleContacts: 10,
  scoredContacts: 4,
  last30d: {
    scores: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: '0',
    avgCostPerScoreUsd: null,
    platformCostUsd: '0',
  },
  rowVersion: null,
  updatedAt: null,
  ...over,
});

describe('toSettingsInput', () => {
  it('sends no rowVersion on the first save (no row yet)', () => {
    const input = toSettingsInput(
      { enabled: true, autoScore: false, chatDigest: false, stageSuggestions: false },
      settings(),
    );
    expect(input).toEqual({ enabled: true, autoScore: false });
    expect('rowVersion' in input).toBe(false);
  });
  it('sends the version it read on every later save', () => {
    expect(
      toSettingsInput(
        { enabled: false, autoScore: true, chatDigest: false, stageSuggestions: false },
        settings({ rowVersion: 4 }),
      ),
    ).toEqual({
      enabled: false,
      autoScore: true,
      rowVersion: 4,
    });
  });
});

describe('form', () => {
  it('starts from the saved settings and tells when it changed', () => {
    const base = formFromSettings(settings({ enabled: true }));
    expect(settingsDirty(base, base)).toBe(false);
    expect(settingsDirty({ ...base, autoScore: true }, base)).toBe(true);
    expect(settingsDirty({ ...base, chatDigest: true }, base)).toBe(true);
    expect(settingsDirty({ ...base, stageSuggestions: true }, base)).toBe(true);
  });
});

describe('reading conversations is a pilot', () => {
  const on = { enabled: true, autoScore: true, chatDigest: true, stageSuggestions: true };
  it('is sent only by a workspace that is offered it', () => {
    expect(toSettingsInput(on, settings({ chatDigestAvailable: false }))).toEqual({
      enabled: true,
      autoScore: true,
    });
    expect(toSettingsInput(on, settings({ chatDigestAvailable: true }))).toEqual({
      enabled: true,
      autoScore: true,
      chatDigest: true,
      stageSuggestions: true,
    });
  });
  it('never sends stage suggestions without the chat reading', () => {
    expect(
      toSettingsInput({ ...on, chatDigest: false }, settings({ chatDigestAvailable: true })),
    ).toMatchObject({ chatDigest: false, stageSuggestions: false });
  });
});

describe('readiness', () => {
  it('puts the platform switch before the key before the workspace switch', () => {
    expect(readiness(settings({ platformEnabled: false, keySource: 'none' }))).toBe('platformOff');
    expect(readiness(settings({ keySource: 'none', enabled: true }))).toBe('noKey');
    expect(readiness(settings({ enabled: false }))).toBe('off');
    expect(readiness(settings({ enabled: true, keySource: 'workspace' }))).toBe('ready');
  });
});
