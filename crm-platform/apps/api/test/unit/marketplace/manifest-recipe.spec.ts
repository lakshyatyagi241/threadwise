import { describe, expect, it } from 'vitest';
import { validateMarketManifest, validateMarketRecipe } from '@crm/contracts';
import {
  integrationManifest,
  miniAppManifest,
  pullRecipe,
  pushRecipe,
  relayRecipe,
} from './fixtures';

const paths = (r: { ok: false; problems: Array<{ path: string }> }) =>
  r.problems.map((p) => p.path);

describe('manifest v1', () => {
  it('accepts a mini app and an integration, and fills the defaults', () => {
    const m = validateMarketManifest(miniAppManifest());
    expect(m.ok).toBe(true);
    const bare = validateMarketManifest(
      miniAppManifest({
        scopes: undefined,
        surfaces: undefined,
        pricing: undefined,
        support: undefined,
        developer: undefined,
      }),
    );
    expect(bare.ok && bare.manifest).toMatchObject({
      scopes: [],
      surfaces: [],
      pricing: { model: 'free' },
      support: {},
    });
    expect(validateMarketManifest(integrationManifest()).ok).toBe(true);
  });

  it('refuses unknown keys (a manifest is data, not a place to hide fields)', () => {
    const r = validateMarketManifest(miniAppManifest({ postInstall: 'rm -rf /' }));
    expect(r.ok).toBe(false);
  });

  it('refuses an unknown or repeated scope', () => {
    const unknown = validateMarketManifest(
      miniAppManifest({ scopes: ['contacts.read', 'root.everything'] }),
    );
    expect(!unknown.ok && paths(unknown)).toContain('scopes.1');
    const twice = validateMarketManifest(
      miniAppManifest({ scopes: ['contacts.read', 'contacts.read'] }),
    );
    expect(twice.ok).toBe(false);
  });

  it('an integration names its connector, a mini app has none, and only a mini app is backed by a module', () => {
    const noConnector = validateMarketManifest(integrationManifest({ connector: undefined }));
    expect(!noConnector.ok && paths(noConnector)).toContain('connector');
    const withConnector = validateMarketManifest(miniAppManifest({ connector: { type: 'push' } }));
    expect(!withConnector.ok && paths(withConnector)).toContain('connector');
    const moduleOnIntegration = validateMarketManifest(
      integrationManifest({ module: 'instagram' }),
    );
    expect(!moduleOnIntegration.ok && paths(moduleOnIntegration)).toContain('module');
    expect(validateMarketManifest(miniAppManifest({ module: 'quotes' })).ok).toBe(true);
  });

  it('slug, version and links follow their rules', () => {
    for (const id of ['Quote', '9quote', 'q', 'quote_panel', `a${'b'.repeat(60)}`]) {
      expect(validateMarketManifest(miniAppManifest({ id })).ok, id).toBe(false);
    }
    for (const version of ['1', '1.0', 'v1.0.0', '1.0.0.0']) {
      expect(validateMarketManifest(miniAppManifest({ version })).ok, version).toBe(false);
    }
    expect(validateMarketManifest(miniAppManifest({ version: '2.1.0-beta.1' })).ok).toBe(true);
    for (const website of [
      'http://example.com',
      'javascript:alert(1)',
      'https://user:pw@example.com',
      'https://',
      'example.com',
    ]) {
      expect(validateMarketManifest(miniAppManifest({ support: { website } })).ok, website).toBe(
        false,
      );
    }
  });

  it('two surfaces of one type and key are refused', () => {
    const s = { type: 'deal_panel', key: 'quote', label: 'Quote' };
    expect(validateMarketManifest(miniAppManifest({ surfaces: [s, s] })).ok).toBe(false);
    expect(
      validateMarketManifest(miniAppManifest({ surfaces: [s, { ...s, key: 'other' }] })).ok,
    ).toBe(true);
  });
});

