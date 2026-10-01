import { describe, expect, it } from 'vitest';
import type { SocialCaptchaSettingsResponse } from '@crm/contracts';
import {
  buildSocialPatch,
  clearSecretPatch,
  parseThreshold,
  redirectUri,
  socialPatchSize,
  socialToDraft,
} from './social-draft';

const base: SocialCaptchaSettingsResponse = {
  google: { enabled: true, clientId: 'gid', hasSecret: true, live: true },
  facebook: { enabled: false, clientId: '', hasSecret: false, live: false },
  recaptcha: {
    enabled: false,
    version: 'v2',
    siteKey: '',
    hasSecret: false,
    v3Threshold: 0.5,
    live: false,
  },
};

describe('socialToDraft', () => {
  it('never carries a secret into the form', () => {
    const d = socialToDraft(base);
    expect(d.google.clientSecret).toBe('');
    expect(d.recaptcha.secret).toBe('');
    expect(d.google.clientId).toBe('gid');
  });
});

describe('buildSocialPatch', () => {
  it('sends nothing for an untouched form', () => {
    expect(buildSocialPatch(base, socialToDraft(base))).toEqual({
      patch: {},
      problems: {},
      secretsTyped: 0,
    });
  });

  it('keeps a saved secret when the secret field is blank', () => {
    const d = { ...socialToDraft(base), google: { ...socialToDraft(base).google, enabled: false } };
    const { patch } = buildSocialPatch(base, d);
    expect(patch).toEqual({ google: { enabled: false } });
    expect(patch.google).not.toHaveProperty('clientSecret');
  });

  it('sends a secret only when something was typed, trimmed', () => {
    const d = socialToDraft(base);
    d.facebook = { enabled: true, clientId: ' app-1 ', clientSecret: ' s3cret ' };
    const { patch, secretsTyped } = buildSocialPatch(base, d);
    expect(patch.facebook).toEqual({ enabled: true, clientId: 'app-1', clientSecret: 's3cret' });
    expect(secretsTyped).toBe(1);
  });

  it('lets a blank client id clear the stored one', () => {
    const d = socialToDraft(base);
    d.google.clientId = '';
    expect(buildSocialPatch(base, d).patch.google).toEqual({ clientId: '' });
  });

  it('treats a blank threshold as 0.5 and rejects values outside 0 to 1', () => {
    const custom = { ...base, recaptcha: { ...base.recaptcha, v3Threshold: 0.7 } };
    const d = socialToDraft(custom);
    d.recaptcha.v3Threshold = '';
    expect(buildSocialPatch(custom, d).patch.recaptcha).toEqual({ v3Threshold: 0.5 });
    d.recaptcha.v3Threshold = '1.5';
    expect(buildSocialPatch(custom, d).problems['recaptcha.v3Threshold']).toEqual({
      code: 'threshold',
    });
    d.recaptcha.v3Threshold = 'high';
    expect(buildSocialPatch(custom, d).problems['recaptcha.v3Threshold']).toEqual({
      code: 'threshold',
    });
  });

  it('sends the captcha version and keys when they change', () => {
    const d = socialToDraft(base);
    d.recaptcha = {
      ...d.recaptcha,
      enabled: true,
      version: 'v3',
      siteKey: ' site ',
      secret: 'sec',
      v3Threshold: '0.7',
    };
    expect(buildSocialPatch(base, d).patch.recaptcha).toEqual({
      enabled: true,
      version: 'v3',
      siteKey: 'site',
      secret: 'sec',
      v3Threshold: 0.7,
    });
  });

  it('flags values longer than the API accepts', () => {
    const d = socialToDraft(base);
    d.google.clientId = 'x'.repeat(256);
    expect(buildSocialPatch(base, d).problems['google.clientId']).toEqual({
      code: 'tooLong',
      max: 255,
    });
  });
});

describe('parseThreshold', () => {
  it('accepts 0, 1, decimals and a leading dot', () => {
    expect(parseThreshold('0')).toBe(0);
    expect(parseThreshold('1')).toBe(1);
    expect(parseThreshold('0.75')).toBe(0.75);
    expect(parseThreshold('.3')).toBe(0.3);
  });
  it('rejects negatives, junk and out-of-range numbers', () => {
    for (const bad of ['-0.1', '1.01', 'a', '0,5', '1e-1']) expect(parseThreshold(bad)).toBeNull();
  });
});

describe('socialPatchSize / redirectUri', () => {
  it('counts every changed setting', () => {
    expect(
      socialPatchSize({ google: { enabled: true, clientId: 'a' }, recaptcha: { version: 'v3' } }),
    ).toBe(3);
    expect(socialPatchSize({})).toBe(0);
  });
  it('builds the callback address from the page origin', () => {
    expect(redirectUri('https://crm.example.com/', 'google')).toBe(
      'https://crm.example.com/auth/social/google/callback',
    );
    expect(redirectUri('http://localhost:3001', 'facebook')).toBe(
      'http://localhost:3001/auth/social/facebook/callback',
    );
  });
});

describe('clearSecretPatch', () => {
  it('asks the API to delete exactly one saved secret', () => {
    expect(clearSecretPatch('google')).toEqual({ google: { clearSecret: true } });
    expect(clearSecretPatch('facebook')).toEqual({ facebook: { clearSecret: true } });
    expect(clearSecretPatch('recaptcha')).toEqual({ recaptcha: { clearSecret: true } });
  });
  it('is a valid PATCH body', async () => {
    const { socialCaptchaSettingsPatchSchema } = await import('@crm/contracts');
    for (const t of ['google', 'facebook', 'recaptcha'] as const) {
      expect(socialCaptchaSettingsPatchSchema.safeParse(clearSecretPatch(t)).success).toBe(true);
    }
  });
});
