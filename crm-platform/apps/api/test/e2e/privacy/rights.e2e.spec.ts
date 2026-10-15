import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conversationOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * BL-143: the rights service end to end on a real API, real Postgres (restricted role, forced RLS) and the real export queue.
 * A person with messages, media, a file, a lead, an invoice, a call and consent events is exported and erased; then a contact
 * deleted from the CRM must leave no conversation behind.
 */
let p: Pipeline;
let a: Tenant;
let b: Tenant;
let ch: SimChannel;
const PHONE = '919812300001';

const q = async (sql: string, params: unknown[] = []) => (await p.h.owner.query(sql, params)).rows;
const n = async (sql: string, params: unknown[] = []) => Number((await q(sql, params))[0]?.n ?? 0);

async function seedPerson(t: Tenant, channel: SimChannel, phone: string, name: string) {
  const created = await p.api
    .as(t.admin)
    .post('/v2/contacts')
    .send({
      name,
      phone: `+${phone}`,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.test`,
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const contactUuid = created.body.id as string;
  const contactId = Number(
    (await q(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid]))[0].id,
  );
  await simInbound(p, t, channel, { from: phone, name, text: `hello from ${name}` });
  const conv = await conversationOf(p, t, channel, phone);
  await p.h.owner.query(`UPDATE conversations SET contact_id = $1 WHERE id = $2 AND org_id = $3`, [
    contactId,
    conv.id,
    t.orgId,
  ]);
  await p.h.owner.query(
    `UPDATE messages SET media_key = $1, media_name = 'photo.jpg' WHERE org_id = $2 AND conversation_id = $3`,
    [`chat/${t.orgId}/2026/10/${phone}.jpg`, t.orgId, conv.id],
  );
  await p.h.owner.query(
    `INSERT INTO contact_files (org_id, contact_id, file_name, storage_key) VALUES ($1,$2,'id-card.pdf',$3)`,
    [t.orgId, contactId, `contacts/${t.orgId}/${phone}/id-card.pdf`],
  );
  await p.h.owner.query(
    `INSERT INTO leads (org_id, name, phone, email, contact_id, source) VALUES ($1,$2,$3,$4,$5,'manual')`,
    [t.orgId, name, `+${phone}`, `${phone}@example.test`, contactId],
  );
  await p.h.owner.query(
    `INSERT INTO invoices (org_id, source, status, doc_type, invoice_number, series, seq, issued_at, issue_date, public_token_hash, currency, subtotal_minor, total_minor, buyer_name, buyer_email, contact_id)
     VALUES ($1,'manual','issued','tax_invoice',$2,'INV',$6,now(),current_date,$2,'INR',123400,123400,$3,$4,$5)`,
    [t.orgId, `INV-${phone}`, name, `${phone}@example.test`, contactId, Number(phone.slice(-4))],
  );
  await p.h.owner.query(
    `INSERT INTO wa_calls (org_id, direction, from_phone, to_phone, contact_id, recording_path) VALUES ($1,'USER_INITIATED',$2,'918000000000',$3,$4)`,
    [t.orgId, `+${phone}`, contactId, `calls/${t.orgId}/${phone}.ogg`],
  );
  await p.h.owner.query(
    `INSERT INTO contact_consent_events (org_id, contact_id, channel, action, source, idempotency_key) VALUES ($1,$2,'whatsapp','granted','manual',$3)`,
    [t.orgId, contactId, `e2e-${phone}`],
  );
  return { contactUuid, contactId, convId: Number(conv.id) };
}

beforeAll(async () => {
  p = await startPipeline(async () => [
    (await import('../../../src/modules/privacy/privacy-worker.module')).PrivacyWorkerModule,
  ]);
  a = await p.api.signup('privA');
  b = await p.api.signup('privB');
  ch = await simChannel(p, a);
}, 720_000);

afterAll(async () => {
  await p?.stop();
});

describe('data request: export then erase', () => {
  let person: Awaited<ReturnType<typeof seedPerson>>;
  let reqId: string;
  let reference: string;
  let preview: {
    lines: Array<{ table: string; count: number; disposition: string }>;
    files: number;
  };

  it('creates a request with a masked label and a 30 day clock', async () => {
    person = await seedPerson(a, ch, PHONE, 'Rita Sharma');
    const res = await p.api
      .as(a.admin)
      .post('/v2/privacy/requests')
      .set('idempotency-key', 'priv-1')
      .send({ requestType: 'erasure', subject: { kind: 'contact', id: person.contactUuid } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    reqId = res.body.id;
    reference = res.body.reference;
    expect(res.body.status).toBe('received');
    expect(JSON.stringify(res.body)).not.toContain('Rita');
    expect(JSON.stringify(res.body)).not.toContain(PHONE);
    const days = Math.round(
      (Date.parse(res.body.dueAt) - Date.parse(res.body.receivedAt)) / 86_400_000,
    );
    expect(days).toBe(30);
  });

  it('refuses export and erasure before the identity is verified', async () => {
    const ex = await p.api.as(a.admin).post(`/v2/privacy/requests/${reqId}/export`);
    expect(ex.status).toBe(409);
    expect(ex.body.code).toBe('PRIVACY_IDENTITY_NOT_VERIFIED');
  });

  it('a read-only member can list but not create, verify or erase; another tenant cannot see it', async () => {
    const reader = await p.api.member(a, 'reader', [['privacy.requests.read']]);
    expect((await p.api.as(reader.token).get('/v2/privacy/requests')).status).toBe(200);
    expect(
      (
        await p.api
          .as(reader.token)
          .post('/v2/privacy/requests')
          .send({ requestType: 'access', subject: { kind: 'contact', id: person.contactUuid } })
      ).status,
    ).toBe(403);
    expect(
      (
        await p.api
          .as(reader.token)
          .post(`/v2/privacy/requests/${reqId}/erase`)
          .send({ dryRun: true })
      ).status,
    ).toBe(403);
    const manager = await p.api.member(a, 'mgr', [['privacy.requests.manage']]);
    expect(
      (
        await p.api
          .as(manager.token)
          .post(`/v2/privacy/requests/${reqId}/erase`)
          .send({ dryRun: true })
      ).status,
    ).toBe(403);
    expect((await p.api.as(b.admin).get(`/v2/privacy/requests/${reqId}`)).status).toBe(404);
    const other = await p.api.as(b.admin).get('/v2/privacy/requests');
    expect(other.body.data).toHaveLength(0);
  });

  it('verifies the identity', async () => {
    const res = await p.api
      .as(a.admin)
      .post(`/v2/privacy/requests/${reqId}/verify`)
      .send({ outcome: 'verified', method: 'channel_code', evidenceRef: 'ticket-77' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  it('exports every module section into a ZIP', async () => {
    const res = await p.api.as(a.admin).post(`/v2/privacy/requests/${reqId}/export`);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const detail = await until('export ready', async () => {
      const d = await p.api.as(a.admin).get(`/v2/privacy/requests/${reqId}`);
      const x = d.body.exports[0];
      return x && x.status === 'ready'
        ? x
        : x?.status === 'failed'
          ? Promise.reject(new Error(x.error))
          : undefined;
    });
    expect(Object.keys(detail.sections)).toEqual(
      expect.arrayContaining([
        'contacts.card',
        'inbox.messages',
        'sales.invoices',
        'calls.logs',
        'leads.records',
      ]),
    );
    const dl = await p.api
      .as(a.admin)
      .get(`/v2/privacy/requests/${reqId}/exports/${detail.id}/download`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    const zip = dl.body as Buffer;
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    for (const name of [
      'README.txt',
      'index.json',
      'messages.csv',
      'files.json',
      'data/contacts.card/contacts.json',
    ]) {
      expect(zip.includes(Buffer.from(name)), name).toBe(true);
    }
    // The request was an erasure: downloading a copy does not close it.
    expect((await p.api.as(a.admin).get(`/v2/privacy/requests/${reqId}`)).body.request.status).toBe(
      'in_progress',
    );
  });

  it('previews the erasure without changing anything', async () => {
    const before = await n(
      `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND conversation_id = $2`,
      [a.orgId, person.convId],
    );
    const res = await p.api
      .as(a.admin)
      .post(`/v2/privacy/requests/${reqId}/erase`)
      .send({ dryRun: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    preview = res.body;
    const line = (t: string) => preview.lines.find((l) => l.table === t);
    expect(line('messages')).toMatchObject({ disposition: 'deleted', count: before });
    expect(line('invoices')).toMatchObject({ disposition: 'anonymised', count: 1 });
    expect(line('leads')).toMatchObject({ disposition: 'anonymised', count: 1 });
    expect(line('contacts')).toMatchObject({ disposition: 'deleted', count: 1 });
    expect(line('contact_files')).toMatchObject({ disposition: 'cascaded', count: 1 });
    expect(preview.files).toBeGreaterThanOrEqual(3);
    expect(
      await n(`SELECT count(*)::int AS n FROM contacts WHERE uuid = $1`, [person.contactUuid]),
    ).toBe(1);
    expect(
      await n(`SELECT count(*)::int AS n FROM privacy_erasure_files WHERE org_id = $1`, [a.orgId]),
    ).toBe(0);
  });

  it('refuses to execute without the typed phrase, and while on legal hold', async () => {
    const no = await p.api
      .as(a.admin)
      .post(`/v2/privacy/requests/${reqId}/erase`)
      .send({ dryRun: false });
    expect(no.status).toBe(422);
    expect(no.body.code).toBe('PRIVACY_CONFIRMATION_REQUIRED');
    const hold = await p.api
      .as(a.admin)
      .post(`/v2/privacy/requests/${reqId}/hold`)
      .send({ held: true, reason: 'Dispute open' });
    expect(hold.status).toBe(200);
    const held = await p.api
      .as(a.admin)
      .post(`/v2/privacy/requests/${reqId}/erase`)
      .send({ dryRun: true });
    expect(held.status).toBe(409);
    expect(held.body.code).toBe('PRIVACY_LEGAL_HOLD');
    expect(
      (await p.api.as(a.admin).post(`/v2/privacy/requests/${reqId}/hold`).send({ held: false }))
        .status,
    ).toBe(200);
  });

  it('executes: nothing personal remains, amounts and dates do, counts equal the preview', async () => {
    const res = await p.api
      .as(a.admin)
      .post(`/v2/privacy/requests/${reqId}/erase`)
      .send({ dryRun: false, confirmation: `ERASE ${reference}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const key = (r: { lines: Array<{ table: string; disposition: string; count: number }> }) =>
      r.lines.map((l) => `${l.table}|${l.disposition}|${l.count}`).sort();
    expect(key(res.body)).toEqual(key(preview));

    expect(
      await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND uuid = $2`, [
        a.orgId,
        person.contactUuid,
      ]),
    ).toBe(0);
    expect(
      await n(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND id = $2`, [
        a.orgId,
        person.convId,
      ]),
    ).toBe(0);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND conversation_id = $2`,
        [a.orgId, person.convId],
      ),
    ).toBe(0);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contact_files WHERE org_id = $1 AND contact_id = $2`,
        [a.orgId, person.contactId],
      ),
    ).toBe(0);
    const lead = (
      await q(`SELECT name, phone, email FROM leads WHERE org_id = $1 AND source = 'manual'`, [
        a.orgId,
      ])
    )[0];
    expect(lead).toEqual({ name: '[erased]', phone: null, email: null });
    const inv = (
      await q(
        `SELECT buyer_name, buyer_email, total_minor, currency, invoice_number FROM invoices WHERE org_id = $1`,
        [a.orgId],
      )
    )[0];
    expect(inv).toMatchObject({
      buyer_name: '[erased]',
      buyer_email: null,
      total_minor: 123400,
      currency: 'INR',
      invoice_number: `INV-${PHONE}`,
    });
    const call = (
      await q(`SELECT from_phone, recording_path FROM wa_calls WHERE org_id = $1`, [a.orgId])
    )[0];
    expect(call).toEqual({ from_phone: '[erased]', recording_path: null });
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contact_consent_events WHERE org_id = $1 AND contact_id IS NULL`,
        [a.orgId],
      ),
    ).toBe(1);

    const detail = (await p.api.as(a.admin).get(`/v2/privacy/requests/${reqId}`)).body.request;
    expect(detail.status).toBe('completed');
    expect(detail.contactId).toBeNull();
    expect(detail.proof.sha256).toMatch(/^[0-9a-f]{64}$/);
    const proof = JSON.stringify(detail.proof);
    for (const secret of ['Rita', PHONE, 'example.test']) expect(proof).not.toContain(secret);

    // The files are handed to the platform purge queue by the worker.
    const { PrivacyMaintenanceService } =
      await import('../../../src/modules/privacy/requests/privacy-maintenance.service');
    const moved = await p.h.app.get(PrivacyMaintenanceService).drainFiles();
    expect(moved).toBeGreaterThanOrEqual(3);
    const keys = (
      await q(`SELECT storage_key FROM storage_purge_queue WHERE org_id = $1`, [a.orgId])
    ).map((r) => r.storage_key);
    expect(keys).toEqual(
      expect.arrayContaining([
        `chat/${a.orgId}/2026/10/${PHONE}.jpg`,
        `contacts/${a.orgId}/${PHONE}/id-card.pdf`,
        `calls/${a.orgId}/${PHONE}.ogg`,
      ]),
    );
  });

  it('a second execution is refused', async () => {
    const again = await p.api
      .as(a.admin)
      .post(`/v2/privacy/requests/${reqId}/erase`)
      .send({ dryRun: true });
    expect(again.status).toBe(409);
  });
});

describe('deleting a contact from the CRM', () => {
  it('erases the conversation history by default', async () => {
    const x = await seedPerson(a, ch, '919812300002', 'Dev Patel');
    const res = await p.api.as(a.admin).delete(`/v2/contacts/${x.contactUuid}`);
    expect(res.status).toBe(204);
    expect(
      await n(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND id = $2`, [
        a.orgId,
        x.convId,
      ]),
    ).toBe(0);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND conversation_id = $2`,
        [a.orgId, x.convId],
      ),
    ).toBe(0);
    expect(
      await n(`SELECT count(*)::int AS n FROM privacy_erasure_files WHERE org_id = $1`, [a.orgId]),
    ).toBeGreaterThanOrEqual(3);
    // Business records stay as they were: the invoice keeps its buyer, unlinked.
    const inv = (
      await q(`SELECT buyer_name, contact_id FROM invoices WHERE invoice_number = $1`, [
        'INV-919812300002',
      ])
    )[0];
    expect(inv).toEqual({ buyer_name: 'Dev Patel', contact_id: null });
  });

  it('with eraseHistory=false keeps the thread without the person identity', async () => {
    const x = await seedPerson(a, ch, '919812300003', 'Asha Rao');
    const res = await p.api.as(a.admin).delete(`/v2/contacts/${x.contactUuid}?eraseHistory=false`);
    expect(res.status).toBe(204);
    const conv = (
      await q(`SELECT peer_key, peer_name, contact_id FROM conversations WHERE id = $1`, [x.convId])
    )[0];
    expect(conv.peer_key).toMatch(/^erased:/);
    expect(conv.peer_name).toBeNull();
    expect(conv.contact_id).toBeNull();
    const msg = (
      await q(`SELECT body, media_key FROM messages WHERE conversation_id = $1`, [x.convId])
    )[0];
    expect(msg).toEqual({ body: null, media_key: null });
  });

  it('bulk delete erases history too', async () => {
    const x = await seedPerson(a, ch, '919812300004', 'Omar Khan');
    const res = await p.api
      .as(a.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [x.contactUuid] });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(
      await n(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND id = $2`, [
        a.orgId,
        x.convId,
      ]),
    ).toBe(0);
  });
});
