import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { Api, bearer, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * What the per-channel consent specs of the broadcast senders share (BL-141 follow-up): a contact tied to a thread, an opt-out, a
 * recorded grant, the workspace switch "Require recorded consent for marketing sends", and the children setting. Everything goes through
 * the real API or the owner connection, against the real Postgres of the harness.
 */
export class ConsentKit {
  constructor(
    private readonly h: Harness,
    private readonly api: Api,
  ) {}

  /** A contact for a person of a channel (`channel` and `channel_uid` are how a thread finds its contact). */
  async contact(
    t: Tenant,
    channel: string,
    uid: string,
    name = `Person ${uid}`,
  ): Promise<{ id: number; uuid: string }> {
    const r = await this.h.owner.query(
      `INSERT INTO contacts (org_id, name, channel, channel_uid) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, channel, channel_uid) WHERE channel IS NOT NULL AND channel_uid IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name RETURNING id, uuid`,
      [t.orgId, name, channel, uid],
    );
    return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
  }

  /** The contact of a thread: the one it already has, or a new one made for the person and tied to it. */
  async forConversation(
    t: Tenant,
    conversationId: number,
    channel: string,
    uid: string,
  ): Promise<{ id: number; uuid: string }> {
    const cur = await this.h.owner.query(
      `SELECT c.id, c.uuid FROM conversations v JOIN contacts c ON c.org_id = v.org_id AND c.id = v.contact_id
        WHERE v.org_id = $1 AND v.id = $2`,
      [t.orgId, conversationId],
    );
    if (cur.rows[0]) return { id: Number(cur.rows[0].id), uuid: cur.rows[0].uuid as string };
    const made = await this.contact(t, channel, uid);
    await this.h.owner.query(
      `UPDATE conversations SET contact_id = $3 WHERE org_id = $1 AND id = $2`,
      [t.orgId, conversationId, made.id],
    );
    return made;
  }

  /** Ties the conversation with this peer key to a contact, so the sender reads that contact's consent. */
  async link(t: Tenant, peerKey: string, contactId: number): Promise<void> {
    const r = await this.h.owner.query(
      `UPDATE conversations SET contact_id = $3 WHERE org_id = $1 AND peer_key = $2`,
      [t.orgId, peerKey, contactId],
    );
    expect(r.rowCount, `a conversation with peer key ${peerKey}`).toBeGreaterThan(0);
  }

  /** The roll-up flag a STOP sets (`contacts.is_unsubscribed`), the way every legacy send path reads it. */
  async unsubscribe(t: Tenant, contactId: number): Promise<void> {
    await this.h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND id = $2`,
      [t.orgId, contactId],
    );
  }

  /** A grant or a withdrawal on the ledger of one channel, by the real API (the state row follows in the same transaction). */
  async record(
    t: Tenant,
    contactUuid: string,
    channel: string,
    action: 'granted' | 'withdrawn',
  ): Promise<void> {
    const res = await this.api
      .http()
      .post(`/v2/contact-consent/contacts/${contactUuid}/events`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID())
      .send({ channel, action, note: action === 'granted' ? 'signed form' : 'asked to stop' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }

  /** The workspace switch "Require recorded consent for marketing sends". */
  async setSwitch(t: Tenant, on: boolean): Promise<void> {
    const cur = (await this.api.http().get('/v2/contact-consent/settings').set(bearer(t.admin)))
      .body as Record<string, unknown> & { rowVersion: number | null };
    const { rowVersion, updatedAt: _updatedAt, ...values } = cur;
    const res = await this.api
      .http()
      .patch('/v2/contact-consent/settings')
      .set(bearer(t.admin))
      .send({ ...values, requireConsentForMarketing: on, rowVersion: rowVersion ?? undefined });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  /** Flags a contact as a minor and says what the workspace does about it (`no_minors` = hold marketing back always). */
  async minor(t: Tenant, contactId: number, childrenPolicy = 'no_minors'): Promise<void> {
    await this.h.owner.query(
      `INSERT INTO contact_privacy_flags (org_id, contact_id, is_minor, minor_since, minor_source)
       VALUES ($1, $2, true, now(), 'manual')
       ON CONFLICT (org_id, contact_id) DO UPDATE SET is_minor = true, minor_source = 'manual'`,
      [t.orgId, contactId],
    );
    await this.h.owner.query(
      `INSERT INTO compliance_settings (org_id, children_policy) VALUES ($1, $2)
       ON CONFLICT (org_id) DO UPDATE SET children_policy = EXCLUDED.children_policy`,
      [t.orgId, childrenPolicy],
    );
  }
}

/** The text a recipient keeps when the consent check refused it: the gate's reason is the code in the brackets. */
export const refusedWith = (reason: string) => `Not messaged: consent (${reason})`;
