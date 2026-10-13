import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { MailWorkspaceSettings } from '@crm/contracts';
import type { Tx } from '@crm/db';

type PolicyValues = Pick<
  MailWorkspaceSettings,
  'personalMailboxesEnabled' | 'whoMayConnectPersonal' | 'adminsCanReadPersonal'
>;

/** `mail_workspace_settings`: one row per workspace, written by the first save. Reads live in `MailboxesRepository.workspaceSettings`. */
@Injectable()
export class MailSettingsRepository {
  /**
   * Creates the row (when `expectedVersion` is 0) or updates it under the version the caller read. Null when the version no longer
   * matches (someone else saved, or a first save raced).
   */
  async save(
    tx: Tx,
    orgId: number,
    userId: number | null,
    v: PolicyValues,
    expectedVersion: number,
  ): Promise<MailWorkspaceSettings | null> {
    const res =
      expectedVersion === 0
        ? await tx.execute(sql`
            INSERT INTO mail_workspace_settings
              (org_id, personal_mailboxes_enabled, who_may_connect_personal, admins_can_read_personal, updated_by)
            VALUES (${orgId}, ${v.personalMailboxesEnabled}, ${v.whoMayConnectPersonal}, ${v.adminsCanReadPersonal}, ${userId})
            ON CONFLICT (org_id) DO NOTHING
            RETURNING personal_mailboxes_enabled, who_may_connect_personal, admins_can_read_personal, row_version`)
        : await tx.execute(sql`
            UPDATE mail_workspace_settings
               SET personal_mailboxes_enabled = ${v.personalMailboxesEnabled},
                   who_may_connect_personal = ${v.whoMayConnectPersonal},
                   admins_can_read_personal = ${v.adminsCanReadPersonal},
                   updated_by = ${userId}
             WHERE org_id = ${orgId} AND row_version = ${expectedVersion}
            RETURNING personal_mailboxes_enabled, who_may_connect_personal, admins_can_read_personal, row_version`);
    const r = (res.rows as Array<Record<string, unknown>>)[0];
    if (!r) return null;
    return {
      personalMailboxesEnabled: r.personal_mailboxes_enabled === true,
      whoMayConnectPersonal:
        r.who_may_connect_personal as MailWorkspaceSettings['whoMayConnectPersonal'],
      adminsCanReadPersonal: r.admins_can_read_personal === true,
      rowVersion: Number(r.row_version),
    };
  }
}
