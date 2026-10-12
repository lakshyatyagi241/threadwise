import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** Rows per insert when the members are rewritten (a group has at most 1024 cached members). */
const CHUNK = 500;
/** Reference cut the subject to the column it had. */
const SUBJECT_MAX = 191;

/**
 * Keeps the LEGACY group directory (`wa_groups`, `wa_group_members`) filled from the per-device directory, because the storefront's
 * group-code ordering (`/store/groups`, the ordering flow) still reads those two tables (docs/threadwise-port/plan/whatsapp-personal-groups-build.md).
 *
 * The least risky sync, as Reference's bridge did it: one `wa_groups` row per group id with the full WhatsApp id (`...@g.us`), the number's
 * digits, the subject, the size and `synced_at`; the member list of a group replaced as a whole (delete + insert) so removals stick. The
 * ordering `group_code` is never written here (a merchant sets it), and a group the number left keeps its row and its code (it only stops
 * being refreshed). The legacy tables are unique on the group id alone, so when two numbers of one workspace share a group the last sync
 * wins the `device_phone`; that is Reference's own limit, kept on purpose. Members known only by an anonymous id have no phone and are
 * skipped.
 */
@Injectable()
export class DeviceGroupsLegacyDirectory {
  async syncGroup(
    tx: Tx,
    orgId: number,
    devicePhone: string | null,
    g: {
      groupId: string;
      subject: string | null;
      size: number;
      members: Array<{ phone: string | null; admin: boolean }> | null;
    },
    now: Date,
  ): Promise<void> {
    const jid = `${g.groupId}@g.us`;
    await tx.execute(sql`
      INSERT INTO wa_groups (org_id, device_phone, group_jid, subject, size, synced_at)
      VALUES (${orgId}, ${devicePhone}, ${jid}, ${g.subject?.slice(0, SUBJECT_MAX) ?? null}, ${g.size}, ${now})
      ON CONFLICT (org_id, group_jid) DO UPDATE SET
        device_phone = EXCLUDED.device_phone, subject = EXCLUDED.subject, size = EXCLUDED.size, synced_at = EXCLUDED.synced_at`);
    if (g.members === null) return;

    const unique = new Map<string, boolean>();
    for (const m of g.members) {
      const phone = (m.phone ?? '').replace(/\D+/g, '').slice(0, 24);
      if (phone !== '') unique.set(phone, (unique.get(phone) ?? false) || m.admin);
    }
    await tx.execute(
      sql`DELETE FROM wa_group_members WHERE org_id = ${orgId} AND group_jid = ${jid}`,
    );
    const rows = [...unique.entries()];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      await tx.execute(sql`
        INSERT INTO wa_group_members (org_id, group_jid, phone, is_admin, synced_at)
        SELECT ${orgId}, ${jid}, u.phone, u.admin, ${now}
          FROM jsonb_to_recordset(${JSON.stringify(part.map(([phone, admin]) => ({ phone, admin })))}::jsonb) AS u(phone text, admin boolean)
        ON CONFLICT (org_id, group_jid, phone) DO UPDATE SET is_admin = EXCLUDED.is_admin, synced_at = EXCLUDED.synced_at`);
    }
  }
}
