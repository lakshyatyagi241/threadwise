import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { whatsappProviderSchema } from '@crm/contracts';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import { toProvider } from '../../../src/modules/whatsapp-provider-admin/provider.mapper';
import type { ProviderRow } from '../../../src/modules/whatsapp-provider-registry';

const row = (over: Partial<ProviderRow> = {}): ProviderRow => ({
  id: 7,
  uuid: '11111111-1111-4111-8111-111111111111',
  key: 'pinnacle',
  label: 'Pinnacle',
  builtin: null,
  adapter_kind: 'meta_graph',
  base_url: 'https://api.pinnacle.io/wa',
  api_version: 'v24.0',
  auth_scheme: 'custom_headers',
  header_templates: { 'x-api-key': '{{providerToken}}' },
  credential_mode: 'platform_token',
  // The sealed envelope must never reach a response either.
  credentials_enc: 'v1:SEALED-ENVELOPE-aaaa:bbbb:cccc',
  credential_hints: { providerToken: '4321', webhookSecret: '8765' },
  webhook_mode: 'number_level_override',
  signature_scheme: 'shared_secret_header',
  signature_header_name: 'x-bsp-secret',
  billing_mode: 'meta_reseller',
  capabilities: { mediaUpload: true },
  onboarding: 'embedded_signup',
  onboarding_app_id: '123456',
  onboarding_config_id: '654321',
  partner_program: null,
  partner_solution_id: null,
  status: 'active',
  is_default: false,
  notes: null,
  last_test: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-02T00:00:00Z'),
  row_version: 3,
  number_count: 2,
  workspace_count: 1,
  ...over,
});

describe('a provider as the operator API returns it', () => {
  const env = readWabaEnv({
    META_APP_SECRET: 'meta-app-secret-ABCD',
    INTERAKT_PARTNER_AUTH_KEY: 'interakt-partner-key-WXYZ',
    WABA_VERIFY_TOKEN: 'verify-token-1234',
  });

  it('matches the contract and says only whether each secret is set, with its last four characters', () => {
    const out = toProvider(row(), env, '/v2/public/webhooks/whatsapp');
    expect(whatsappProviderSchema.parse(out)).toBeTruthy();
    expect(out.credentials).toEqual({
      providerToken: { set: true, last4: '4321' },
      appSecret: { set: false, last4: null },
      webhookSecret: { set: true, last4: '8765' },
      verifyToken: { set: false, last4: null },
    });
    expect(out.engineBillingMode).toBe('reseller');
    expect(JSON.stringify(out)).not.toContain('SEALED-ENVELOPE');
    expect(JSON.stringify(out)).not.toContain('credentials_enc');
  });

  it('shows the built-in providers from the live WABA settings, not the seeded row, and never the values', () => {
    const meta = toProvider(
      row({
        key: 'meta',
        builtin: 'meta',
        base_url: 'https://seeded.invalid',
        credential_hints: {},
      }),
      env,
      '/w',
    );
    expect(meta.baseUrl).toBe('https://graph.facebook.com');
    expect(meta.credentials.appSecret).toEqual({ set: true, last4: 'ABCD' });
    const interakt = toProvider(
      row({ key: 'interakt', builtin: 'interakt', credential_hints: {} }),
      env,
      '/w',
    );
    expect(interakt.baseUrl).toBe('https://amped-express.interakt.ai/api');
    expect(interakt.credentials.providerToken).toEqual({ set: true, last4: 'WXYZ' });
    for (const out of [meta, interakt]) {
      const text = JSON.stringify(out);
      expect(text).not.toContain('meta-app-secret');
      expect(text).not.toContain('interakt-partner-key');
      expect(text).not.toContain('verify-token-1234');
    }
  });
});

const ZONES = [
  resolve(__dirname, '../../../src/modules/whatsapp-provider-registry'),
  resolve(__dirname, '../../../src/modules/whatsapp-provider-admin'),
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('database access in the provider zones', () => {
  it('never calls the privileged escape hatch or the raw handle: platform data goes through PlatformStore, tenant data through tx', () => {
    const all = ZONES.flatMap(files);
    expect(all.length).toBeGreaterThan(10);
    const offenders = all.filter((f) =>
      /\.privileged\(|\.primary\b|\.replica\b/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
