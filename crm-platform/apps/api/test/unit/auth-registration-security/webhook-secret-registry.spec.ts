import { describe, expect, it } from 'vitest';
import { WebhookSecretRegistry } from '../../../src/modules/auth/security/webhook-secret-registry';

describe('WebhookSecretRegistry', () => {
  it('reports zero when nothing has registered', async () => {
    expect(await new WebhookSecretRegistry().rotateAll()).toEqual({
      total: 0,
      byRotator: {},
      failed: [],
    });
  });

  it('sums what every registered domain rotated, and keeps going when one fails', async () => {
    const registry = new WebhookSecretRegistry();
    registry.register({ name: 'webhooks', rotateAll: async () => 7 });
    registry.register({
      name: 'shopify',
      rotateAll: async () => {
        throw new Error('boom');
      },
    });
    registry.register({ name: 'woocommerce', rotateAll: async () => 3 });
    expect(await registry.rotateAll()).toEqual({
      total: 10,
      byRotator: { webhooks: 7, woocommerce: 3 },
      failed: ['shopify'],
    });
  });

  it('replaces a rotator registered twice under the same name', async () => {
    const registry = new WebhookSecretRegistry();
    registry.register({ name: 'webhooks', rotateAll: async () => 1 });
    registry.register({ name: 'webhooks', rotateAll: async () => 2 });
    expect(registry.names()).toEqual(['webhooks']);
    expect((await registry.rotateAll()).total).toBe(2);
  });
});
