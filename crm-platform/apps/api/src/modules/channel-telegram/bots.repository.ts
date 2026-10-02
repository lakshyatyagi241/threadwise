import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface BotRow {
  id: number;
  uuid: string;
  botId: string | null;
  username: string | null;
  name: string | null;
  /** Encrypted. */
  botToken: string;
  webhookToken: string;
  /** Encrypted. */
  secretToken: string | null;
  active: boolean;
  connectedAt: Date | null;
  lastInboundAt: Date | null;
  lastError: string | null;
  /** Encrypted. */
  paymentProviderToken: string | null;
  paymentProvider: string | null;
  rowVersion: number;
}

interface Raw {
  id: number | string;
  uuid: string;
  bot_id: string | null;
  bot_username: string | null;
  bot_name: string | null;
  bot_token: string;
  webhook_token: string;
  secret_token: string | null;
  active: boolean;
  connected_at: Date | string | null;
  last_inbound_at: Date | string | null;
  last_error: string | null;
  payment_provider_token: string | null;
  payment_provider: string | null;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, bot_id, bot_username, bot_name, bot_token, webhook_token, secret_token, active, connected_at, last_inbound_at,
   last_error, payment_provider_token, payment_provider, row_version`,
);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));

const toRow = (r: Raw): BotRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  botId: r.bot_id,
  username: r.bot_username,
  name: r.bot_name,
  botToken: r.bot_token,
  webhookToken: r.webhook_token,
  secretToken: r.secret_token,
  active: r.active,
  connectedAt: date(r.connected_at),
  lastInboundAt: date(r.last_inbound_at),
  lastError: r.last_error,
  paymentProviderToken: r.payment_provider_token,
  paymentProvider: r.payment_provider,
  rowVersion: r.row_version,
});

/** `telegram_bots`, always inside the caller's tenant transaction (RLS scopes every statement). */
@Injectable()
export class BotsRepository {
  async list(tx: Tx, orgId: number): Promise<BotRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM telegram_bots WHERE org_id = ${orgId} ORDER BY id`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM telegram_bots WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<BotRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM telegram_bots WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** The bot already connected for this Telegram bot id, so a re-pasted token updates the same row. */
  async findByTelegramId(tx: Tx, orgId: number, botId: string): Promise<BotRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM telegram_bots WHERE org_id = ${orgId} AND bot_id = ${botId} ORDER BY id LIMIT 1 FOR UPDATE`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      connectedBy: number | null;
      botToken: string;
      botId: string;
      username: string;
      name: string;
      webhookToken: string;
      secretToken: string;
    },
  ): Promise<BotRow> {
    const res = await tx.execute(sql`
      INSERT INTO telegram_bots (org_id, connected_by, bot_token, bot_id, bot_username, bot_name, webhook_token, secret_token,
                                 active, connected_at, last_error)
      VALUES (${orgId}, ${v.connectedBy}, ${v.botToken}, ${v.botId}, ${v.username}, ${v.name}, ${v.webhookToken},
              ${v.secretToken}, true, now(), NULL)
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** A re-pasted token: same routing token, a fresh secret, active again, error cleared. */
  async reconnect(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      connectedBy: number | null;
      botToken: string;
      username: string;
      name: string;
      secretToken: string;
    },
  ): Promise<BotRow> {
    const res = await tx.execute(sql`
      UPDATE telegram_bots SET connected_by = ${v.connectedBy}, bot_token = ${v.botToken}, bot_username = ${v.username},
             bot_name = ${v.name}, secret_token = ${v.secretToken}, active = true, connected_at = now(), last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setError(
    tx: Tx,
    orgId: number,
    id: number,
    error: string | null,
    active?: boolean,
  ): Promise<BotRow> {
    const res = await tx.execute(sql`
      UPDATE telegram_bots SET last_error = ${error}, active = coalesce(${active ?? null}::boolean, active)
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setActive(tx: Tx, orgId: number, id: number, active: boolean): Promise<BotRow> {
    const res = await tx.execute(
      sql`UPDATE telegram_bots SET active = ${active} WHERE org_id = ${orgId} AND id = ${id} RETURNING ${COLUMNS}`,
    );
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setPayments(
    tx: Tx,
    orgId: number,
    id: number,
    v: { provider: string | null; token: string | null | undefined },
  ): Promise<BotRow> {
    // `undefined` keeps the saved token; null removes it; a string replaces it.
    const res = await tx.execute(sql`
      UPDATE telegram_bots SET payment_provider = ${v.provider},
             payment_provider_token = CASE WHEN ${v.token === undefined} THEN payment_provider_token ELSE ${v.token ?? null} END
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM telegram_bots WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
