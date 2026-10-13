import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { PERSONAL_OWNER_GONE } from './conversation-visibility';

/** The permission that marks a workspace admin for the personal-mailbox rule (Admin preset only, see 20261119090100). */
export const PERM_MAIL_SETTINGS_MANAGE = 'mail.settings.manage';

/**
 * Who owns the channel a conversation is on, as a SQL scalar, so every read that scopes conversations can apply the personal-mailbox rule
 * (TW-MAIL-035) with the same meaning as `ConversationRecord.channelOwnerUserId`:
 *
 *   NULL                   the channel is shared (every channel kind except a personal mailbox), no owner restriction
 *   <user id>              the channel is a personal mailbox of that user
 *   PERSONAL_OWNER_GONE    an email channel whose mailbox row is missing (its owner was deleted): nobody owns it, fail closed
 *
 * The link is the one the email module keeps: a mailbox's inbox channel has kind `email` and `external_id` = the mailbox uuid (no new
 * column; a channel is created or switched by the mailbox's own connect, so the join cannot drift). `alias` is the alias of
 * `conversations` in the caller's statement. Used in `visibleToSql`, the record loader, and the places that read conversations of
 * other people's inboxes (exports, assignment targets, notification fan-out).
 */
export function channelOwnerSql(alias = 'c'): SQL {
  const c = sql.raw(alias);
  return sql`(
    SELECT CASE WHEN mb.id IS NULL THEN ${PERSONAL_OWNER_GONE}::bigint
                WHEN mb.scope = 'personal' THEN mb.owner_user_id END
    FROM channels och
    LEFT JOIN mail_mailboxes mb ON mb.org_id = och.org_id AND mb.uuid::text = och.external_id
    WHERE och.org_id = ${c}.org_id AND och.id = ${c}.channel_id AND och.kind = 'email'
  )`;
}

/** The workspace's `admins_can_read_personal` (false when it never saved the policy). Read fresh: a policy change takes effect at once. */
export async function adminsCanReadPersonal(tx: Tx, orgId: number): Promise<boolean> {
  const res = await tx.execute(
    sql`SELECT admins_can_read_personal FROM mail_workspace_settings WHERE org_id = ${orgId}`,
  );
  const row = res.rows[0] as { admins_can_read_personal: boolean } | undefined;
  return row?.admins_can_read_personal === true;
}

/**
 * `channelOwnerSql` for a statement that starts from `channels` (alias `chAlias`): the same three answers (NULL shared, owner id,
 * PERSONAL_OWNER_GONE), for lists of channels rather than of conversations.
 */
export function channelRowOwnerSql(chAlias = 'ch'): SQL {
  const ch = sql.raw(chAlias);
  return sql`(CASE WHEN ${ch}.kind = 'email' THEN NULLIF(COALESCE(
    (SELECT CASE WHEN mb.scope = 'personal' THEN mb.owner_user_id ELSE 0 END
       FROM mail_mailboxes mb WHERE mb.org_id = ${ch}.org_id AND mb.uuid::text = ${ch}.external_id),
    ${PERSONAL_OWNER_GONE}::bigint), 0) END)`;
}

/** Whether a person may know a channel exists: a personal mailbox's channel is its owner's (and the admins the policy lets read). */
export function channelVisibleTo(
  viewer: { userId: number; readsPersonalMail?: boolean },
  channelOwnerUserId: number | null,
): boolean {
  return (
    channelOwnerUserId === null ||
    channelOwnerUserId === viewer.userId ||
    viewer.readsPersonalMail === true
  );
}