describe('recipe schema', () => {
  it('accepts one recipe of each connector type that has a fixture', () => {
    for (const r of [relayRecipe(), pushRecipe(), pullRecipe()]) {
      const v = validateMarketRecipe(r);
      expect(v.ok, JSON.stringify(v)).toBe(true);
    }
    const oauth = validateMarketRecipe(
      relayRecipe({
        connector: {
          type: 'oauth',
          authorizeUrl: 'https://accounts.example.com/auth',
          tokenUrl: 'https://accounts.example.com/token',
          scopes: ['read'],
          clientSettingKey: 'acme',
        },
      }),
    );
    expect(oauth.ok).toBe(true);
    const mail = validateMarketRecipe(
      relayRecipe({
        connector: {
          type: 'email_parse',
          senders: ['@portal.example.com'],
          rules: [{ to: 'phone', pattern: 'Mobile:\\s*(\\d+)', required: true }],
        },
      }),
    );
    expect(mail.ok).toBe(true);
  });

  it('a pull recipe maps explicitly, and its placeholders name declared fields', () => {
    const auto = validateMarketRecipe(pullRecipe({ mapping: { mode: 'auto' } }));
    expect(!auto.ok && paths(auto)).toContain('mapping');
    const bad = validateMarketRecipe(
      pullRecipe({
        authFields: [{ key: 'other', label: 'Other', kind: 'secret', required: true }],
      }),
    );
    expect(!bad.ok && bad.problems.some((p) => p.message.includes('{{cred.apiKey}}'))).toBe(true);
    const unknown = validateMarketRecipe(
      pullRecipe({
        connector: {
          ...(pullRecipe().connector as object),
          request: {
            ...(pullRecipe().connector as { request: object }).request,
            query: { a: '{{secret_env}}' },
          },
        },
      }),
    );
    expect(unknown.ok).toBe(false);
  });

  it('refuses addresses that are not a public https host name (SSRF, shape level)', () => {
    const base = (pullRecipe().connector as { request: Record<string, unknown> }).request;
    const withHost = (baseUrl: string) =>
      validateMarketRecipe(
        pullRecipe({
          connector: { ...(pullRecipe().connector as object), request: { ...base, baseUrl } },
        }),
      );
    for (const url of [
      'http://api.portal-example.com',
      'https://169.254.169.254',
      'https://127.0.0.1',
      'https://localhost',
      'https://db.internal',
      'https://api.portal-example.com:8443',
      'https://user:pass@api.portal-example.com',
      'https://api.portal-example.com/path?x=1',
    ]) {
      expect(withHost(url).ok, url).toBe(false);
    }
    expect(withHost('https://api.portal-example.com').ok).toBe(true);
    // The path is a template with no query and no host: it cannot redirect the call elsewhere.
    const path = (p: string) =>
      validateMarketRecipe(
        pullRecipe({
          connector: { ...(pullRecipe().connector as object), request: { ...base, path: p } },
        }),
      );
    expect(path('//evil.example.com/x').ok).toBe(true); // a path, still under the checked host: the host is what is called
    expect(path('v1/x').ok).toBe(false);
    expect(path('/v1/x?a=1').ok).toBe(false);
  });

  it('auth fields: unique keys, a select lists its options, a pattern compiles, the push secret is a secret field', () => {
    const dup = validateMarketRecipe(
      relayRecipe({
        authFields: [
          { key: 'k', label: 'A', kind: 'text' },
          { key: 'k', label: 'B', kind: 'text' },
        ],
      }),
    );
    expect(dup.ok).toBe(false);
    expect(
      validateMarketRecipe(
        relayRecipe({ authFields: [{ key: 'region', label: 'Region', kind: 'select' }] }),
      ).ok,
    ).toBe(false);
    expect(
      validateMarketRecipe(
        relayRecipe({ authFields: [{ key: 'id', label: 'Id', kind: 'text', pattern: '([' }] }),
      ).ok,
    ).toBe(false);
    const notSecret = validateMarketRecipe(
      pushRecipe({
        authFields: [{ key: 'portalKey', label: 'Portal key', kind: 'text', required: true }],
      }),
    );
    expect(notSecret.ok).toBe(false);
  });

  it('mapping rules: one source each, no repeated target, paths without expressions', () => {
    const rule = (r: Record<string, unknown>) =>
      validateMarketRecipe(pushRecipe({ mapping: { mode: 'explicit', fields: [r] } }));
    expect(rule({ to: 'name', from: 'a.b' }).ok).toBe(true);
    expect(rule({ to: 'name' }).ok).toBe(false);
    expect(rule({ to: 'name', from: 'a', const: 'x' }).ok).toBe(false);
    for (const from of ['a..b', '$.a', 'a[x]', 'a;b', '__proto__.x '.trim() + ' '])
      expect(rule({ to: 'name', from }).ok, from).toBe(false);
    const twice = validateMarketRecipe(
      pushRecipe({
        mapping: {
          mode: 'explicit',
          fields: [
            { to: 'name', from: 'a' },
            { to: 'name', from: 'b' },
          ],
        },
      }),
    );
    expect(twice.ok).toBe(false);
  });

  it('an email-parse rule must be a valid regular expression, and an error mapping must match something', () => {
    const mail = (pattern: string) =>
      validateMarketRecipe(
        relayRecipe({
          connector: {
            type: 'email_parse',
            senders: ['@portal.example.com'],
            rules: [{ to: 'phone', pattern }],
          },
        }),
      );
    expect(mail('(\\d+').ok).toBe(false);
    expect(
      validateMarketRecipe(pullRecipe({ errorMapping: [{ code: 'x_y', message: 'm' }] })).ok,
    ).toBe(false);
  });

  it('a test payload is capped at 8 KB', () => {
    const big = validateMarketRecipe(
      relayRecipe({ testPayloads: [{ name: 'big', payload: { text: 'x'.repeat(9000) } }] }),
    );
    expect(big.ok).toBe(false);
  });
});
