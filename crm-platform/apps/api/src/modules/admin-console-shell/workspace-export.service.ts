import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  ERROR_CODES,
  EXPORT_COLUMNS,
  csvRow,
  type ExportCountsResponse,
  type ExportType,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { channelOwnerSql } from '../../realtime';
import { AuthAuditService } from '../auth';

const BATCH = 1_000;
/** Reference exports the first 500 characters of a message body and nothing else of its content. */
const BODY_CHARS = 500;

type Row = Record<string, string | number | null>;

/**
 * The Settings "Data & export" tab (TW-ASHELL-043). Three CSV files of the caller's workspace, owner only. The data is read in
 * keyset batches of 1,000, each in its own short transaction under the workspace's row-level security, so a big workspace
 * streams without holding a connection or its memory. A cell that could run as a spreadsheet formula is neutralised.
 */
@Injectable()
export class WorkspaceExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuthAuditService,
  ) {}

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  private async isOwner(orgId: number, userId: number): Promise<boolean> {
    const res = await this.db.txAs({ orgId, userId }, (tx) =>
      tx.execute(sql`
        SELECT COALESCE((o.settings ->> 'ownerUserId') = u.uuid::text, false) AS is_owner,
               (o.settings ->> 'ownerUserId') IS NOT NULL AS has_owner,
               EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
                        WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.system_key IN ('admin', 'workspace_admin')) AS is_admin
          FROM organizations o JOIN users u ON u.org_id = o.id AND u.id = ${userId}
         WHERE o.id = ${orgId}`),
    );
    const r = res.rows[0] as
      { is_owner: boolean; has_owner: boolean; is_admin: boolean } | undefined;
    return Boolean(r && (r.is_owner || (!r.has_owner && r.is_admin)));
  }

  /** The three counts on the cards. Visible to any member; only the owner can download. */
  async counts(): Promise<ExportCountsResponse> {
    const { orgId, userId } = this.actor();
    const [res, owner] = await Promise.all([
      this.db.txAs({ orgId, userId }, (tx) =>
        tx.execute(sql`
          SELECT (SELECT count(*) FROM contacts) AS contacts,
                 (SELECT count(*) FROM conversations) AS conversations,
                 (SELECT count(*) FROM messages WHERE deleted_at IS NULL) AS messages`),
      ),
      this.isOwner(orgId, userId),
    ]);
    const r = res.rows[0] as Record<'contacts' | 'conversations' | 'messages', string>;
    return {
      contacts: Number(r.contacts),
      conversations: Number(r.conversations),
      messages: Number(r.messages),
      isOwner: owner,
    };
  }

  /**
   * Checks the owner, writes the audit row, and returns the CSV as an async stream of chunks. The audit row is written
   * before the first byte (Reference wrote none).
   */
  async open(type: ExportType): Promise<AsyncGenerator<string>> {
    const { orgId, userId } = this.actor();
    if (!(await this.isOwner(orgId, userId))) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Only the workspace owner can export data.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.db.txAs({ orgId, userId }, (tx) =>
      this.audit.record(tx, {
        event: 'workspace.data_exported',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { type },
      }),
    );
    return this.generate(orgId, userId, type);
  }

  private async *generate(orgId: number, userId: number, type: ExportType): AsyncGenerator<string> {
    const columns = EXPORT_COLUMNS[type];
    yield csvRow(columns);
    let after = 0;
    for (;;) {
      const rows = await this.db.txAs({ orgId, userId }, (tx) => this.page(tx, type, after));
      if (rows.length === 0) return;
      for (const row of rows) yield csvRow(columns.map((c) => row[c] ?? null));
      after = Number(rows[rows.length - 1]!.cursor);
      if (rows.length < BATCH) return;
    }
  }

  private async page(
    tx: Tx,
    type: ExportType,
    after: number,
  ): Promise<Array<Row & { cursor: number }>> {
    const res =
      type === 'contacts'
        ? await tx.execute(sql`
            SELECT id AS cursor, uuid::text AS id, name, phone AS mobile, email::text AS email, status,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS created_at
              FROM contacts WHERE id > ${after} ORDER BY id LIMIT ${BATCH}`)
        : type === 'conversations'
          ? await tx.execute(sql`
            SELECT c.id AS cursor, c.uuid::text AS id, ch.kind AS channel, c.status,
                   to_char(c.last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS last_message_at,
                   to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS created_at
              FROM conversations c LEFT JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
             WHERE c.id > ${after} AND ${channelOwnerSql('c')} IS NULL ORDER BY c.id LIMIT ${BATCH}`)
          : await tx.execute(sql`
            SELECT m.id AS cursor, m.uuid::text AS id, c.uuid::text AS conversation_id, m.direction,
                   left(m.body, ${BODY_CHARS}) AS body,
                   to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS created_at
              FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
             WHERE m.id > ${after} AND m.deleted_at IS NULL AND ${channelOwnerSql('c')} IS NULL
             ORDER BY m.id LIMIT ${BATCH}`);
    return res.rows as unknown as Array<Row & { cursor: number }>;
  }
}
