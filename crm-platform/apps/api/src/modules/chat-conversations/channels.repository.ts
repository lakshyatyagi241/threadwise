import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ChannelCapabilities, ChannelSettings, ChannelStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';

/**
 * Every SQL statement of the channel registry. Each method takes the transaction it runs in (tenant scoping is the caller's, through
 * DatabaseService.tx) and names `org_id` itself so the planner can use the (org_id, ...) indexes; row-level security is the backstop,
 * not the filter.
 *
 * The read columns never include `credentials_enc` or `webhook_token_hash`: a list or a read cannot leak a secret it never selected.
 * The sealed credentials come only from `credentialsOf`, and the token hash only from `webhookTokenHashOf`.
 */

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export interface ChannelRow {
  id: number;
  uuid: string;
  kind: string;
  name: string;
  status: ChannelStatus;
  externalId: string | null;
  displayAddress: string | null;
  hasCredentials: boolean;
  credentialHints: Record<string, string>;
  capabilities: Partial<ChannelCapabilities>;
  settings: ChannelSettings;
  lastEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

const COLUMNS = sql`id, uuid, kind, name, status, external_id, display_address, credential_hints,
  (credentials_enc IS NOT NULL) AS has_credentials, capabilities, settings, last_event_at, created_at, updated_at, row_version`;

const toRow = (r: Raw): ChannelRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  kind: r.kind as string,
  name: r.name as string,
  status: r.status as ChannelStatus,
  externalId: (r.external_id as string | null) ?? null,
  displayAddress: (r.display_address as string | null) ?? null,
  hasCredentials: r.has_credentials === true,
  credentialHints: (r.credential_hints as Record<string, string>) ?? {},
  capabilities: (r.capabilities as Partial<ChannelCapabilities>) ?? {},
  settings: (r.settings as ChannelSettings) ?? { metered: true },
  lastEventAt: date(r.last_event_at),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

export interface NewChannel {
  kind: string;
  name: string;
  status: ChannelStatus;
  externalId: string | null;
  displayAddress: string | null;
  credentialsEnc: string | null;
  credentialHints: Record<string, string>;
  webhookTokenHash: string | null;
  settings: ChannelSettings;
  createdBy: number | null;
}

export interface ChannelPatch {
  name?: string;
  status?: ChannelStatus;
  displayAddress?: string | null;
  externalId?: string | null;
  settings?: ChannelSettings;
  credentialsEnc?: string;
  credentialHints?: Record<string, string>;
}

@Injectable()
export class ChannelsRepository {
  async list(tx: Tx, orgId: number): Promise<ChannelRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM channels WHERE org_id = ${orgId} ORDER BY created_at, id`,
    );
    return rowsOf(res).map(toRow);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<ChannelRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM channels WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /** The channel of a provider account, by its handle (the unofficial engine: the device uuid). */
  async byExternal(
    tx: Tx,
    orgId: number,
    kind: string,
    externalId: string,
  ): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM channels
      WHERE org_id = ${orgId} AND kind = ${kind} AND external_id = ${externalId}`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<ChannelRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM channels WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /** The sealed credentials. Only the vault's caller (a send, a webhook, a rotation) asks for them. */
  async credentialsOf(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT credentials_enc FROM channels WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (rowsOf(res)[0]?.credentials_enc as string | null | undefined) ?? null;
  }

  async webhookTokenHashOf(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT webhook_token_hash FROM channels WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (rowsOf(res)[0]?.webhook_token_hash as string | null | undefined) ?? null;
  }

  /** Null when the same provider account is already connected here (the unique key on kind + external id). */
  async insert(tx: Tx, orgId: number, c: NewChannel): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      INSERT INTO channels (org_id, kind, name, status, external_id, display_address, credentials_enc, credential_hints,
                            webhook_token_hash, webhook_token_rotated_at, settings, created_by)
      VALUES (${orgId}, ${c.kind}, ${c.name}, ${c.status}, ${c.externalId}, ${c.displayAddress}, ${c.credentialsEnc},
              ${JSON.stringify(c.credentialHints)}::jsonb, ${c.webhookTokenHash},
              ${c.webhookTokenHash ? sql`now()` : sql`NULL`}, ${JSON.stringify(c.settings)}::jsonb, ${c.createdBy})
      ON CONFLICT (org_id, kind, external_id) DO NOTHING
      RETURNING ${COLUMNS}`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /**
   * Optimistic update: null when the row moved since the caller read it (or does not exist). A changed `external_id` that collides
   * with another channel surfaces as a unique violation, which the service maps to CHANNEL_ALREADY_CONNECTED.
   */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    p: ChannelPatch,
  ): Promise<ChannelRow | null> {
    const sets: SQL[] = [];
    if (p.name !== undefined) sets.push(sql`name = ${p.name}`);
    if (p.status !== undefined) sets.push(sql`status = ${p.status}`);
    if (p.displayAddress !== undefined) sets.push(sql`display_address = ${p.displayAddress}`);
    if (p.externalId !== undefined) sets.push(sql`external_id = ${p.externalId}`);
    if (p.settings !== undefined) sets.push(sql`settings = ${JSON.stringify(p.settings)}::jsonb`);
    if (p.credentialsEnc !== undefined) {
      sets.push(sql`credentials_enc = ${p.credentialsEnc}`);
      sets.push(sql`credential_hints = ${JSON.stringify(p.credentialHints ?? {})}::jsonb`);
    }
    if (sets.length === 0) sets.push(sql`name = name`);
    const res = await tx.execute(sql`
      UPDATE channels SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING ${COLUMNS}`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  async setWebhookTokenHash(
    tx: Tx,
    orgId: number,
    id: number,
    hash: string,
  ): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      UPDATE channels SET webhook_token_hash = ${hash}, webhook_token_rotated_at = now()
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM channels WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return rowsOf(res).length > 0;
  }

  /**
   * Resolves a webhook's channel uuid to its tenant through the SECURITY DEFINER lookup (no tenant exists yet on a public route).
   * Takes the raw handle, not a tenant transaction.
   */
  async locate(
    db: { execute: (q: SQL) => Promise<{ rows: unknown[] }> },
    uuid: string,
  ): Promise<{ id: number; orgId: number } | null> {
    const res = await db.execute(sql`SELECT * FROM chat_channel_lookup(${uuid}::uuid)`);
    const r = rowsOf(res)[0];
    return r ? { id: Number(r.channel_id), orgId: Number(r.channel_org_id) } : null;
  }
}
