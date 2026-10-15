import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface ChannelRow {
  id: number;
  uuid: string;
  viberId: string | null;
  name: string | null;
  uri: string | null;
  avatar: string | null;
  /** Encrypted. */
  authToken: string;
  webhookToken: string;
  active: boolean;
  connectedAt: Date | null;
  lastInboundAt: Date | null;
  lastError: string | null;
  rowVersion: number;
}

interface Raw {
  id: number | string;
  uuid: string;
  viber_id: string | null;
  bot_name: string | null;
  bot_uri: string | null;
  bot_avatar: string | null;
  auth_token: string;
  webhook_token: string;
  active: boolean;
  connected_at: Date | string | null;
  last_inbound_at: Date | string | null;
  last_error: string | null;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, viber_id, bot_name, bot_uri, bot_avatar, auth_token, webhook_token, active, connected_at, last_inbound_at,
   last_error, row_version`,
);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));

const toRow = (r: Raw): ChannelRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  viberId: r.viber_id,
  name: r.bot_name,
  uri: r.bot_uri,
  avatar: r.bot_avatar,
  authToken: r.auth_token,
  webhookToken: r.webhook_token,
  active: r.active,
  connectedAt: date(r.connected_at),
  lastInboundAt: date(r.last_inbound_at),
  lastError: r.last_error,
  rowVersion: r.row_version,
});

/** `viber_channels`, always inside the caller's tenant transaction (RLS scopes every statement). */
@Injectable()
export class ChannelsRepository {
  async list(tx: Tx, orgId: number): Promise<ChannelRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM viber_channels WHERE org_id = ${orgId} ORDER BY id`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<ChannelRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM viber_channels WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ChannelRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM viber_channels WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** The channel already connected for this Viber account, so a re-pasted token updates the same row. */
  async findByViberId(tx: Tx, orgId: number, viberId: string): Promise<ChannelRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM viber_channels WHERE org_id = ${orgId} AND viber_id = ${viberId} ORDER BY id LIMIT 1 FOR UPDATE`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** A push arrived: the channel is alive, and a stale error is cleared (Reference's rule). */
  async touchInbound(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE viber_channels SET last_inbound_at = now(), last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      connectedBy: number | null;
      authToken: string;
      viberId: string;
      name: string;
      uri: string;
      avatar: string;
      webhookToken: string;
    },
  ): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      INSERT INTO viber_channels (org_id, connected_by, auth_token, viber_id, bot_name, bot_uri, bot_avatar, webhook_token,
                                  active, connected_at, last_error)
      VALUES (${orgId}, ${v.connectedBy}, ${v.authToken}, ${v.viberId}, ${v.name}, ${v.uri}, ${v.avatar}, ${v.webhookToken},
              true, now(), NULL)
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** A re-pasted token: same routing token, active again, error cleared. */
  async reconnect(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      connectedBy: number | null;
      authToken: string;
      name: string;
      uri: string;
      avatar: string;
    },
  ): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      UPDATE viber_channels SET connected_by = ${v.connectedBy}, auth_token = ${v.authToken}, bot_name = ${v.name},
             bot_uri = ${v.uri}, bot_avatar = ${v.avatar}, active = true, connected_at = now(), last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setError(tx: Tx, orgId: number, id: number, error: string | null): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      UPDATE viber_channels SET last_error = ${error}
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setActive(tx: Tx, orgId: number, id: number, active: boolean): Promise<ChannelRow> {
    const res = await tx.execute(
      sql`UPDATE viber_channels SET active = ${active} WHERE org_id = ${orgId} AND id = ${id} RETURNING ${COLUMNS}`,
    );
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM viber_channels WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
