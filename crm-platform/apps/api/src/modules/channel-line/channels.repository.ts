import { Injectable } from '@nestjs/common';
import type { TokenColumns } from '../../common/crypto/secret-columns';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface ChannelRow {
  id: number;
  uuid: string;
  lineChannelId: string | null;
  basicId: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  /** Encrypted. */
  channelAccessToken: string;
  /** Encrypted. */
  channelSecret: string;
  assertionKid: string | null;
  /** Encrypted. */
  assertionPrivateKey: string | null;
  /** Encrypted. */
  rotatingToken: string | null;
  /** Encrypted. */
  rotatingTokenKeyId: string | null;
  rotatingTokenExpiresAt: Date | null;
  webhookToken: string | null;
  /** The token sealed with CryptoService (encryption audit E3); preferred over the legacy plaintext column. */
  webhookTokenEnc: string | null;
  active: boolean;
  connectedAt: Date | null;
  lastInboundAt: Date | null;
  lastError: string | null;
  rowVersion: number;
}

interface Raw {
  id: number | string;
  uuid: string;
  line_channel_id: string | null;
  basic_id: string | null;
  display_name: string | null;
  picture_url: string | null;
  channel_access_token: string;
  channel_secret: string;
  assertion_kid: string | null;
  assertion_private_key: string | null;
  rotating_token: string | null;
  rotating_token_key_id: string | null;
  rotating_token_expires_at: Date | string | null;
  webhook_token: string | null;
  webhook_token_enc: string | null;
  active: boolean;
  connected_at: Date | string | null;
  last_inbound_at: Date | string | null;
  last_error: string | null;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, line_channel_id, basic_id, display_name, picture_url, channel_access_token, channel_secret, assertion_kid,
   assertion_private_key, rotating_token, rotating_token_key_id, rotating_token_expires_at, webhook_token, webhook_token_enc, active, connected_at,
   last_inbound_at, last_error, row_version`,
);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));

const toRow = (r: Raw): ChannelRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  lineChannelId: r.line_channel_id,
  basicId: r.basic_id,
  displayName: r.display_name,
  pictureUrl: r.picture_url,
  channelAccessToken: r.channel_access_token,
  channelSecret: r.channel_secret,
  assertionKid: r.assertion_kid,
  assertionPrivateKey: r.assertion_private_key,
  rotatingToken: r.rotating_token,
  rotatingTokenKeyId: r.rotating_token_key_id,
  rotatingTokenExpiresAt: date(r.rotating_token_expires_at),
  webhookToken: r.webhook_token,
  webhookTokenEnc: r.webhook_token_enc,
  active: r.active,
  connectedAt: date(r.connected_at),
  lastInboundAt: date(r.last_inbound_at),
  lastError: r.last_error,
  rowVersion: r.row_version,
});

/** `line_channels`, always inside the caller's tenant transaction (RLS scopes every statement). */
@Injectable()
export class ChannelsRepository {
  async list(tx: Tx, orgId: number): Promise<ChannelRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM line_channels WHERE org_id = ${orgId} ORDER BY id`,
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
      sql`SELECT ${COLUMNS} FROM line_channels WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ChannelRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM line_channels WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** The Official Account already connected for this LINE basic id, so a re-pasted pair of credentials updates the same row. */
  async findByBasicId(tx: Tx, orgId: number, basicId: string): Promise<ChannelRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM line_channels WHERE org_id = ${orgId} AND basic_id = ${basicId} ORDER BY id LIMIT 1 FOR UPDATE`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** A push arrived: the channel is alive. Reference clears the error on every verified delivery. */
  async touchInbound(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE line_channels SET last_inbound_at = now(), last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      connectedBy: number | null;
      channelAccessToken: string;
      channelSecret: string;
      lineChannelId: string;
      basicId: string;
      displayName: string;
      pictureUrl: string;
      webhookToken: TokenColumns;
    },
  ): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      INSERT INTO line_channels (org_id, connected_by, channel_access_token, channel_secret, line_channel_id, basic_id, display_name,
                                 picture_url, webhook_token, webhook_token_hash, webhook_token_enc, active, connected_at, last_error)
      VALUES (${orgId}, ${v.connectedBy}, ${v.channelAccessToken}, ${v.channelSecret}, ${v.lineChannelId}, ${v.basicId},
              ${v.displayName}, ${v.pictureUrl}, ${v.webhookToken.plain},
              ${v.webhookToken.hash}, ${v.webhookToken.enc}, true, now(), NULL)
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /**
   * Re-pasted credentials: same routing token, active again, error cleared. The channel id is kept when it is the numeric Channel ID
   * (set up for token rotation): the bot user id LINE reports would overwrite it.
   */
  async reconnect(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      connectedBy: number | null;
      channelAccessToken: string;
      channelSecret: string;
      lineChannelId: string;
      basicId: string;
      displayName: string;
      pictureUrl: string;
    },
  ): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      UPDATE line_channels SET connected_by = ${v.connectedBy}, channel_access_token = ${v.channelAccessToken},
             channel_secret = ${v.channelSecret},
             line_channel_id = CASE WHEN line_channel_id ~ '^[0-9]+$' THEN line_channel_id ELSE ${v.lineChannelId} END,
             basic_id = ${v.basicId}, display_name = ${v.displayName}, picture_url = ${v.pictureUrl},
             active = true, connected_at = now(), last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setError(tx: Tx, orgId: number, id: number, error: string | null): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      UPDATE line_channels SET last_error = ${error}
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setActive(tx: Tx, orgId: number, id: number, active: boolean): Promise<ChannelRow> {
    const res = await tx.execute(
      sql`UPDATE line_channels SET active = ${active} WHERE org_id = ${orgId} AND id = ${id} RETURNING ${COLUMNS}`,
    );
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** Turns rotation on (key id, encrypted private key, optionally the numeric Channel ID) or off (all cleared, back to the pasted token). */
  async setRotation(
    tx: Tx,
    orgId: number,
    id: number,
    v: { kid: string | null; privateKey: string | null; channelId?: string | null },
  ): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      UPDATE line_channels SET assertion_kid = ${v.kid}, assertion_private_key = ${v.privateKey},
             line_channel_id = coalesce(${v.channelId ?? null}, line_channel_id),
             rotating_token = NULL, rotating_token_key_id = NULL, rotating_token_expires_at = NULL
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** A freshly minted v2.1 token: encrypted token and key id, its expiry, and the error cleared. */
  async saveRotatedToken(
    tx: Tx,
    orgId: number,
    id: number,
    v: { token: string; keyId: string; expiresAt: Date },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE line_channels SET rotating_token = ${v.token}, rotating_token_key_id = ${v.keyId},
             rotating_token_expires_at = ${v.expiresAt.toISOString()}::timestamptz, last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM line_channels WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
