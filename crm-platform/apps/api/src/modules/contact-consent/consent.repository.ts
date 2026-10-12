import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export interface EventRow {
  id: number;
  uuid: string;
  contactId: number | null;
  contactUuid: string | null;
  channel: string;
  purpose: string;
  action: string;
  source: string;
  evidence: Record<string, unknown>;
  actorUuid: string | null;
  actorName: string | null;
  note: string | null;
  occurredAt: string;
  recordedAt: string;
}

export interface StateRow {
  channel: string;
  purpose: string;
  state: string;
  lastOccurredAt: string;
}

export interface SettingsRow {
  detectionEnabled: boolean;
  requireConsentForMarketing: boolean;
  autoReplyEnabled: boolean;
  footerDefaultOn: boolean;
  config: Record<string, unknown>;
  rowVersion: number;
  updatedAt: string;
}

/** SQL of the consent ledger. Every statement is tenant scoped by `org_id` (and by forced RLS underneath). */
@Injectable()
export class ConsentRepository {
  async contactByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string | null } | null> {
    const res = await tx.execute(
      sql`SELECT id, name FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? { id: num(r.id), name: (r.name as string | null) ?? null } : null;
  }

  async contactUuid(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return ((res.rows[0] as Raw | undefined)?.uuid as string | undefined) ?? null;
  }

  /** The state row, locked: the roll-up that follows must not race another event of the same contact. */
  async lockState(
    tx: Tx,
    orgId: number,
    contactId: number,
    channel: string,
    purpose: string,
  ): Promise<{ state: string; lastOccurredAt: string } | null> {
    const res = await tx.execute(sql`
      SELECT state, last_occurred_at FROM contact_consent_state
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND channel = ${channel} AND purpose = ${purpose}
      FOR UPDATE`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { state: r.state as string, lastOccurredAt: iso(r.last_occurred_at) } : null;
  }

  /** Inserts the event; null when the idempotency key was already used (a redelivery). */
  async insertEvent(
    tx: Tx,
    orgId: number,
    v: {
      contactId: number;
      channel: string;
      purpose: string;
      action: string;
      source: string;
      evidence: Record<string, unknown>;
      actorUserId: number | null;
      note: string | null;
      occurredAt: Date;
      idempotencyKey: string;
    },
  ): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(sql`
      INSERT INTO contact_consent_events
        (org_id, contact_id, channel, purpose, action, source, evidence, actor_user_id, note, occurred_at, idempotency_key)
      VALUES (${orgId}, ${v.contactId}, ${v.channel}, ${v.purpose}, ${v.action}, ${v.source}, ${JSON.stringify(v.evidence)}::jsonb,
              ${v.actorUserId}, ${v.note}, ${v.occurredAt.toISOString()}::timestamptz, ${v.idempotencyKey})
      ON CONFLICT (org_id, idempotency_key) DO NOTHING
      RETURNING id, uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { id: num(r.id), uuid: r.uuid as string } : null;
  }

  async upsertState(
    tx: Tx,
    orgId: number,
    v: {
      contactId: number;
      channel: string;
      purpose: string;
      state: string;
      eventId: number;
      occurredAt: Date;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO contact_consent_state (org_id, contact_id, channel, purpose, state, last_event_id, last_occurred_at)
      VALUES (${orgId}, ${v.contactId}, ${v.channel}, ${v.purpose}, ${v.state}, ${v.eventId}, ${v.occurredAt.toISOString()}::timestamptz)
      ON CONFLICT (org_id, contact_id, channel, purpose) DO UPDATE
        SET state = EXCLUDED.state, last_event_id = EXCLUDED.last_event_id,
            last_occurred_at = EXCLUDED.last_occurred_at, updated_at = now()`);
  }

  async anyWithdrawn(tx: Tx, orgId: number, contactId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM contact_consent_state
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND purpose = 'marketing' AND state = 'withdrawn' LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Sets the roll-up flag; returns true when the stored value really changed. */
  async setContactFlag(
    tx: Tx,
    orgId: number,
    contactId: number,
    unsubscribed: boolean,
    at: Date,
  ): Promise<boolean> {
    const res = await tx.execute(
      unsubscribed
        ? sql`UPDATE contacts SET is_unsubscribed = true, unsubscribed_at = coalesce(unsubscribed_at, ${at.toISOString()}::timestamptz)
              WHERE org_id = ${orgId} AND id = ${contactId} AND NOT is_unsubscribed RETURNING id`
        : sql`UPDATE contacts SET is_unsubscribed = false, unsubscribed_at = NULL
              WHERE org_id = ${orgId} AND id = ${contactId} AND is_unsubscribed RETURNING id`,
    );
    return res.rows.length > 0;
  }

  async statesOf(tx: Tx, orgId: number, contactId: number): Promise<StateRow[]> {
    const res = await tx.execute(sql`
      SELECT channel, purpose, state, last_occurred_at FROM contact_consent_state
      WHERE org_id = ${orgId} AND contact_id = ${contactId} ORDER BY channel, purpose`);
    return (res.rows as Raw[]).map((r) => ({
      channel: r.channel as string,
      purpose: r.purpose as string,
      state: r.state as string,
      lastOccurredAt: iso(r.last_occurred_at),
    }));
  }

  async isUnsubscribed(tx: Tx, orgId: number, contactId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT is_unsubscribed FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    return (res.rows[0] as Raw | undefined)?.is_unsubscribed === true;
  }

  /** Newest recorded first (identity order is a stable keyset); `after` is the id of the last row of the previous page. */
  async listEvents(
    tx: Tx,
    orgId: number,
    f: {
      contactId?: number;
      channel?: string;
      action?: string;
      source?: string;
      after?: number | null;
      limit: number;
    },
  ): Promise<EventRow[]> {
    const where = [sql`e.org_id = ${orgId}`];
    if (f.contactId !== undefined) where.push(sql`e.contact_id = ${f.contactId}`);
    if (f.channel) where.push(sql`e.channel = ${f.channel}`);
    if (f.action) where.push(sql`e.action = ${f.action}`);
    if (f.source) where.push(sql`e.source = ${f.source}`);
    if (f.after) where.push(sql`e.id < ${f.after}`);
    const res = await tx.execute(sql`
      SELECT e.id, e.uuid, e.contact_id, c.uuid AS contact_uuid, e.channel, e.purpose, e.action, e.source, e.evidence,
             u.uuid AS actor_uuid, u.full_name AS actor_name, e.note, e.occurred_at, e.recorded_at
      FROM contact_consent_events e
      LEFT JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
      LEFT JOIN users u ON u.org_id = e.org_id AND u.id = e.actor_user_id
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY e.id DESC
      LIMIT ${f.limit}`);
    return (res.rows as Raw[]).map((r) => ({
      id: num(r.id),
      uuid: r.uuid as string,
      contactId: r.contact_id === null ? null : num(r.contact_id),
      contactUuid: (r.contact_uuid as string | null) ?? null,
      channel: r.channel as string,
      purpose: r.purpose as string,
      action: r.action as string,
      source: r.source as string,
      evidence: (r.evidence as Record<string, unknown>) ?? {},
      actorUuid: (r.actor_uuid as string | null) ?? null,
      actorName: (r.actor_name as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      occurredAt: iso(r.occurred_at),
      recordedAt: iso(r.recorded_at),
    }));
  }

  async eventByKey(
    tx: Tx,
    orgId: number,
    key: string,
  ): Promise<{ contactId: number | null; action: string; channel: string } | null> {
    const res = await tx.execute(sql`
      SELECT contact_id, action, channel FROM contact_consent_events WHERE org_id = ${orgId} AND idempotency_key = ${key}`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          contactId: r.contact_id === null ? null : num(r.contact_id),
          action: r.action as string,
          channel: r.channel as string,
        }
      : null;
  }

  // --- settings ---------------------------------------------------------------------------------------------------------------

  async getSettings(tx: Tx, orgId: number): Promise<SettingsRow | null> {
    const res = await tx.execute(sql`
      SELECT detection_enabled, require_consent_for_marketing, auto_reply_enabled, footer_default_on, config, row_version, updated_at
      FROM contact_consent_settings WHERE org_id = ${orgId}`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return {
      detectionEnabled: r.detection_enabled as boolean,
      requireConsentForMarketing: r.require_consent_for_marketing as boolean,
      autoReplyEnabled: r.auto_reply_enabled as boolean,
      footerDefaultOn: r.footer_default_on as boolean,
      config: (r.config as Record<string, unknown>) ?? {},
      rowVersion: num(r.row_version),
      updatedAt: iso(r.updated_at),
    };
  }

  /** First save inserts (no version); later saves need the version they read. False on a conflict. */
  async saveSettings(
    tx: Tx,
    orgId: number,
    v: Omit<SettingsRow, 'rowVersion' | 'updatedAt'>,
    rowVersion: number | undefined,
  ): Promise<boolean> {
    const cfg = JSON.stringify(v.config);
    if (rowVersion === undefined) {
      const res = await tx.execute(sql`
        INSERT INTO contact_consent_settings (org_id, detection_enabled, require_consent_for_marketing, auto_reply_enabled, footer_default_on, config)
        VALUES (${orgId}, ${v.detectionEnabled}, ${v.requireConsentForMarketing}, ${v.autoReplyEnabled}, ${v.footerDefaultOn}, ${cfg}::jsonb)
        ON CONFLICT (org_id) DO NOTHING RETURNING org_id`);
      return res.rows.length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE contact_consent_settings
      SET detection_enabled = ${v.detectionEnabled}, require_consent_for_marketing = ${v.requireConsentForMarketing},
          auto_reply_enabled = ${v.autoReplyEnabled}, footer_default_on = ${v.footerDefaultOn}, config = ${cfg}::jsonb
      WHERE org_id = ${orgId} AND row_version = ${rowVersion} RETURNING org_id`);
    return res.rows.length > 0;
  }
}
