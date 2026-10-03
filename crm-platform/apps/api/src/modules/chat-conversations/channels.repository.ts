import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  ChannelCapabilities,
  ChannelHealth,
  ChannelLastError,
  ChannelSettings,
  ChannelStatus,
} from '@crm/contracts';
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
  businessAccountId: string | null;
  /** `wa_provider_configs.id` of the WhatsApp connection this channel is the inbox view of (null: not a WhatsApp number, or detached). */
  wabaConfigId: number | null;
  hasCredentials: boolean;
  credentialHints: Record<string, string>;
  capabilities: Partial<ChannelCapabilities>;
  settings: ChannelSettings;
  health: ChannelHealth | null;
  lastError: ChannelLastError | null;
  lastEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

const COLUMNS = sql`id, uuid, kind, name, status, external_id, display_address, business_account_id, waba_config_id, credential_hints,
  (credentials_enc IS NOT NULL) AS has_credentials, capabilities, settings, health, last_error, last_event_at, created_at, updated_at, row_version`;

const toRow = (r: Raw): ChannelRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  kind: r.kind as string,
  name: r.name as string,
  status: r.status as ChannelStatus,
  externalId: (r.external_id as string | null) ?? null,
  displayAddress: (r.display_address as string | null) ?? null,
  businessAccountId: (r.business_account_id as string | null) ?? null,
  wabaConfigId:
    r.waba_config_id === null || r.waba_config_id === undefined ? null : Number(r.waba_config_id),
  hasCredentials: r.has_credentials === true,
  credentialHints: (r.credential_hints as Record<string, string>) ?? {},
  capabilities: (r.capabilities as Partial<ChannelCapabilities>) ?? {},
  settings: (r.settings as ChannelSettings) ?? { metered: true },
  health: (r.health as ChannelHealth | null) ?? null,
  lastError: (r.last_error as ChannelLastError | null) ?? null,
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
  businessAccountId?: string | null;
  wabaConfigId?: number | null;
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
  businessAccountId?: string | null;
  settings?: ChannelSettings;
  credentialsEnc?: string;
  credentialHints?: Record<string, string>;
  /** The last health check; stored with its time. */
  health?: ChannelHealth | null;
  /** null clears it (the channel was switched on again, or a check passed). */
  lastError?: ChannelLastError | null;
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

  /**
   * Null when the same provider account is already connected: here (the unique key on org + kind + external id) or, for a WhatsApp
   * number, in any workspace (one number, one channel).
   */
  async insert(tx: Tx, orgId: number, c: NewChannel): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      INSERT INTO channels (org_id, kind, name, status, external_id, display_address, business_account_id, waba_config_id, credentials_enc, credential_hints,
                            webhook_token_hash, webhook_token_rotated_at, settings, created_by)
      VALUES (${orgId}, ${c.kind}, ${c.name}, ${c.status}, ${c.externalId}, ${c.displayAddress}, ${c.businessAccountId ?? null}, ${c.wabaConfigId ?? null}, ${c.credentialsEnc},
              ${JSON.stringify(c.credentialHints)}::jsonb, ${c.webhookTokenHash},
              ${c.webhookTokenHash ? sql`now()` : sql`NULL`}, ${JSON.stringify(c.settings)}::jsonb, ${c.createdBy})
      ON CONFLICT DO NOTHING
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
    if (p.businessAccountId !== undefined) {
      sets.push(sql`business_account_id = ${p.businessAccountId}`);
    }
    if (p.health !== undefined) {
      sets.push(
        p.health === null
          ? sql`health = NULL, health_checked_at = NULL`
          : sql`health = ${JSON.stringify(p.health)}::jsonb, health_checked_at = ${p.health.checkedAt}::timestamptz`,
      );
    }
    if (p.lastError !== undefined) {
      sets.push(
        p.lastError === null
          ? sql`last_error = NULL`
          : sql`last_error = ${JSON.stringify(p.lastError)}::jsonb`,
      );
    }
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

  /**
   * The system noticed the provider no longer accepts this channel's credentials: a `connected` channel moves to `status`
   * (`needs_reauth`, or `error` when the platform's own credential is what failed), with the reason. Conditional on the status so the
   * first send to notice wins and every later one is a no-op; returns the row only when it moved.
   */
  async markCredentialsRefused(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'needs_reauth' | 'error',
    error: ChannelLastError,
  ): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      UPDATE channels SET status = ${status}, last_error = ${JSON.stringify(error)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'connected'
      RETURNING ${COLUMNS}`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /**
   * A health check's outcome: the snapshot, the (possibly moved) status and the last error. Not versioned on purpose: it is the
   * system's bookkeeping, not an edit a person is making, so it must not fail against a person's stale `rowVersion` (the answer
   * carries the new version for the next edit).
   */
  async recordHealth(
    tx: Tx,
    orgId: number,
    id: number,
    r: { status: ChannelStatus; health: ChannelHealth; lastError: ChannelLastError | null },
  ): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      UPDATE channels SET status = ${r.status}, health = ${JSON.stringify(r.health)}::jsonb,
        health_checked_at = ${r.health.checkedAt}::timestamptz,
        last_error = ${r.lastError === null ? sql`NULL` : sql`${JSON.stringify(r.lastError)}::jsonb`}
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    const x = rowsOf(res)[0];
    return x ? toRow(x) : null;
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

  // --- the WhatsApp link ------------------------------------------------------------------------------------------------------------

  /** The channel that is the inbox view of this WABA connection. */
  async byWabaConfig(tx: Tx, orgId: number, configId: number): Promise<ChannelRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM channels WHERE org_id = ${orgId} AND waba_config_id = ${configId}`,
    );
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /** A provider account already stored as a channel of this workspace (a WhatsApp number created before it was linked). */
  async byExternal(
    tx: Tx,
    orgId: number,
    kind: string,
    externalId: string,
  ): Promise<ChannelRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM channels WHERE org_id = ${orgId} AND kind = ${kind} AND external_id = ${externalId}`,
    );
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /**
   * The system keeping a linked channel in step with its WABA connection: the link itself, the status, the number as people write it,
   * the account id, and (when the connection came back) the last error cleared. Not versioned on purpose, like `recordHealth`: it is
   * bookkeeping, not an edit a person is making.
   */
  async syncWaba(
    tx: Tx,
    orgId: number,
    id: number,
    p: {
      wabaConfigId?: number;
      status?: ChannelStatus;
      displayAddress?: string | null;
      businessAccountId?: string | null;
      clearLastError?: boolean;
    },
  ): Promise<ChannelRow | null> {
    const sets: SQL[] = [];
    if (p.wabaConfigId !== undefined) sets.push(sql`waba_config_id = ${p.wabaConfigId}`);
    if (p.status !== undefined) sets.push(sql`status = ${p.status}`);
    if (p.displayAddress !== undefined) sets.push(sql`display_address = ${p.displayAddress}`);
    if (p.businessAccountId !== undefined)
      sets.push(sql`business_account_id = ${p.businessAccountId}`);
    if (p.clearLastError) sets.push(sql`last_error = NULL`);
    if (sets.length === 0) return this.byId(tx, orgId, id);
    const res = await tx.execute(sql`
      UPDATE channels SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /**
   * After a WABA connection was deleted: the channels of this kind that lost their link (the foreign key nulls it) and still say
   * `connected` are shown `disconnected`. Returns the rows that moved.
   */
  async disconnectUnlinked(tx: Tx, orgId: number, kind: string): Promise<ChannelRow[]> {
    const res = await tx.execute(sql`
      UPDATE channels SET status = 'disconnected'
      WHERE org_id = ${orgId} AND kind = ${kind} AND waba_config_id IS NULL AND status = 'connected'
      RETURNING ${COLUMNS}`);
    return rowsOf(res).map(toRow);
  }
}
