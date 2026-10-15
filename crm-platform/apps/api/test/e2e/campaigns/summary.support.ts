import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { FormsApi } from '../forms-builder/support';
import type { Harness, Tenant } from '../contacts-attributes-tags/support';

/** The world the director-summary specs arrange: people, their inbox threads, form submissions and the sends that went to them. */

/** The instant everything is sent, and a helper for "this many hours later". */
export const SENT = new Date('2026-09-10T06:00:00Z');
export const at = (hours: number): Date => new Date(SENT.getTime() + hours * 3_600_000);

let seq = 0;
export const nextDigits = (): string => `91${900_000_000 + ++seq * 7}`;

export interface Person {
  id: number;
  uuid: string;
  name: string;
  digits: string;
}

export async function person(
  owner: Client,
  t: Tenant,
  name: string,
  o: { optedOut?: boolean; noPhone?: boolean } = {},
): Promise<Person> {
  const digits = nextDigits();
  const res = await owner.query(
    `INSERT INTO contacts (org_id, name, phone, is_unsubscribed) VALUES ($1,$2,$3,$4) RETURNING id, uuid`,
    [t.orgId, name, o.noPhone ? null : `+${digits}`, o.optedOut ?? false],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid, name, digits };
}

export async function channel(owner: Client, t: Tenant): Promise<number> {
  const res = await owner.query(
    `INSERT INTO channels (org_id, kind, name, status) VALUES ($1, 'whatsapp', 'WA', 'connected') RETURNING id`,
    [t.orgId],
  );
  return Number(res.rows[0].id);
}

export interface Msg {
  /** Hours after the send (negative = before it). */
  h: number;
  kind?: string;
  dir?: 'in' | 'out';
  deleted?: boolean;
}

/** One inbox thread and its messages; `last_inbound_at` is what the real pipeline would have left (the latest inbound, any kind). */
export async function thread(
  owner: Client,
  t: Tenant,
  channelId: number,
  peerKey: string,
  contactId: number | null,
  msgs: Msg[],
): Promise<number> {
  const inbound = msgs.filter((m) => (m.dir ?? 'in') === 'in').map((m) => at(m.h).getTime());
  const last = inbound.length > 0 ? new Date(Math.max(...inbound)) : null;
  const cv = await owner.query(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, contact_id, last_inbound_at, msg_seq)
     VALUES ($1,$2,$3,'T',$4,$5,$6) RETURNING id`,
    [t.orgId, channelId, peerKey, contactId, last, msgs.length],
  );
  const id = Number(cv.rows[0].id);
  let n = 0;
  for (const m of msgs) {
    const dir = m.dir ?? 'in';
    await owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        t.orgId,
        id,
        ++n,
        dir,
        m.kind ?? 'text',
        dir === 'in' ? 'customer' : 'agent',
        dir === 'in' ? 'received' : 'sent',
        at(m.h),
        m.deleted ? at(m.h) : null,
      ],
    );
  }
  return id;
}

/** A later inbound message in an existing thread (and the thread's `last_inbound_at` with it). */
export async function replyLater(owner: Client, t: Tenant, convId: number, h: number) {
  await owner.query(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at)
     VALUES ($1,$2,(SELECT coalesce(max(seq),0)+1 FROM messages WHERE conversation_id = $2),'in','text','customer','received',$3)`,
    [t.orgId, convId, at(h)],
  );
  await owner.query(
    `UPDATE conversations SET last_inbound_at = GREATEST(last_inbound_at, $2) WHERE id = $1`,
    [convId, at(h)],
  );
}

export async function campaign(owner: Client, t: Tenant, name = 'Admissions push') {
  const res = await owner.query(
    `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, schedule_type, timezone)
     VALUES ($1,$2,'text','completed','now','UTC') RETURNING id, uuid`,
    [t.orgId, name],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

export interface Recipient {
  contactId?: number | null;
  phone?: string | null;
  name?: string | null;
  status: string;
  /** Hours after the send; null = never sent. */
  sentH?: number | null;
  delivered?: boolean;
  read?: boolean;
  optedOut?: boolean;
}

export async function recipient(owner: Client, t: Tenant, campaignId: number, r: Recipient) {
  const sentH = r.sentH === undefined ? 0 : r.sentH;
  await owner.query(
    `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, phone_number, recipient_name, status, sent_at,
                                       delivered_at, read_at, is_unsubscribed, unsubscribed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [
      t.orgId,
      campaignId,
      r.contactId ?? null,
      r.phone ?? null,
      r.name ?? null,
      r.status,
      sentH === null ? null : at(sentH),
      r.delivered || r.read ? at((sentH ?? 0) + 0.1) : null,
      r.read ? at((sentH ?? 0) + 0.2) : null,
      r.optedOut ?? false,
    ],
  );
}

export async function broadcast(owner: Client, t: Tenant, name = 'Open day reminder') {
  const res = await owner.query(
    `INSERT INTO broadcasts (org_id, name, status) VALUES ($1,$2,'completed') RETURNING id, uuid`,
    [t.orgId, name],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

export async function broadcastRecipient(
  owner: Client,
  t: Tenant,
  broadcastId: number,
  contactId: number,
  status: string,
  sentH: number | null = 0,
) {
  await owner.query(
    `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, sent_at, delivered_at, read_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      t.orgId,
      broadcastId,
      contactId,
      status,
      sentH === null ? null : at(sentH),
      status === 'delivered' || status === 'read' ? at((sentH ?? 0) + 0.1) : null,
      status === 'read' ? at((sentH ?? 0) + 0.2) : null,
    ],
  );
}

export interface WebForm {
  id: number;
  uuid: string;
  versionId: number;
  name: string;
}

/** A published web form made through the real API (the forms add-on switched on), as its id, uuid and live version. */
export async function webForm(
  h: Harness,
  api: FormsApi,
  t: Tenant,
  name: string,
): Promise<WebForm> {
  const f = await api.liveForm(t.admin, { name });
  const row = (
    await h.owner.query(`SELECT id, published_version_id FROM web_forms WHERE uuid = $1`, [f.id])
  ).rows[0];
  return { id: Number(row.id), uuid: f.id, versionId: Number(row.published_version_id), name };
}

export async function webSubmission(
  owner: Client,
  t: Tenant,
  form: WebForm,
  contactId: number | null,
  status: string,
  h: number,
) {
  await owner.query(
    `INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status, contact_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      t.orgId,
      form.id,
      form.versionId,
      `idem-${randomUUID()}`.slice(0, 40),
      `rcpt-${randomUUID()}`,
      status,
      contactId,
      at(h),
    ],
  );
}

export async function waForm(owner: Client, t: Tenant, title: string) {
  const res = await owner.query(
    `INSERT INTO wa_forms (org_id, title, slug) VALUES ($1,$2,$3) RETURNING id, uuid`,
    [t.orgId, title, `slug-${randomUUID().slice(0, 8)}`],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string, name: title };
}

export async function waSubmission(
  owner: Client,
  t: Tenant,
  formId: number,
  contactId: number | null,
  h: number,
) {
  await owner.query(
    `INSERT INTO wa_form_submissions (org_id, form_id, contact_id, submitted_at) VALUES ($1,$2,$3,$4)`,
    [t.orgId, formId, contactId, at(h)],
  );
}
