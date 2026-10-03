import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BroadcastInboxMirrorService } from '../../../src/modules/broadcasts/broadcast-inbox-mirror.service';
import { BroadcastReceiptsService } from '../../../src/modules/broadcasts/broadcast-receipts.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** Team-inbox mirroring of broadcast sends (WD-BCAST-028), against a real Postgres. */
let h: Harness;
let api: Api;
let mirror: BroadcastInboxMirrorService;
let receipts: BroadcastReceiptsService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  mirror = h.app.get(BroadcastInboxMirrorService);
  receipts = h.app.get(BroadcastReceiptsService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let n = 0;
async function setup(t: Tenant, o: { thread: boolean; name?: string; body?: string }) {
  const tpl = (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, footer, variable_map, buttons, language, meta_template_id, meta_status, status)
       VALUES ($1,'promo',$2,'Reply STOP',$3::jsonb,$4::jsonb,'en_US',$5,'APPROVED','approved') RETURNING id`,
      [
        t.orgId,
        o.body ?? 'Hi {{1}}, sale today',
        JSON.stringify({ body: [{ num: 1, key: 'name' }] }),
        JSON.stringify([{ type: 'URL', text: 'Shop', url: 'https://x.test' }]),
        `meta-${t.orgId}-${n}`,
      ],
    )
  ).rows[0];
  const b = (
    await h.owner.query(
      `INSERT INTO broadcasts (org_id, name, status, provider, template_id, total_recipients) VALUES ($1,'B','processing','waba',$2,1) RETURNING id`,
      [t.orgId, tpl.id],
    )
  ).rows[0];
  const phone = `+9166${String(n++).padStart(8, '0')}`;
  const [uuid] = await api.seedContacts(t, [{ name: o.name ?? 'Asha Rao', phone }]);
  const c = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0];
  const wamid = `wamid.${t.orgId}.${n}`;
  await h.owner.query(
    `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, whatsapp_message_id) VALUES ($1,$2,$3,'sent',$4)`,
    [t.orgId, b.id, c.id, wamid],
  );
  let convId: number | null = null;
  if (o.thread) {
    // A thread belongs to a channel and is keyed by its peer (the contact's digits).
    const channel = (
      await h.owner.query(
        `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'whatsapp_cloud', 'WA') RETURNING id`,
        [t.orgId],
      )
    ).rows[0];
    convId = Number(
      (
        await h.owner.query(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title, contact_id, unread_count) VALUES ($1,$2,$3,'Asha',$4,2) RETURNING id`,
          [t.orgId, channel.id, phone.replace(/\D/g, ''), c.id],
        )
      ).rows[0].id,
    );
  }
  return { broadcastId: Number(b.id), contactId: Number(c.id), wamid, convId };
}

const bubbles = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT body, status, direction, meta FROM messages WHERE org_id = $1 ORDER BY id`,
      [orgId],
    )
  ).rows;

describe('WD-BCAST-028: inbox mirroring', () => {
  it('a recipient with a thread gets one resolved bubble; unread is untouched; the thread is updated', async () => {
    const t = await api.signup('m1');
    const s = await setup(t, { thread: true });
    expect(await mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'sent', s.wamid)).toBe(true);
    const rows = await bubbles(t.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: 'out',
      status: 'sent',
      body: 'Hi Asha Rao, sale today\n\nReply STOP',
    });
    expect(rows[0].meta).toMatchObject({
      source: 'broadcast',
      type: 'template',
      template_name: 'promo',
      wa_message_id: s.wamid,
      src_key: `broadcast:${s.broadcastId}:contact:${s.contactId}`,
    });
    expect(rows[0].meta.buttons).toHaveLength(1);
    const conv = (
      await h.owner.query(
        `SELECT unread_count, preview, last_outbound_at FROM conversations WHERE id = $1`,
        [s.convId],
      )
    ).rows[0];
    expect(conv.unread_count).toBe(2);
    expect(conv.preview).toBe('Hi Asha Rao, sale today\n\nReply STOP');
    expect(conv.last_outbound_at).not.toBeNull();
  });

  it('a recipient with no thread gets none', async () => {
    const t = await api.signup('m2');
    const s = await setup(t, { thread: false });
    expect(await mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'sent', s.wamid)).toBe(false);
    expect(
      (await h.owner.query(`SELECT 1 FROM conversations WHERE org_id = $1`, [t.orgId])).rows,
    ).toHaveLength(0);
    expect(await bubbles(t.orgId)).toHaveLength(0);
  });

  it('sent then delivered then read is one bubble; a lost sent is healed by delivered', async () => {
    const t = await api.signup('m3');
    const s = await setup(t, { thread: true });
    await mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'sent', s.wamid);
    await mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'delivered', s.wamid);
    await mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'read', null);
    expect(await bubbles(t.orgId)).toHaveLength(1);

    const u = await api.signup('m4');
    const s2 = await setup(u, { thread: true });
    await receipts.handle({
      providerMessageId: s2.wamid,
      status: 'delivered',
      occurredAt: new Date(),
    });
    const rows = await bubbles(u.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('delivered');
  });

  it('two reports at once still make one bubble', async () => {
    const t = await api.signup('m5');
    const s = await setup(t, { thread: true });
    await Promise.all([
      mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'sent', s.wamid),
      mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'delivered', s.wamid),
      mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'sent', null),
    ]);
    expect(await bubbles(t.orgId)).toHaveLength(1);
  });

  it('a failed report mirrors nothing, and an empty body mirrors nothing', async () => {
    const t = await api.signup('m6');
    const s = await setup(t, { thread: true });
    expect(await mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'failed', s.wamid)).toBe(false);
    await h.owner.query(
      `UPDATE wa_templates SET template_body = ' ', footer = NULL WHERE org_id = $1`,
      [t.orgId],
    );
    expect(await mirror.mirror(t.orgId, s.broadcastId, s.contactId, 'sent', s.wamid)).toBe(false);
    expect(await bubbles(t.orgId)).toHaveLength(0);
  });

  it("another tenant's thread is never written to", async () => {
    const a = await api.signup('m7');
    const sa = await setup(a, { thread: false });
    const b = await api.signup('m8');
    await setup(b, { thread: true });
    expect(await mirror.mirror(a.orgId, sa.broadcastId, sa.contactId, 'sent', sa.wamid)).toBe(
      false,
    );
    expect(await bubbles(b.orgId)).toHaveLength(0);
  });
});
