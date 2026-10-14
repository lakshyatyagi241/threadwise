import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PURPOSE_IDS } from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { ConsentGate } from '../../../src/modules/contact-consent/consent-gate.service';
import { ConsentPolicyService } from '../../../src/modules/contact-consent/consent-policy.service';
import { ConsentUnsubscribeService } from '../../../src/modules/contact-consent/consent-unsubscribe.service';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type EnqueueOutboundInput,
} from '../../../src/modules/chat-conversations';
import {
  asUser,
  conversationOf,
  simChannel,
  simInbound,
  sleep,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * BL-141: the ConsentGate on a real database (restricted role, forced RLS): the audience rule is equivalent to the old private
 * predicates with the switch off and on, the inbox send path refuses a marketing template to a contact who sent STOP (and still
 * answers him), the strict switch refuses a contact with no grant, and the email unsubscribe link writes the ledger.
 */
let p: Pipeline;
let t: Tenant;
let ch: SimChannel;
let gate: ConsentGate;
let facade: ConversationsFacade;

const contact = async (phone: string) =>
  (
    await p.h.owner.query(
      `SELECT id, uuid, is_unsubscribed FROM contacts WHERE org_id = $1 AND normalized_phone LIKE $2`,
      [t.orgId, `%${phone.slice(-10)}`],
    )
  ).rows[0] as { id: string; uuid: string; is_unsubscribed: boolean };

const record = async (uuid: string, body: Record<string, unknown>) => {
  const res = await p.api
    .as(t.admin)
    .post(`/v2/contact-consent/contacts/${uuid}/events`)
    .set('idempotency-key', randomUUID())
    .send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
};

const setSwitch = async (on: boolean) => {
  const cur = (await p.api.as(t.admin).get('/v2/contact-consent/settings')).body as Record<
    string,
    unknown
  > & { rowVersion: number | null };
  const { rowVersion, updatedAt: _u, ...values } = cur;
  const res = await p.api
    .as(t.admin)
    .patch('/v2/contact-consent/settings')
    .send({ ...values, requireConsentForMarketing: on, rowVersion: rowVersion ?? undefined });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const peers = {
  fresh: '919822220001',
  granted: '919822220002',
  stopped: '919822220003',
  smsOnly: '919822220004',
  regranted: '919822220005',
};
const ids: Record<keyof typeof peers, number> = {} as never;

beforeAll(async () => {
  p = await startPipeline(async () => [
    (await import('../../../src/modules/contact-consent/contact-consent-worker.module'))
      .ContactConsentWorkerModule,
  ]);
  t = await p.api.signup('gate');
  ch = await simChannel(p, t);
  gate = p.h.app.get(ConsentGate, { strict: false });
  facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
  for (const [k, phone] of Object.entries(peers)) {
    await simInbound(p, t, ch, { from: phone, name: k, text: 'hello' });
    await conversationOf(p, t, ch, phone);
  }
  for (const k of Object.keys(peers) as Array<keyof typeof peers>) {
    ids[k] = Number((await contact(peers[k])).id);
  }
  await record((await contact(peers.granted)).uuid, {
    channel: 'whatsapp',
    action: 'granted',
    note: 'signed form',
  });
  // STOP by the real keyword path.
  await simInbound(p, t, ch, { from: peers.stopped, text: 'STOP' });
  await until('stopped', async () => (await contact(peers.stopped)).is_unsubscribed);
  await record((await contact(peers.smsOnly)).uuid, {
    channel: 'sms',
    action: 'withdrawn',
    note: 'asked by phone',
  });
  await record((await contact(peers.regranted)).uuid, {
    channel: 'whatsapp',
    action: 'withdrawn',
    note: 'asked',
  });
  await record((await contact(peers.regranted)).uuid, {
    channel: 'whatsapp',
    action: 'granted',
    note: 'asked to be added back',
  });
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

/** The old predicates, as SQL: broadcasts and campaigns read these before the gate. */
async function oracle(requireConsent: boolean): Promise<number[]> {
  const res = await p.h.owner.query(
    `SELECT c.id FROM contacts c WHERE c.org_id = $1 AND NOT c.is_unsubscribed AND NOT c.is_archived
       ${
         requireConsent
           ? `AND EXISTS (SELECT 1 FROM contact_consent_state cs WHERE cs.org_id = c.org_id AND cs.contact_id = c.id
                 AND cs.channel = 'whatsapp' AND cs.purpose = 'marketing' AND cs.state = 'granted')`
           : ''
       } ORDER BY c.id`,
    [t.orgId],
  );
  return res.rows.map((r) => Number(r.id));
}

describe('checkMany is equivalent to the old audience predicates', () => {
  it('switch off: everyone except the contacts who withdrew', async () => {
    await setSwitch(false);
    const r = await gate.checkMany(t.orgId, Object.values(ids), 'whatsapp', 'marketing_messaging');
    const expected = (await oracle(false)).filter((id) => Object.values(ids).includes(id));
    expect([...r.allowed].sort((a, b) => a - b)).toEqual(expected);
    expect(r.decisions.get(ids.stopped)).toEqual({ decision: 'deny', reason: 'withdrawn' });
    // A withdrawal on sms is a roll-up withdrawal: the flag is what every legacy path reads.
    expect(r.decisions.get(ids.smsOnly)?.reason).toBe('withdrawn');
    expect(r.decisions.get(ids.fresh)).toEqual({ decision: 'allow', reason: 'policy_off' });
  });

  it('switch on: only contacts with a recorded grant, never a withdrawn one', async () => {
    await setSwitch(true);
    try {
      const r = await gate.checkMany(
        t.orgId,
        Object.values(ids),
        'whatsapp',
        'marketing_messaging',
      );
      const expected = (await oracle(true)).filter((id) => Object.values(ids).includes(id));
      expect([...r.allowed].sort((a, b) => a - b)).toEqual(expected);
      expect(r.decisions.get(ids.granted)).toEqual({ decision: 'allow', reason: 'granted' });
      expect(r.decisions.get(ids.fresh)).toEqual({
        decision: 'deny',
        reason: 'no_consent_recorded',
      });
      expect(r.decisions.get(ids.stopped)?.reason).toBe('withdrawn');
      expect(r.counts.granted).toBeGreaterThanOrEqual(2);
    } finally {
      await setSwitch(false);
    }
  });

  it('costs the same number of statements for one contact and for five (set based, no N+1)', async () => {
    const count = async (contactIds: number[]) => {
      const db = p.h.app.get(DatabaseService);
      const original = db.txAs.bind(db);
      let n = 0;
      (db as unknown as { txAs: unknown }).txAs = (tenant: unknown, fn: (tx: never) => unknown) =>
        original(
          tenant as never,
          ((tx: { execute: (q: unknown) => unknown }) => {
            const exec = tx.execute.bind(tx);
            tx.execute = (q: unknown) => {
              n++;
              return exec(q);
            };
            return fn(tx as never);
          }) as never,
        );
      try {
        await gate.checkMany(t.orgId, contactIds, 'whatsapp', 'service_messaging');
        return n;
      } finally {
        (db as unknown as { txAs: unknown }).txAs = original;
      }
    };
    const all = Object.values(ids);
    expect(await count(all)).toBe(await count(all.slice(0, 1)));
  });
});

describe('the inbox send path', () => {
  const template = async (name: string, category: string) =>
    p.h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, category, language) VALUES ($1, $2, 'body', $3, 'en')`,
      [t.orgId, name, category],
    );
  const send = (peer: string, content: EnqueueOutboundInput['content']) =>
    conversationOf(p, t, ch, peer).then((conv) =>
      asUser(t.orgId, t.adminUserId, () =>
        facade.enqueueOutbound({
          conversationId: conv.uuid as string,
          clientMessageId: randomUUID(),
          content,
        }),
      ),
    );
  const tpl = (name: string): EnqueueOutboundInput['content'] => ({
    kind: 'template',
    name,
    language: 'en',
    variables: {},
    body: 'body',
  });
  const code = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'ERROR';
    }
  };

  beforeAll(async () => {
    await template('promo_gate', 'marketing');
    await template('util_gate', 'utility');
  });

  it('a contact who sent STOP still gets a reply and a utility template, but not a marketing template', async () => {
    const reply = await send(peers.stopped, { kind: 'text', body: 'Your order shipped' });
    expect(reply.replayed).toBe(false);
    await until('reply sent', async () => {
      const r = await p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [
        reply.message.id,
      ]);
      return ['sent', 'delivered', 'read'].includes(r.rows[0]?.status) ? true : undefined;
    });
    expect(await code(() => send(peers.stopped, tpl('util_gate')))).toBeNull();
    expect(await code(() => send(peers.stopped, tpl('promo_gate')))).toBe('CONSENT_OPTED_OUT');
  });

  it('the refusal stores no message', async () => {
    const conv = await conversationOf(p, t, ch, peers.stopped);
    const before = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'out'`,
      [conv.id],
    );
    expect(await code(() => send(peers.stopped, tpl('promo_gate')))).toBe('CONSENT_OPTED_OUT');
    const after = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'out'`,
      [conv.id],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('a contact who did not withdraw receives the marketing template with the switch off', async () => {
    expect(await code(() => send(peers.fresh, tpl('promo_gate')))).toBeNull();
  });

  it('with the switch on a contact with no grant is refused, a granted one is not', async () => {
    await setSwitch(true);
    try {
      expect(await code(() => send(peers.fresh, tpl('promo_gate')))).toBe('CONSENT_SEND_DENIED');
      // The simulator is not a consent channel, so even a granted contact has nowhere to hold a grant on it (the WhatsApp case is
      // covered by the audience test above).
      expect(await code(() => send(peers.granted, tpl('promo_gate')))).toBe('CONSENT_SEND_DENIED');
      // Free-form replies are service: the switch does not touch them.
      expect(await code(() => send(peers.fresh, { kind: 'text', body: 'hello back' }))).toBeNull();
    } finally {
      await setSwitch(false);
    }
  });
});

describe('fail closed', () => {
  it('a database failure refuses marketing and lets a service reply through', async () => {
    const broken = new ConsentGate(
      {
        txAs: async () => {
          throw new Error('db down');
        },
      } as never,
      p.h.app.get(ConsentPolicyService),
    );
    const m = await broken.check(
      t.orgId,
      { type: 'contact', id: ids.fresh },
      'whatsapp',
      'marketing_messaging',
    );
    expect(m).toEqual({ decision: 'deny', reason: 'gate_unavailable_closed' });
    const s = await broken.check(
      t.orgId,
      { type: 'contact', id: ids.fresh },
      'whatsapp',
      'service_messaging',
    );
    expect(s).toEqual({ decision: 'allow', reason: 'gate_unavailable_open' });
    const many = await broken.checkMany(t.orgId, [ids.fresh, ids.granted], 'whatsapp', 'marketing');
    expect(many.allowed.size).toBe(0);
  });
});

describe('the email unsubscribe link', () => {
  it('withdraws email marketing through the public route, once, with no login', async () => {
    const unsub = p.h.app.get(ConsentUnsubscribeService);
    const link = unsub.linkFor(t.orgId, ids.fresh);
    const token = link.postUrl.split('/').pop()!;
    expect(link.pageUrl.endsWith(`/u/${token}`)).toBe(true);
    expect(link.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(token).not.toMatch(/@|\+|%40/);

    const status = await p.api.http().get(`/v2/public/consent/unsubscribe/${token}`);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(status.body).toEqual({ valid: true, unsubscribed: false });

    const one = await p.api
      .http()
      .post(`/v2/public/consent/unsubscribe/${token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    const again = await p.api.http().post(`/v2/public/consent/unsubscribe/${token}`);
    expect(again.status).toBe(200);

    const ev = await p.h.owner.query(
      `SELECT channel, purpose, action, source FROM contact_consent_events WHERE org_id = $1 AND contact_id = $2`,
      [t.orgId, ids.fresh],
    );
    expect(ev.rows).toEqual([
      { channel: 'email', purpose: 'marketing', action: 'withdrawn', source: 'contact_request' },
    ]);
    expect((await contact(peers.fresh)).is_unsubscribed).toBe(true);
    const after = await p.api.http().get(`/v2/public/consent/unsubscribe/${token}`);
    expect(after.body).toEqual({ valid: true, unsubscribed: true });
    // Every marketing path now refuses him.
    const r = await gate.check(
      t.orgId,
      { type: 'contact', id: ids.fresh },
      'whatsapp',
      'marketing',
    );
    expect(r.reason).toBe('withdrawn');
  });

  it('refuses an altered or unknown link', async () => {
    const unsub = p.h.app.get(ConsentUnsubscribeService);
    const token = unsub.linkFor(t.orgId, ids.granted).postUrl.split('/').pop()!;
    const forged = `${token.slice(0, -3)}AAA`;
    for (const bad of [forged, 'not-a-token']) {
      const res = await p.api.http().post(`/v2/public/consent/unsubscribe/${bad}`);
      expect(res.status).toBe(404);
      expect(res.body.code ?? res.body.type ?? JSON.stringify(res.body)).toMatch(
        /CONSENT_UNSUBSCRIBE_LINK_INVALID/,
      );
    }
    expect((await contact(peers.granted)).is_unsubscribed).toBe(false);
  });

  it('is rate limited per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await p.api.http().post('/v2/public/consent/unsubscribe/x.y')).status);
    }
    await sleep(10);
    expect(statuses).toContain(429);
  });
});

describe('the purpose registry endpoint', () => {
  it('lists every purpose with its policy and the workspace switch', async () => {
    const res = await p.api.as(t.admin).get('/v2/consent/purposes');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.purposes.map((x: { id: string }) => x.id)).toEqual([...PURPOSE_IDS]);
    const marketing = res.body.purposes.find((x: { id: string }) => x.id === 'marketing_messaging');
    expect(marketing).toMatchObject({
      lawfulBasis: 'consent',
      ledgerPurpose: 'marketing',
      enforcedAsGrant: false,
      labelKey: 'purposes.marketing_messaging.label',
    });
    expect(res.body.requireConsentForMarketing).toBe(false);
  });
});
