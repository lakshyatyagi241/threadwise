import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { SecurityCenterService } from '../../../src/modules/auth/platform/security-center.service';
import { WebhookSecretRegistry } from '../../../src/modules/auth/security/webhook-secret-registry';
import { startHarness, type Harness } from './harness';

/** The danger-zone rotation reports and audits what registered domains really rotated (TW-AUTH-039). */
let h: Harness;
let operatorId = 0;

beforeAll(async () => {
  h = await startHarness();
  const op = await h.owner.query(`SELECT id FROM platform_operators ORDER BY id LIMIT 1`);
  operatorId = Number(op.rows[0].id);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const asOperator = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    {
      requestId: 'test',
      orgId: 0,
      actorType: 'platform_operator',
      actorId: operatorId,
      userId: null,
      operatorRole: 'super_admin',
    },
    fn,
  );

describe('rotate webhook secrets', () => {
  it('reports 0 and says why while no domain stores webhook secrets', async () => {
    const res = await asOperator(() => h.app.get(SecurityCenterService).rotateWebhookSecrets());
    expect(res).toEqual({ action: 'rotate_webhook_secrets', affected: 0 });
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.security.webhook_secrets_rotated' ORDER BY id DESC LIMIT 1`,
    );
    expect(ev.rows[0].payload.note).toMatch(/no domain/);
  });

  it('rotates what a registered domain owns and audits the per-domain count', async () => {
    let calls = 0;
    h.app.get(WebhookSecretRegistry).register({
      name: 'webhooks',
      rotateAll: async () => {
        calls += 1;
        return 4;
      },
    });
    const res = await asOperator(() => h.app.get(SecurityCenterService).rotateWebhookSecrets());
    expect(res.affected).toBe(4);
    expect(calls).toBe(1);
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.security.webhook_secrets_rotated' ORDER BY id DESC LIMIT 1`,
    );
    expect(ev.rows[0].payload).toMatchObject({ rotated: 4, byRotator: { webhooks: 4 } });
  });
});
