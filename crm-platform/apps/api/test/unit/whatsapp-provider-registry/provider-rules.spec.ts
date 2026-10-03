import { describe, expect, it } from 'vitest';
import {
  chooseNewNumberProvider,
  credentialStates,
  mergeSecrets,
  redactSecrets,
  safeTestPath,
} from '../../../src/modules/whatsapp-provider-registry';

describe('which provider a new number goes through (resolver precedence)', () => {
  const setting = 'interakt' as const;

  it('the workspace override wins over the registry default and the platform setting', () => {
    expect(
      chooseNewNumberProvider({
        override: { key: 'pinnacle', status: 'active' },
        registryDefault: { key: 'meta' },
        platformSetting: setting,
      }),
    ).toEqual({ ok: true, source: 'override', key: 'pinnacle' });
  });

  it('without an override the registry default wins over the platform setting', () => {
    expect(
      chooseNewNumberProvider({
        override: null,
        registryDefault: { key: 'meta' },
        platformSetting: setting,
      }),
    ).toEqual({ ok: true, source: 'default', key: 'meta' });
  });

  it('with an empty registry the platform setting decides, exactly as before the registry existed', () => {
    expect(
      chooseNewNumberProvider({ override: null, registryDefault: null, platformSetting: 'meta' }),
    ).toEqual({ ok: true, source: 'platform_setting', key: 'meta' });
    expect(
      chooseNewNumberProvider({ override: null, registryDefault: null, platformSetting: setting }),
    ).toEqual({ ok: true, source: 'platform_setting', key: 'interakt' });
  });

  it('an override that points at a provider that is no longer active is refused, never skipped', () => {
    for (const status of ['disabled', 'archived']) {
      expect(
        chooseNewNumberProvider({
          override: { key: 'pinnacle', status },
          registryDefault: { key: 'meta' },
          platformSetting: setting,
        }),
      ).toEqual({ ok: false, source: 'override', key: 'pinnacle', reason: 'not_active' });
    }
  });
});

describe('provider secrets', () => {
  it('merging keeps what is not sent, replaces what is, and removes what is cleared', () => {
    const current = { providerToken: 'tok-aaaaaaaa1111', appSecret: 'app-bbbbbbbb2222' };
    const merged = mergeSecrets(current, { appSecret: 'app-cccccccc3333' }, ['providerToken']);
    expect(merged.secrets).toEqual({ appSecret: 'app-cccccccc3333' });
    expect(merged.hints).toEqual({ appSecret: '3333' });
    expect(mergeSecrets(current, undefined, undefined).secrets).toEqual(current);
  });

  it('an empty string never overwrites a stored secret', () => {
    expect(
      mergeSecrets({ providerToken: 'tok-aaaaaaaa1111' }, { providerToken: '' }, undefined).secrets,
    ).toEqual({
      providerToken: 'tok-aaaaaaaa1111',
    });
  });

  it('a response says whether a secret is set and its last four characters, never the value', () => {
    const states = credentialStates({ providerToken: '1111' });
    expect(states).toEqual({
      providerToken: { set: true, last4: '1111' },
      appSecret: { set: false, last4: null },
      webhookSecret: { set: false, last4: null },
      verifyToken: { set: false, last4: null },
    });
    expect(JSON.stringify(states)).not.toContain('tok-aaaaaaaa');
  });

  it('redaction removes a secret wherever it appears and leaves short fragments alone', () => {
    const text = 'Invalid token tok-aaaaaaaa1111 for Bearer tok-aaaaaaaa1111; code 190';
    const out = redactSecrets(text, ['tok-aaaaaaaa1111', undefined, 'abc']);
    expect(out).not.toContain('tok-aaaaaaaa1111');
    expect(out).toContain('[redacted]');
    expect(out).toContain('code 190');
  });
});

describe('the test path', () => {
  it.each(['/me', '/v25.0/me', '/health_status'])('accepts %s', (p) => {
    expect(safeTestPath(p)).toBe(p);
  });
  it.each(['me', '/../etc', '//evil.test/x', '/me?x=1', 'https://evil.test/'])(
    'refuses %s',
    (p) => {
      expect(safeTestPath(p)).toBeNull();
    },
  );
});
