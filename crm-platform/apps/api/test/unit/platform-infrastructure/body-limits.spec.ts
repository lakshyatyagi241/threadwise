import { describe, expect, it } from 'vitest';
import { LEAD_HOOK_MAX_BODY_BYTES, MARKET_HOOK_MAX_BYTES } from '@crm/contracts';
import { readInfraEnv } from '../../../src/config/domains/platform-infrastructure.env';
import {
  bodyLimitClasses,
  bodyLimitFor,
  defaultBodyLimitBytes,
} from '../../../src/modules/platform-infrastructure';

const env = readInfraEnv({});
const KIB = 1024;

describe('body limit defaults', () => {
  it('keep the 100 KiB every route had before the setting existed', () => {
    expect(defaultBodyLimitBytes(env)).toBe(100 * KIB);
  });

  it('give the WhatsApp callback 4 MiB and other callbacks 1 MiB', () => {
    expect(bodyLimitFor('/v2/public/webhooks/whatsapp', env)?.bytes).toBe(4096 * KIB);
    expect(bodyLimitFor('/v2/shopify/webhook/abc', env)?.bytes).toBe(1024 * KIB);
  });

  it("take the lead hook and marketplace caps from the domains' own contracts", () => {
    expect(bodyLimitFor('/v2/public/lead-hooks/t', env)?.bytes).toBe(LEAD_HOOK_MAX_BODY_BYTES);
    expect(bodyLimitFor('/v2/public/marketplace/hooks/x', env)?.bytes).toBe(MARKET_HOOK_MAX_BYTES);
  });
});

describe('which paths are in which class', () => {
  // Every callback controller in apps/api today, as the router sees its path (URI version 2, or none).
  it.each([
    ['/v2/public/webhooks/whatsapp', 'whatsapp-webhook'],
    ['/public/webhooks/whatsapp', 'whatsapp-webhook'],
    ['/v2/public/webhooks/invoice-payments/stripe', 'webhook'],
    ['/v2/public/webhooks/wa-calling', 'webhook'],
    ['/v2/webhooks/channels/0b2f/inbound', 'webhook'],
    ['/v2/store-public/webhooks/razorpay', 'webhook'],
    ['/v2/facebook/webhook', 'webhook'],
    ['/v2/instaflow/inbound', 'webhook'],
    ['/v2/telegram/inbound/abc', 'webhook'],
    ['/v2/shopify/webhook/secret', 'webhook'],
    ['/v2/shopify/compliance', 'webhook'],
    ['/v2/woocommerce/webhook/secret', 'webhook'],
    ['/v2/campaigns/node/update-status', 'webhook'],
    ['/google/form-response', 'webhook'],
    ['/v2/public/lead-hooks/tok', 'lead-hook'],
    ['/v2/public/marketplace/hooks/x', 'marketplace-hook'],
  ])('%s is %s', (path, name) => {
    expect(bodyLimitFor(path, env)?.name).toBe(name);
  });

  it.each([
    '/v2/contacts',
    '/v2/flows/12',
    '/v2/auth/login',
    '/v2/public/site-config',
    '/v2/public/webhooks-lookalike',
    '/v2/facebookish/webhook',
    '/v2/inbox/campaigns/node',
    '/health',
    '/',
  ])('%s gets the default limit', (path) => {
    expect(bodyLimitFor(path, env)).toBeUndefined();
  });
});

describe('the classes', () => {
  it('have unique names and no class is smaller than the default (a class exists to raise or pin a cap)', () => {
    const classes = bodyLimitClasses(env);
    expect(new Set(classes.map((c) => c.name)).size).toBe(classes.length);
    for (const c of classes.filter((c) => c.name !== 'marketplace-hook')) {
      expect(c.bytes).toBeGreaterThanOrEqual(defaultBodyLimitBytes(env));
    }
  });

  it('may pin a cap below the default: the marketplace relay keeps its 256 KiB', () => {
    expect(MARKET_HOOK_MAX_BYTES).toBeGreaterThan(defaultBodyLimitBytes(env));
  });
});

describe('body limit settings', () => {
  it('read KiB from the environment', () => {
    const e = readInfraEnv({
      INFRA_BODY_LIMIT_KB: '256',
      INFRA_BODY_LIMIT_WEBHOOK_KB: '2048',
      INFRA_BODY_LIMIT_WHATSAPP_WEBHOOK_KB: '8192',
    });
    expect(defaultBodyLimitBytes(e)).toBe(256 * KIB);
    expect(bodyLimitFor('/v2/shopify/webhook/x', e)?.bytes).toBe(2048 * KIB);
    expect(bodyLimitFor('/v2/public/webhooks/whatsapp', e)?.bytes).toBe(8192 * KIB);
  });

  it('treat empty strings as not set', () => {
    expect(defaultBodyLimitBytes(readInfraEnv({ INFRA_BODY_LIMIT_KB: '' }))).toBe(100 * KIB);
  });

  it.each([['0'], ['-5'], ['abc'], ['10241'], ['1.5']])('refuse %s at boot', (value) => {
    expect(() => readInfraEnv({ INFRA_BODY_LIMIT_KB: value })).toThrow();
  });
});
