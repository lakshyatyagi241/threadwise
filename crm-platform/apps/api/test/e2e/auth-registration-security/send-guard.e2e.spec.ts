import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../../../src/infra/providers/whatsapp/whatsapp.port';
import { EmergencyHaltService } from '../../../src/modules/auth/security/emergency-halt.service';
import { SecurityPolicyService } from '../../../src/modules/auth/platform/security-policy.service';
import { startHarness, type Harness } from './harness';

/**
 * The provider boundary enforces the emergency halt and the send guardrails
 * (WD-AUTH-040/041): no pipeline can reach Meta without passing them.
 */
let h: Harness;
let operatorId = 0;

const credentials = { senderId: '1000', accessToken: 'x' };
const inTenant = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'test', orgId: 1, actorType: 'user', actorId: 1, userId: 1 },
    fn,
  );

const provider = () => h.app.get<WhatsAppProvider>(WHATSAPP_PROVIDER);
const text = (body: string, screen?: { bulk?: boolean; source?: string }) =>
  inTenant(() =>
    provider().sendText(credentials, { to: '+14155550100', body, clientReference: 'r', screen }),
  );

/** Meta's Graph API, stood in for: a send that gets past the guard reaches this and is accepted. */
const graphCalls = vi.fn();
beforeEach(() => {
  graphCalls.mockClear();
  vi.stubGlobal('fetch', async (input: unknown, init?: unknown) => {
    graphCalls(input, init);
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.stub' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Resolves when the send reached the provider (the stub answered); a guard refusal rejects before any call. */
const reached = async (send: Promise<unknown>) => {
  const before = graphCalls.mock.calls.length;
  await expect(send).resolves.toBeTruthy();
  expect(graphCalls.mock.calls.length).toBe(before + 1);
};

beforeAll(async () => {
  h = await startHarness();
  const op = await h.owner.query(`SELECT id FROM platform_operators ORDER BY id LIMIT 1`);
  operatorId = Number(op.rows[0].id);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

async function policy(patch: Record<string, unknown>) {
  await h.app.get(SecurityPolicyService).patchPolicy(patch as never, operatorId);
}

describe('outbound send guard at the provider boundary', () => {
  it('lets a send through to the provider when nothing is configured', async () => {
    await reached(text('hello'));
  });

  it('stops every send at the provider while the emergency halt is on, and resumes after', async () => {
    const halt = h.app.get(EmergencyHaltService);
    await halt.set(true, operatorId);
    try {
      await expect(text('hello')).rejects.toMatchObject({ code: 'AUTH_SEND_HALTED' });
      await expect(
        inTenant(() =>
          provider().sendTemplate(credentials, {
            to: '+14155550100',
            templateName: 't',
            language: 'en',
            variables: { a: 'b' },
            clientReference: 'r',
            screen: { bulk: true, source: 'broadcast' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'AUTH_SEND_HALTED' });
    } finally {
      await halt.set(false, operatorId);
    }
    expect(graphCalls).not.toHaveBeenCalled();
    await reached(text('hello'));
  });

  it('screens content and per-minute rate in enforce mode, and bulk skips the rate cap', async () => {
    await policy({
      waGuardrailsMode: 'enforce',
      abuseBlockKeywordList: ['lottery'],
      waMaxSendsPerMinute: 2,
    });
    try {
      await expect(text('You won the lottery')).rejects.toMatchObject({
        code: 'AUTH_SEND_BLOCKED',
      });
      // Two sends fit the cap and reach the provider; the third is refused.
      await reached(text('one'));
      await reached(text('two'));
      await expect(text('three')).rejects.toMatchObject({ code: 'AUTH_SEND_BLOCKED' });
      // A bulk batch is screened for content and the halt, not counted per message.
      await reached(text('four', { bulk: true, source: 'broadcast' }));
      const blocked = await h.owner.query(
        `SELECT payload ->> 'reason' AS reason FROM security_events WHERE event = 'security.send_blocked' ORDER BY id`,
      );
      expect(blocked.rows.map((r) => r.reason)).toEqual(['keyword', 'rate_per_minute']);
    } finally {
      await policy({ waGuardrailsMode: 'off', abuseBlockKeywordList: [], waMaxSendsPerMinute: 0 });
    }
  });
});
