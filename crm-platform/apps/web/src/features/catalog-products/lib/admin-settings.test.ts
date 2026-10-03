import { describe, expect, it } from 'vitest';
import type { CatalogSettingsResponse } from '@crm/contracts';
import {
  adminSettingsProblems,
  buildSettingsUpdate,
  formFromSettings,
  type AdminSettingsForm,
} from './admin-settings';

const saved: CatalogSettingsResponse = {
  catalogEnabled: true,
  commerceEnabled: false,
  graphApiVersion: 'v23.0',
  metaAppId: '123',
  metaAppSecretSet: true,
  defaultCurrency: '',
  usage: { workspacesConnected: 2, productsSynced: 5, messagesSent: 9 },
  rowVersion: 4,
};

describe('formFromSettings', () => {
  it('starts from the saved values and shows the default currency when none is saved', () => {
    const f = formFromSettings(saved);
    expect(f).toMatchObject({ graphApiVersion: 'v23.0', defaultCurrency: 'USD', metaAppId: '123' });
    expect(f.metaAppSecret).toBe('');
  });
});

describe('adminSettingsProblems', () => {
  const form = (patch: Partial<AdminSettingsForm>): AdminSettingsForm => ({
    ...formFromSettings(saved),
    ...patch,
  });
  it('accepts vNN.N and a blank version', () => {
    expect(adminSettingsProblems(form({ graphApiVersion: 'v24.0' }))).toEqual([]);
    expect(adminSettingsProblems(form({ graphApiVersion: '' }))).toEqual([]);
  });
  it('refuses a version without the v or the minor part', () => {
    expect(adminSettingsProblems(form({ graphApiVersion: '24' }))).toEqual(['graphVersion']);
    expect(adminSettingsProblems(form({ graphApiVersion: 'v24' }))).toEqual(['graphVersion']);
    expect(adminSettingsProblems(form({ graphApiVersion: 'v123.0' }))).toEqual(['graphVersion']);
  });
  it('wants exactly three letters for the currency', () => {
    expect(adminSettingsProblems(form({ defaultCurrency: 'EU' }))).toEqual(['currency']);
    expect(adminSettingsProblems(form({ defaultCurrency: 'EUR' }))).toEqual([]);
  });
});

describe('buildSettingsUpdate', () => {
  it('sends the toggles, upper-cases the currency and keeps the secret out when it is blank', () => {
    const req = buildSettingsUpdate(
      { ...formFromSettings(saved), defaultCurrency: 'eur', commerceEnabled: true },
      4,
    );
    expect(req).toEqual({
      rowVersion: 4,
      catalogEnabled: true,
      commerceEnabled: true,
      graphApiVersion: 'v23.0',
      defaultCurrency: 'EUR',
      metaAppId: '123',
    });
    expect('metaAppSecret' in req).toBe(false);
  });
  it('sends a typed secret', () => {
    const req = buildSettingsUpdate({ ...formFromSettings(saved), metaAppSecret: ' s3cret ' }, 4);
    expect(req.metaAppSecret).toBe('s3cret');
  });
  it('sends a blank Graph version so the server default applies', () => {
    expect(
      buildSettingsUpdate({ ...formFromSettings(saved), graphApiVersion: ' ' }, 1).graphApiVersion,
    ).toBe('');
  });
});
