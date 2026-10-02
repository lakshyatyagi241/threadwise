import { describe, expect, it } from 'vitest';
import {
  evaluateSetupPassword,
  isValidLocale,
  isValidTimezone,
  setupBootstrapRequestSchema,
} from '@crm/contracts';
import { setupTokenMatches } from '../../../src/modules/install-update-licensing/setup-token';
import { readInstEnv } from '../../../src/config/domains/install-update-licensing.env';

const TOKEN = 'a'.repeat(32);

const valid = {
  setupToken: TOKEN,
  operator: { fullName: 'Asha Rao', email: 'Owner@Example.com', password: 'Tr1cky-Passphrase!' },
  organization: { name: 'Acme Ltd', slug: 'acme', timezone: 'Asia/Kolkata', locale: 'en' },
};

describe('setup token comparison (WD-INST-001: the gate must be real)', () => {
  it('accepts the exact token and refuses anything else, including prefixes and other lengths', () => {
    expect(setupTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(setupTokenMatches(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(setupTokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(setupTokenMatches('', TOKEN)).toBe(false);
  });
});

describe('first-operator password rule (WD-INST-008: stronger than WaDesk, which accepted anything)', () => {
  it('flags each broken rule', () => {
    expect(evaluateSetupPassword('short')).toEqual(
      expect.arrayContaining(['length', 'upper', 'number', 'symbol']),
    );
    expect(evaluateSetupPassword('alllowercase-but-long1!')).toEqual(['upper']);
    expect(evaluateSetupPassword('NOLOWERCASE-BUT-LONG1!')).toEqual(['lower']);
    expect(evaluateSetupPassword('NoDigitsHere-Long!!')).toEqual(['number']);
    expect(evaluateSetupPassword('NoSymbolsHere12345Ab')).toEqual(['symbol']);
  });

  it('refuses a password built from the person or their email', () => {
    expect(
      evaluateSetupPassword('Asha-Rao-2026!!', { email: 'x@y.com', fullName: 'Asha Rao' }),
    ).toEqual(['personal']);
    expect(evaluateSetupPassword('Mypassw0rd-owner!', { email: 'owner@example.com' })).toEqual([
      'personal',
    ]);
  });

  it('accepts a strong password', () => {
    expect(evaluateSetupPassword('Tr1cky-Passphrase!', { email: 'o@e.com' })).toEqual([]);
  });
});

describe('timezone and locale validation (WD-INST-007: WaDesk validated neither)', () => {
  it('accepts IANA zones and UTC, rejects the rest', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
  it('accepts language tags, rejects garbage', () => {
    expect(isValidLocale('en')).toBe(true);
    expect(isValidLocale('pt-BR')).toBe(true);
    expect(isValidLocale('not a tag')).toBe(false);
  });
});

describe('bootstrap request schema', () => {
  it('lowercases the email and defaults the locale', () => {
    const parsed = setupBootstrapRequestSchema.parse({
      ...valid,
      organization: { ...valid.organization, locale: undefined },
    });
    expect(parsed.operator.email).toBe('owner@example.com');
    expect(parsed.organization.locale).toBe('en');
  });

  it('rejects a short token, a weak password, a bad zone and a bad slug, each at its own path', () => {
    const res = setupBootstrapRequestSchema.safeParse({
      setupToken: 'short',
      operator: { ...valid.operator, password: 'weak' },
      organization: { name: 'A', slug: '!!', timezone: 'Nowhere/Land', locale: 'en' },
    });
    expect(res.success).toBe(false);
    const paths = res.success ? [] : res.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining([
        'setupToken',
        'organization.name',
        'organization.slug',
        'organization.timezone',
      ]),
    );
  });

  it('reports a weak password at operator.password', () => {
    const res = setupBootstrapRequestSchema.safeParse({
      ...valid,
      operator: { ...valid.operator, password: 'weak' },
    });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path.join('.'))).toContain(
      'operator.password',
    );
  });
});

describe('install environment', () => {
  it('treats blank values as unset and defaults demo mode off', () => {
    const env = readInstEnv({ SETUP_TOKEN: '', DEMO_MODE: '', GIT_SHA: ' ' });
    expect(env.SETUP_TOKEN).toBeUndefined();
    expect(env.DEMO_MODE).toBe(false);
    expect(env.GIT_SHA).toBeUndefined();
  });
  it('reads demo mode and the token', () => {
    const env = readInstEnv({ SETUP_TOKEN: TOKEN, DEMO_MODE: 'true' });
    expect(env.SETUP_TOKEN).toBe(TOKEN);
    expect(env.DEMO_MODE).toBe(true);
  });
  it('refuses to start with a guessable token', () => {
    expect(() => readInstEnv({ SETUP_TOKEN: 'letmein' })).toThrow(/SETUP_TOKEN/);
  });
});
