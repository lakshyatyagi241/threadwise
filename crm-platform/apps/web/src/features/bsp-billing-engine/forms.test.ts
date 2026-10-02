import { describe, expect, it } from 'vitest';
import type { BspSettingsResponse } from '@crm/contracts';
import { defaultCurrency, optionValue, parseOption } from './lib/attach-form';
import { isDirty, toDraft, toPayload, validateDraft } from './lib/settings-form';

const settings: BspSettingsResponse = {
  businessId: '123',
  extendedCreditId: '',
  tokenSet: true,
  graphVersion: 'v26.0',
  ratesEndpoint: '',
  autoAttach: false,
  autoAttachCurrency: '',
  baseCurrency: 'USD',
  configured: true,
  creditCurrencies: ['AUD', 'EUR', 'GBP', 'IDR', 'INR', 'USD'],
};

describe('connection form', () => {
  it('never sends the token unless one was typed or removal was asked for', () => {
    const d = toDraft(settings);
    expect('systemUserToken' in toPayload(d)).toBe(false);
    expect('clearToken' in toPayload(d)).toBe(false);
    expect(toPayload({ ...d, systemUserToken: ' tok ' }).systemUserToken).toBe('tok');
    expect(toPayload({ ...d, clearToken: true }).clearToken).toBe(true);
  });

  it('flags what the server would refuse', () => {
    const d = toDraft(settings);
    expect(validateDraft(d)).toEqual([]);
    expect(validateDraft({ ...d, graphVersion: '26' })).toContain('graphVersion');
    expect(validateDraft({ ...d, ratesEndpoint: 'http://x.test' })).toContain('ratesEndpoint');
    expect(validateDraft({ ...d, autoAttachCurrency: 'JPY' })).toContain('autoAttachCurrency');
    expect(validateDraft({ ...d, baseCurrency: 'US' })).toContain('baseCurrency');
    expect(validateDraft({ ...d, businessId: '1'.repeat(65) })).toContain('businessId');
  });

  it('knows when nothing changed', () => {
    const d = toDraft(settings);
    expect(isDirty(d, settings)).toBe(false);
    expect(isDirty({ ...d, autoAttach: true }, settings)).toBe(true);
  });
});

describe('attach form', () => {
  it('round-trips the account option and rejects a malformed one', () => {
    const v = optionValue({ workspaceId: 'w1', wabaId: 'b2' });
    expect(parseOption(v)).toEqual({ workspaceId: 'w1', wabaId: 'b2' });
    expect(parseOption('nopipe')).toBeNull();
    expect(parseOption('w1|')).toBeNull();
  });

  it('prefers the workspace currency, then the base, then the first Meta accepts', () => {
    const allowed = ['AUD', 'USD'];
    expect(defaultCurrency({ workspaceCurrency: 'aud' }, 'USD', allowed)).toBe('AUD');
    expect(defaultCurrency({ workspaceCurrency: 'JPY' }, 'USD', allowed)).toBe('USD');
    expect(defaultCurrency(undefined, 'JPY', allowed)).toBe('AUD');
  });
});
