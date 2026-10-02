import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { DatabaseService } from '../../db/database.service';

/**
 * The saved WhatsApp session of a device, as encrypted rows in `device_auth_state` (TW-NODE-011, 007). Reference kept the same
 * data as files under `baileys_auth/session_<phone>/`; a row per file lets any worker adopt a device. Values are the JSON the
 * Baileys adapter produces, encrypted before they reach the database. Runs as the device's organization, so row-level
 * security applies even here.
 */
@Injectable()
export class DeviceAuthStore {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
  ) {}

  private tenant(orgId: number) {
    return { orgId, userId: null };
  }

  async read(orgId: number, deviceId: number, name: string): Promise<string | null> {
    return this.db.txAs(this.tenant(orgId), async (tx) => {
      const res = await tx.execute(
        sql`SELECT value FROM device_auth_state WHERE org_id = ${orgId} AND device_id = ${deviceId} AND name = ${name}`,
      );
      const row = res.rows[0] as { value: string } | undefined;
      return row ? this.crypto.decrypt(row.value) : null;
    });
  }

  /** Several names at once, for a batch of signal keys. Missing ones are left out. */
  async readMany(orgId: number, deviceId: number, names: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (names.length === 0) return out;
    await this.db.txAs(this.tenant(orgId), async (tx) => {
      const res = await tx.execute(
        sql`SELECT name, value FROM device_auth_state
             WHERE org_id = ${orgId} AND device_id = ${deviceId}
               AND name IN (${sql.join(
                 names.map((n) => sql`${n}`),
                 sql`, `,
               )})`,
      );
      for (const r of res.rows as Array<{ name: string; value: string }>) {
        out.set(r.name, this.crypto.decrypt(r.value));
      }
    });
    return out;
  }

  /** Writes and deletes in one transaction: `null` removes the name. */
  async write(
    orgId: number,
    deviceId: number,
    entries: Array<[string, string | null]>,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.db.txAs(this.tenant(orgId), async (tx) => {
      for (const [name, value] of entries) {
        if (value === null) {
          await tx.execute(
            sql`DELETE FROM device_auth_state WHERE org_id = ${orgId} AND device_id = ${deviceId} AND name = ${name}`,
          );
        } else {
          await tx.execute(sql`
            INSERT INTO device_auth_state (org_id, device_id, name, value)
            VALUES (${orgId}, ${deviceId}, ${name}, ${this.crypto.encrypt(value)})
            ON CONFLICT (org_id, device_id, name) DO UPDATE SET value = EXCLUDED.value`);
        }
      }
    });
  }

  /** Forgets the whole session: the next connect starts from a QR. */
  async deleteAll(orgId: number, deviceId: number): Promise<void> {
    await this.db.txAs(this.tenant(orgId), (tx) =>
      tx.execute(
        sql`DELETE FROM device_auth_state WHERE org_id = ${orgId} AND device_id = ${deviceId}`,
      ),
    );
  }

  async count(orgId: number, deviceId: number): Promise<number> {
    return this.db.txAs(this.tenant(orgId), async (tx) => {
      const res = await tx.execute(
        sql`SELECT count(*)::int AS n FROM device_auth_state WHERE org_id = ${orgId} AND device_id = ${deviceId}`,
      );
      return Number((res.rows[0] as { n: number }).n);
    });
  }
}
