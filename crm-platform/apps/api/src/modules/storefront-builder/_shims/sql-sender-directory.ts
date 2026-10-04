import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreConnection } from '@crm/contracts';
import { digitsOnly } from '../rules/phone';
import type { RecoverySender, SenderDirectory, WizardDevice } from './tokens';

const PROVIDER_LABELS: Record<string, string> = {
  waba: 'Official WABA (Meta Cloud)',
  baileys: 'Baileys (Node bridge)',
  twilio: 'Twilio WhatsApp',
};

const SEND_ENGINES = ['waba', 'baileys', 'twilio'];

interface DeviceRow {
  id: number | string;
  uuid: string;
  device_name: string | null;
  country_code: string | null;
  phone_number: string | null;
}
interface ConfigRow {
  id: number | string;
  provider: string;
  phone_number: string | null;
  display_label: string | null;
}

const devicePhone = (d: DeviceRow): string =>
  `${d.country_code ? `+${d.country_code} ` : ''}${d.phone_number ?? ''}`.trim();

/**
 * Reads `devices` and `wa_provider_configs` directly until whatsapp-devices-baileys and whatsapp-cloud-api-waba export their
 * own lookup (the same approach as broadcasts/_shims/sql-sender-directory.ts).
 */
@Injectable()
export class SqlSenderDirectory implements SenderDirectory {
  async wizard(tx: Tx, orgId: number): Promise<{ devices: WizardDevice[]; hasSender: boolean }> {
    const devices = await tx.execute(sql`
      SELECT id, uuid, device_name, country_code, phone_number FROM devices
      WHERE org_id = ${orgId} AND status = 'connected' ORDER BY id`);
    const primary = await this.primaryConfig(tx, orgId);
    const rows = devices.rows as unknown as DeviceRow[];
    return {
      devices: rows.map((d) => ({
        id: Number(d.id),
        uuid: d.uuid,
        label: d.device_name || `Device #${d.id}`,
        // The wizard prints the stored country code and number as they are, joined by a space (no plus added).
        phone: `${d.country_code ?? ''} ${d.phone_number ?? ''}`.trim() || null,
      })),
      // A connected PRIMARY official config counts, a connected non-primary one does not (WD-STORE-004).
      hasSender: rows.length > 0 || primary?.status === 'connected',
    };
  }

  async connectedDevice(tx: Tx, orgId: number, uuid: string): Promise<{ id: number } | undefined> {
    const res = await tx.execute(sql`
      SELECT id FROM devices WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'connected'`);
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? { id: Number(r.id) } : undefined;
  }

  async sendingLabels(
    tx: Tx,
    orgId: number,
    deviceIds: ReadonlyArray<number | null>,
  ): Promise<Array<string | null>> {
    const ids = [...new Set(deviceIds.filter((v): v is number => v !== null))];
    const byId = new Map<number, DeviceRow>();
    if (ids.length > 0) {
      const res = await tx.execute(sql`
        SELECT id, uuid, device_name, country_code, phone_number FROM devices
        WHERE org_id = ${orgId} AND id IN (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`);
      for (const d of res.rows as unknown as DeviceRow[]) byId.set(Number(d.id), d);
    }
    // A shop on the official API has no bound device: it shows the workspace's connected official number.
    let official: string | null | undefined;
    const officialLabel = async (): Promise<string | null> => {
      if (official !== undefined) return official;
      const cfg = await this.firstOfficialConnected(tx, orgId);
      official = cfg
        ? cfg.phone_number?.trim() || cfg.display_label || 'Official API (WABA)'
        : null;
      return official;
    };
    const out: Array<string | null> = [];
    for (const id of deviceIds) {
      const d = id === null ? undefined : byId.get(id);
      if (d) out.push(devicePhone(d) || d.device_name || `Device #${d.id}`);
      else out.push(await officialLabel());
    }
    return out;
  }

  async connection(tx: Tx, orgId: number, deviceId: number | null): Promise<StoreConnection> {
    const primary = await this.primaryConfig(tx, orgId);
    if (primary?.status === 'connected') {
      return {
        kind: 'official',
        label: PROVIDER_LABELS[primary.provider] ?? primary.provider.toUpperCase(),
        live: true,
      };
    }
    if (deviceId !== null) {
      const res = await tx.execute(sql`
        SELECT id, uuid, device_name, country_code, phone_number FROM devices
        WHERE org_id = ${orgId} AND id = ${deviceId} AND status = 'connected'`);
      const d = res.rows[0] as unknown as DeviceRow | undefined;
      if (d) {
        // WaDesk joins the stored country code and number with a space and does not add a plus.
        const label = `${d.country_code ?? ''} ${d.phone_number ?? ''}`.trim();
        return { kind: 'device', label, live: true };
      }
    }
    const any = await tx.execute(
      sql`SELECT 1 FROM devices WHERE org_id = ${orgId} AND status = 'connected' LIMIT 1`,
    );
    if (any.rows.length > 0) return { kind: 'other_device', label: null, live: true };
    return { kind: 'none', label: null, live: false };
  }

