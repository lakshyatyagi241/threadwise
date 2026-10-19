import { Injectable } from '@nestjs/common';
import type { TokenColumns } from '../../common/crypto/secret-columns';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface ChannelRow {
  id: number;
  uuid: string;
  appId: string | null;
  /** Encrypted. */
  appSecret: string;
  /** Encrypted. */
  verifyToken: string;
  /** Encrypted. */
  encodingAesKey: string | null;
  encMode: 'plain' | 'compat' | 'safe';
  webhookToken: string | null;
  /** The token sealed with CryptoService (encryption audit E3); preferred over the legacy plaintext column. */
  webhookTokenEnc: string | null;
  wxId: string | null;
  accountName: string | null;
  /** Encrypted. */
  cachedAccessToken: string | null;
  tokenExpiresAt: Date | null;
  active: boolean;
  connectedAt: Date | null;
  lastInboundAt: Date | null;
  lastError: string | null;
  rowVersion: number;
}

interface Raw {
  id: number | string;
  uuid: string;
  app_id: string | null;
  app_secret: string;
  verify_token: string;
  encoding_aes_key: string | null;
  enc_mode: string;
  webhook_token: string | null;
  webhook_token_enc: string | null;
  wx_id: string | null;
  account_name: string | null;
  cached_access_token: string | null;
  token_expires_at: Date | string | null;
  active: boolean;
  connected_at: Date | string | null;
  last_inbound_at: Date | string | null;
  last_error: string | null;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, app_id, app_secret, verify_token, encoding_aes_key, enc_mode, webhook_token, webhook_token_enc, wx_id, account_name,
   cached_access_token, token_expires_at, active, connected_at, last_inbound_at, last_error, row_version`,
);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));

const toRow = (r: Raw): ChannelRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  appId: r.app_id,
  appSecret: r.app_secret,
  verifyToken: r.verify_token,
  encodingAesKey: r.encoding_aes_key,
  encMode: (['plain', 'compat', 'safe'] as const).find((m) => m === r.enc_mode) ?? 'compat',
  webhookToken: r.webhook_token,
  webhookTokenEnc: r.webhook_token_enc,
  wxId: r.wx_id,
  accountName: r.account_name,
  cachedAccessToken: r.cached_access_token,
  tokenExpiresAt: date(r.token_expires_at),
  active: r.active,
  connectedAt: date(r.connected_at),
  lastInboundAt: date(r.last_inbound_at),
  lastError: r.last_error,
  rowVersion: r.row_version,
});

/** What a connect writes: every secret already encrypted. */
export interface ConnectValues {
  connectedBy: number | null;
  appId: string;
  appSecret: string;
  verifyToken: string;
  encodingAesKey: string | null;
  encMode: string;
  accountName: string;
  cachedAccessToken: string;
  tokenExpiresAt: Date;
}

/** `wechat_channels`, always inside the caller's tenant transaction (RLS scopes every statement). */
@Injectable()
export class ChannelsRepository {
  /** The workspace's onboarding country and its billing country (latest paid order), both as saved; Compliance reads them the same way. */
  async orgCountries(
    tx: Tx,
    orgId: number,
  ): Promise<{ onboarding: string | null; billing: string | null }> {
    const res = await tx.execute(sql`
      SELECT o.settings->>'country' AS onboarding,
        (SELECT upper(btrim(x.billing_country)) FROM orders x
          WHERE x.org_id = o.id AND x.status = 'paid' AND btrim(coalesce(x.billing_country, '')) <> ''
          ORDER BY x.paid_at DESC NULLS LAST, x.id DESC LIMIT 1) AS billing
      FROM organizations o WHERE o.id = ${orgId}`);
    const r = (res.rows[0] ?? {}) as { onboarding?: string | null; billing?: string | null };
    return { onboarding: r.onboarding ?? null, billing: r.billing ?? null };
  }

  async list(tx: Tx, orgId: number): Promise<ChannelRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wechat_channels WHERE org_id = ${orgId} ORDER BY id`,
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
      sql`SELECT ${COLUMNS} FROM wechat_channels WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ChannelRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wechat_channels WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** The channel already connected for this AppID, so a re-pasted account updates the same row and keeps its webhook address. */
  /** Serialises two connects of one AppID in one workspace: neither can miss the other's new row. */
  async lockAppId(tx: Tx, orgId: number, appId: string): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wechat-connect:${orgId}:${appId}`}, 0))`,
    );
  }

  async findByAppId(tx: Tx, orgId: number, appId: string): Promise<ChannelRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wechat_channels WHERE org_id = ${orgId} AND app_id = ${appId} ORDER BY id LIMIT 1 FOR UPDATE`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: ConnectValues & { webhookToken: TokenColumns },
  ): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      INSERT INTO wechat_channels (org_id, connected_by, app_id, app_secret, verify_token, encoding_aes_key, enc_mode, webhook_token, webhook_token_hash, webhook_token_enc,
                                   account_name, cached_access_token, token_expires_at, active, connected_at, last_error)
      VALUES (${orgId}, ${v.connectedBy}, ${v.appId}, ${v.appSecret}, ${v.verifyToken}, ${v.encodingAesKey}, ${v.encMode},
              ${v.webhookToken.plain}, ${v.webhookToken.hash}, ${v.webhookToken.enc}, ${v.accountName}, ${v.cachedAccessToken}, ${v.tokenExpiresAt}, true, now(), NULL)
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** A re-pasted account: same routing token, new credentials, active again, error cleared. */
  async reconnect(tx: Tx, orgId: number, id: number, v: ConnectValues): Promise<ChannelRow> {
    const res = await tx.execute(sql`
      UPDATE wechat_channels SET connected_by = ${v.connectedBy}, app_id = ${v.appId}, app_secret = ${v.appSecret},
             verify_token = ${v.verifyToken}, encoding_aes_key = ${v.encodingAesKey}, enc_mode = ${v.encMode},
             account_name = ${v.accountName}, cached_access_token = ${v.cachedAccessToken}, token_expires_at = ${v.tokenExpiresAt},
             active = true, connected_at = now(), last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setActive(tx: Tx, orgId: number, id: number, active: boolean): Promise<ChannelRow> {
    const res = await tx.execute(
      sql`UPDATE wechat_channels SET active = ${active} WHERE org_id = ${orgId} AND id = ${id} RETURNING ${COLUMNS}`,
    );
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async setError(tx: Tx, orgId: number, id: number, error: string | null): Promise<ChannelRow> {
    const res = await tx.execute(
      sql`UPDATE wechat_channels SET last_error = ${error} WHERE org_id = ${orgId} AND id = ${id} RETURNING ${COLUMNS}`,
    );
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  /** A freshly fetched token (encrypted) and when it expires; a good token clears a stale error. */
  async saveToken(
    tx: Tx,
    orgId: number,
    id: number,
    encrypted: string,
    expiresAt: Date,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wechat_channels SET cached_access_token = ${encrypted}, token_expires_at = ${expiresAt}, last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Marks the cached token as expired, so the next call fetches a new one (WeChat said it is no longer valid). */
  async expireToken(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wechat_channels SET token_expires_at = now() - interval '1 minute' WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** A push arrived: the channel is alive. The Official Account's own id is learnt from the first one. */
  async touchInbound(tx: Tx, orgId: number, id: number, wxId: string | null): Promise<void> {
    await tx.execute(sql`
      UPDATE wechat_channels SET last_inbound_at = now(), last_error = NULL, wx_id = coalesce(wx_id, ${wxId})
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wechat_channels WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
