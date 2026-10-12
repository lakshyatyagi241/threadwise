import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { MailSignatureScope } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface SignatureRow {
  id: number;
  uuid: string;
  scope: MailSignatureScope;
  mailboxId: number | null;
  mailboxUuid: string | null;
  /** The mailbox's own scope and owner, for the access rule. */
  mailboxScope: 'shared' | 'personal' | null;
  mailboxOwnerUserId: number | null;
  userId: number | null;
  userUuid: string | null;
  name: string;
  bodyHtml: string;
  bodyText: string;
  isDefault: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const toRow = (r: Raw): SignatureRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  scope: r.scope as MailSignatureScope,
  mailboxId: r.mailbox_id === null ? null : Number(r.mailbox_id),
  mailboxUuid: (r.mailbox_uuid as string | null) ?? null,
  mailboxScope: (r.mailbox_scope as 'shared' | 'personal' | null) ?? null,
  mailboxOwnerUserId:
    r.mailbox_owner === null || r.mailbox_owner === undefined ? null : Number(r.mailbox_owner),
  userId: r.user_id === null ? null : Number(r.user_id),
  userUuid: (r.user_uuid as string | null) ?? null,
  name: r.name as string,
  bodyHtml: r.body_html as string,
  bodyText: r.body_text as string,
  isDefault: r.is_default === true,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const rows = (res: { rows: unknown[] }) => res.rows as Raw[];

const SELECT = sql`
  SELECT s.*, m.uuid AS mailbox_uuid, m.scope AS mailbox_scope, m.owner_user_id AS mailbox_owner, u.uuid AS user_uuid
    FROM mail_signatures s
    LEFT JOIN mail_mailboxes m ON m.org_id = s.org_id AND m.id = s.mailbox_id
    LEFT JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id`;

/** `mail_signatures`: the shared signature of a mailbox and an agent's own. */
@Injectable()
export class MailSignaturesRepository {
  /** Every mailbox signature of the workspace and the caller's own user signatures (never anybody else's). */
  async listVisible(tx: Tx, orgId: number, userId: number): Promise<SignatureRow[]> {
    const res = await tx.execute(sql`${SELECT}
      WHERE s.org_id = ${orgId} AND (s.scope = 'mailbox' OR s.user_id = ${userId})
      ORDER BY s.scope DESC, s.name, s.id`);
    return rows(res).map(toRow);
  }

  async byUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<SignatureRow | undefined> {
    const res = await tx.execute(sql`${SELECT}
      WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE OF s` : sql``}`);
    const r = rows(res)[0];
    return r ? toRow(r) : undefined;
  }

  /** Makes room for a new default: every other default of the same owner is cleared. */
  async clearDefaults(
    tx: Tx,
    orgId: number,
    owner: { mailboxId: number } | { userId: number },
    exceptId: number | null,
  ): Promise<void> {
    const ownerSql =
      'mailboxId' in owner
        ? sql`scope = 'mailbox' AND mailbox_id = ${owner.mailboxId}`
        : sql`scope = 'user' AND user_id = ${owner.userId}`;
    await tx.execute(sql`
      UPDATE mail_signatures SET is_default = false
       WHERE org_id = ${orgId} AND ${ownerSql} AND is_default ${exceptId === null ? sql`` : sql`AND id <> ${exceptId}`}`);
  }

  async insert(
    tx: Tx,
    orgId: number,
    s: {
      scope: MailSignatureScope;
      mailboxId: number | null;
      userId: number | null;
      name: string;
      bodyHtml: string;
      bodyText: string;
      isDefault: boolean;
      createdBy: number;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO mail_signatures (org_id, scope, mailbox_id, user_id, name, body_html, body_text, is_default, created_by)
      VALUES (${orgId}, ${s.scope}, ${s.mailboxId}, ${s.userId}, ${s.name}, ${s.bodyHtml}, ${s.bodyText}, ${s.isDefault}, ${s.createdBy})
      RETURNING id`);
    return Number(rows(res)[0]!.id);
  }

  /** Under the optimistic lock; false when the version moved. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    patch: { name?: string; bodyHtml?: string; bodyText?: string; isDefault?: boolean },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE mail_signatures SET
        name = coalesce(${patch.name ?? null}, name),
        body_html = coalesce(${patch.bodyHtml ?? null}, body_html),
        body_text = coalesce(${patch.bodyText ?? null}, body_text),
        is_default = coalesce(${patch.isDefault ?? null}::boolean, is_default)
       WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
       RETURNING id`);
    return rows(res).length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM mail_signatures WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * The signature of a send, by the resolution order: the one named (it must be the mailbox's own or the sender's own), else the
   * sender's default user signature, else the mailbox's default. `named` null and `userId` null (a bot) skips to the mailbox default.
   */
  async forSend(
    tx: Tx,
    orgId: number,
    q: { named: string | null; userId: number | null; mailboxId: number },
  ): Promise<{ bodyHtml: string; bodyText: string } | null | 'missing'> {
    if (q.named) {
      const res = await tx.execute(sql`
        SELECT body_html, body_text FROM mail_signatures
         WHERE org_id = ${orgId} AND uuid = ${q.named}::uuid
           AND ((scope = 'mailbox' AND mailbox_id = ${q.mailboxId}) OR (scope = 'user' AND user_id = ${q.userId}))`);
      const r = rows(res)[0];
      return r ? { bodyHtml: r.body_html as string, bodyText: r.body_text as string } : 'missing';
    }
    const res = await tx.execute(sql`
      SELECT body_html, body_text FROM mail_signatures
       WHERE org_id = ${orgId} AND is_default
         AND ((scope = 'user' AND user_id = ${q.userId}) OR (scope = 'mailbox' AND mailbox_id = ${q.mailboxId}))
       ORDER BY (scope = 'user') DESC LIMIT 1`);
    const r = rows(res)[0];
    return r ? { bodyHtml: r.body_html as string, bodyText: r.body_text as string } : null;
  }

  /** What `{{name}}`, `{{title}}` and `{{phone}}` stand for: the sending user. */
  async senderFacts(
    tx: Tx,
    orgId: number,
    userId: number,
  ): Promise<{ name: string; title: string; phone: string }> {
    const res = await tx.execute(sql`
      SELECT coalesce(nullif(btrim(p.display_name), ''), u.full_name) AS name,
             coalesce(u.settings ->> 'jobTitle', '') AS title,
             coalesce(p.phone_e164, '') AS phone
        FROM users u LEFT JOIN user_profiles p ON p.org_id = u.org_id AND p.user_id = u.id
       WHERE u.org_id = ${orgId} AND u.id = ${userId}`);
    const r = rows(res)[0];
    return {
      name: (r?.name as string | undefined) ?? '',
      title: (r?.title as string | undefined) ?? '',
      phone: (r?.phone as string | undefined) ?? '',
    };
  }
}