  async waNumber(tx: Tx, orgId: number, deviceId: number | null): Promise<string | null> {
    // The SHOP's own sending number, in WaDesk's order: its bound device, the first connected official number, then whatever
    // the primary config says.
    if (deviceId !== null) {
      const res = await tx.execute(sql`
        SELECT country_code, phone_number FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`);
      const d = res.rows[0] as
        { country_code: string | null; phone_number: string | null } | undefined;
      const digits = digitsOnly(`${d?.country_code ?? ''}${d?.phone_number ?? ''}`);
      if (digits) return digits;
    }
    const official = await this.firstOfficialConnected(tx, orgId);
    if (official && official.phone_number?.trim()) return digitsOnly(official.phone_number);
    const primary = await this.primaryConfig(tx, orgId);
    if (primary?.phone_number?.trim()) return digitsOnly(primary.phone_number);
    return null;
  }

  async recoverySender(tx: Tx, orgId: number): Promise<RecoverySender | null> {
    const engine = await this.engine(tx, orgId);
    if (engine === 'baileys') {
      const res = await tx.execute(sql`
        SELECT id, country_code, phone_number FROM devices
        WHERE org_id = ${orgId} AND status = 'connected'
        ORDER BY active DESC, id DESC LIMIT 1`);
      const d = res.rows[0] as
        | { id: number | string; country_code: string | null; phone_number: string | null }
        | undefined;
      if (!d) return null;
      return {
        engine,
        id: Number(d.id),
        fromDigits: digitsOnly(`${d.country_code ?? ''}${d.phone_number ?? ''}`),
      };
    }
    const res = await tx.execute(sql`
      SELECT id, phone_number FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = ${engine}
      ORDER BY is_primary DESC, connected_at DESC NULLS LAST, id DESC LIMIT 1`);
    const c = res.rows[0] as { id: number | string; phone_number: string | null } | undefined;
    if (!c) return null;
    return { engine, id: Number(c.id), fromDigits: digitsOnly(c.phone_number) };
  }

  /** WaDesk `WorkspaceEngine::for`: the primary config's provider, else the latest connected one, else the default. */
  private async engine(tx: Tx, orgId: number): Promise<string> {
    const list = sql.join(
      SEND_ENGINES.map((e) => sql`${e}`),
      sql`, `,
    );
    const primary = await tx.execute(sql`
      SELECT provider FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider IN (${list}) AND is_primary LIMIT 1`);
    const p = primary.rows[0] as { provider: string } | undefined;
    if (p) return p.provider;
    const connected = await tx.execute(sql`
      SELECT provider FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider IN (${list}) AND status = 'connected'
      ORDER BY connected_at DESC NULLS LAST, id DESC LIMIT 1`);
    const c = connected.rows[0] as { provider: string } | undefined;
    if (c) return c.provider;
    const settings = await tx.execute(
      sql`SELECT default_engine FROM workspace_settings WHERE org_id = ${orgId} LIMIT 1`,
    );
    const d = (settings.rows[0] as { default_engine: string | null } | undefined)?.default_engine;
    return d && SEND_ENGINES.includes(d) ? d : 'baileys';
  }

  /** `primaryForWorkspace()->first()`: the primary config, else the newest connected one, else the newest (never meta_ads). */
  private async primaryConfig(
    tx: Tx,
    orgId: number,
  ): Promise<(ConfigRow & { status: string }) | undefined> {
    const res = await tx.execute(sql`
      SELECT id, provider, status, phone_number, display_label FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider <> 'meta_ads'
      ORDER BY is_primary DESC, connected_at DESC NULLS LAST, id DESC LIMIT 1`);
    return res.rows[0] as unknown as (ConfigRow & { status: string }) | undefined;
  }

  private async firstOfficialConnected(tx: Tx, orgId: number): Promise<ConfigRow | undefined> {
    const res = await tx.execute(sql`
      SELECT id, provider, phone_number, display_label FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio') AND status = 'connected'
      ORDER BY id LIMIT 1`);
    return res.rows[0] as unknown as ConfigRow | undefined;
  }
}
