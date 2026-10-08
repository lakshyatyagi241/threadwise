import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../../auth/unofficial-whatsapp.port';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { assemblePhone } from '../catalog-rules';
import type { CatalogSenderRow, SenderDirectory, WabaCredentials } from './tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const senderPhone = (countryCode: string | null, phone: string | null): string | null =>
  assemblePhone(phone, countryCode) || null;

interface DeviceRow {
  id: number | string;
  uuid: string;
  label: string | null;
  country_code: string | null;
  phone_number: string | null;
}
interface ConfigRow {
  id: number | string;
  uuid: string;
  provider: string;
  label: string | null;
  phone_number: string | null;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Reads `devices` and `wa_provider_configs` directly until the device and WABA domains export their own lookup. Copied from
 * the broadcasts domain's directory on purpose (each domain owns its shim and its token).
 */
@Injectable()
export class SqlSenderDirectory implements SenderDirectory {
  constructor(
    private readonly crypto: CryptoService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async list(tx: Tx, orgId: number): Promise<CatalogSenderRow[]> {
    // Personal numbers are not senders while the platform switch is off (owner decision 2026-10-05).
    const unofficialOn = await this.unofficial.isEnabledFor(orgId);
    const devices = await tx.execute(sql`
      SELECT id, uuid, coalesce(nullif(device_name, ''), phone_number) AS label, country_code, phone_number
      FROM devices
      WHERE org_id = ${orgId} AND status = 'connected' AND ${unofficialOn}::boolean
      ORDER BY active DESC, id DESC`);
    const configs = await tx.execute(sql`
      SELECT id, uuid, provider, coalesce(nullif(display_label, ''), upper(provider)) AS label, phone_number
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio') AND status = 'connected'
      ORDER BY connected_at DESC NULLS LAST, id DESC`);
    return [
      ...(devices.rows as unknown as DeviceRow[]).map((d): CatalogSenderRow => ({
        key: `baileys:${d.uuid}`,
        engine: 'baileys',
        id: Number(d.id),
        label: d.label ?? '',
        phone: senderPhone(d.country_code, d.phone_number),
      })),
      ...(configs.rows as unknown as ConfigRow[]).map((c): CatalogSenderRow => ({
        key: `${c.provider}:${c.uuid}`,
        engine: c.provider as 'waba' | 'twilio',
        id: Number(c.id),
        label: c.label ?? '',
        phone: senderPhone(null, c.phone_number),
      })),
    ];
  }

  async resolve(tx: Tx, orgId: number, key: string): Promise<CatalogSenderRow | undefined> {
    const [engine, uuid] = key.trim().split(':');
    if (!engine || !uuid || !UUID.test(uuid)) return undefined;
    if (engine !== 'baileys' && engine !== 'waba' && engine !== 'twilio') return undefined;
    return (await this.list(tx, orgId)).find((s) => s.key === `${engine}:${uuid.toLowerCase()}`);
  }

  async baileysDevice(
    tx: Tx,
    orgId: number,
    pickedKey: string | undefined,
  ): Promise<CatalogSenderRow | undefined> {
    const devices = (await this.list(tx, orgId)).filter((s) => s.engine === 'baileys');
    const picked = pickedKey?.toLowerCase();
    return devices.find((d) => d.key === picked) ?? devices[0];
  }

  async wabaCredentials(tx: Tx, orgId: number): Promise<WabaCredentials | undefined> {
    const res = await tx.execute(sql`
      SELECT id, credentials_json, meta_json
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba' AND status = 'connected'
      ORDER BY is_primary DESC, connected_at DESC NULLS LAST, id DESC
      LIMIT 1`);
    const row = res.rows[0] as
      { id: number | string; credentials_json: string | null; meta_json: unknown } | undefined;
    if (!row) return undefined;

    let creds: Record<string, unknown> = {};
    if (row.credentials_json) {
      try {
        creds = JSON.parse(this.crypto.decrypt(row.credentials_json)) as Record<string, unknown>;
      } catch {
        creds = {};
      }
    }
    const meta =
      row.meta_json && typeof row.meta_json === 'object' && !Array.isArray(row.meta_json)
        ? (row.meta_json as Record<string, unknown>)
        : {};
    // meta_json wins over the credentials for each key (Reference's order).
    const pick = (k: string) => asString(meta[k] ?? creds[k]);
    return {
      configId: Number(row.id),
      accessToken: asString(creds.access_token),
      wabaId: pick('waba_id'),
      phoneNumberId: pick('phone_number_id'),
      businessId: pick('business_id'),
      catalogId: pick('catalog_id'),
      metaJson: meta,
    };
  }

  async saveWabaCatalogId(
    tx: Tx,
    orgId: number,
    configId: number,
    catalogId: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_provider_configs
      SET meta_json = coalesce(meta_json, '{}'::jsonb) || jsonb_build_object('catalog_id', ${catalogId}::text)
      WHERE org_id = ${orgId} AND id = ${configId}`);
  }

  async primaryPhone(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT phone_number FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider <> 'meta_ads'
      ORDER BY is_primary DESC, connected_at DESC NULLS LAST, id DESC
      LIMIT 1`);
    const p = (res.rows[0] as { phone_number: string | null } | undefined)?.phone_number?.trim();
    return p ? p : null;
  }
}
