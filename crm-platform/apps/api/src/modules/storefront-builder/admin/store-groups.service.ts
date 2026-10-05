import { HttpStatus, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type ListStoreGroupsQuery,
  type SetStoreGroupCodeInput,
  type StoreGroup,
  type StoreGroupListResponse,
  type StoreGroupSummary,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { likePattern } from '../rules/coupon-admin';
import { ISO_MICROS } from './payment-sql';

export const GROUP_MODULE = 'wa_groups';

interface Raw {
  id: number | string;
  uuid: string;
  group_jid: string;
  subject: string | null;
  size: number | string;
  device_phone: string | null;
  group_code: string | null;
  synced_at: Date | string | null;
  synced_at_iso: string | null;
  row_version: number;
}

const COLUMNS = sql`g.id, g.uuid, g.group_jid, g.subject, g.size, g.device_phone, g.group_code, g.synced_at,
  to_char(g.synced_at AT TIME ZONE 'UTC', ${sql.raw(`'${ISO_MICROS}'`)}) AS synced_at_iso, g.row_version`;

const toGroup = (r: Raw): StoreGroup => ({
  id: r.uuid,
  jid: r.group_jid,
  subject: r.subject,
  size: Number(r.size),
  devicePhone: r.device_phone,
  groupCode: r.group_code,
  syncedAt: r.synced_at ? new Date(r.synced_at).toISOString() : null,
  rowVersion: r.row_version,
});

/** Position in the list: most recently synced first (never synced last), then subject, then id. */
interface GroupCursor {
  syncedAt: string | null;
  subject: string;
  id: number;
}
const encode = (c: GroupCursor): string =>
  Buffer.from(JSON.stringify([c.syncedAt, c.subject, c.id]), 'utf8').toString('base64url');
function decode(raw: string): GroupCursor {
  try {
    const [syncedAt, subject, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [
      string | null,
      string,
      number,
    ];
    if (
      (syncedAt !== null && typeof syncedAt !== 'string') ||
      typeof subject !== 'string' ||
      !Number.isSafeInteger(id)
    ) {
      throw new Error('malformed');
    }
    return { syncedAt, subject, id };
  } catch {
    throw AppError.validation('Invalid pagination cursor');
  }
}

/**
 * The WhatsApp group directory (WaDesk `WaGroupController` web side): list with a subject search, the cards (groups, coded groups,
 * the number the wa.me ordering link points at) and the ordering code of a group. The rows are mirrored from the WhatsApp session by
 * the bridge; the merchant only manages the code (set, change, clear), so there is no create and no delete here, as in WaDesk.
 */
@Injectable()
export class StoreGroupsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListStoreGroupsQuery): Promise<StoreGroupListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const where: SQL[] = [sql`g.org_id = ${ctx.orgId}`];
      // WaDesk searched the subject only.
      if (query.q) where.push(sql`g.subject ILIKE ${likePattern(query.q)}`);
      if (query.cursor) {
        const c = decode(query.cursor);
        const k1 = sql`coalesce(g.synced_at, '-infinity'::timestamptz)`;
        const c1 = sql`coalesce(${c.syncedAt}::timestamptz, '-infinity'::timestamptz)`;
        where.push(
          sql`(${k1} < ${c1} OR (${k1} = ${c1} AND (lower(coalesce(g.subject, '')) > ${c.subject}
              OR (lower(coalesce(g.subject, '')) = ${c.subject} AND g.id > ${c.id}))))`,
        );
      }
      const res = await tx.execute(sql`
        SELECT ${COLUMNS} FROM wa_groups g
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY coalesce(g.synced_at, '-infinity'::timestamptz) DESC, lower(coalesce(g.subject, '')), g.id
        LIMIT ${query.limit + 1}`);
      const rows = res.rows as unknown as Raw[];
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map(toGroup),
        page: {
          nextCursor:
            hasMore && last
              ? encode({
                  syncedAt: last.synced_at_iso,
                  subject: (last.subject ?? '').toLowerCase(),
                  id: Number(last.id),
                })
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  async summary(): Promise<StoreGroupSummary> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const counts = await tx.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE coalesce(group_code, '') <> '')::int AS coded
        FROM wa_groups WHERE org_id = ${ctx.orgId}`);
      const c = counts.rows[0] as { total: number; coded: number };
      // The first device of the workspace: the number buyers message to order from a group.
      const bot = await tx.execute(sql`
        SELECT regexp_replace(coalesce(country_code, '') || coalesce(phone_number, ''), '[^0-9]', '', 'g') AS digits
        FROM devices WHERE org_id = ${ctx.orgId}
        ORDER BY id`);
      const first = (bot.rows as Array<{ digits: string }>).find((r) => r.digits !== '');
      return { total: c.total, coded: c.coded, botNumber: first?.digits ?? null };
    });
  }

  async get(uuid: string): Promise<StoreGroup> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => toGroup(await this.orFail(tx, ctx.orgId, uuid)));
  }

  /** WaDesk `updateCode`: blank clears the code; a code another group holds is refused. */
  async setCode(uuid: string, input: SetStoreGroupCodeInput): Promise<StoreGroup> {
    const ctx = RequestContextStore.require();
    const code = (input.groupCode ?? '').trim();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, group_code, row_version FROM wa_groups WHERE org_id = ${ctx.orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
      const row = res.rows[0] as
        { id: number | string; group_code: string | null; row_version: number } | undefined;
      if (!row) throw AppError.notFound('Group', uuid);
      if (input.rowVersion !== undefined && input.rowVersion !== row.row_version) {
        throw AppError.rowVersionConflict('Group');
      }
      const id = Number(row.id);
      if (code !== '') {
        const dupe = await tx.execute(
          sql`SELECT 1 FROM wa_groups WHERE org_id = ${ctx.orgId} AND group_code = ${code} AND id <> ${id} LIMIT 1`,
        );
        if (dupe.rows.length > 0) {
          throw new AppError(
            ERROR_CODES.STORE_GROUP_CODE_TAKEN,
            'That code is already used by another group.',
            HttpStatus.CONFLICT,
            [{ path: 'groupCode', message: 'That code is already used by another group.' }],
          );
        }
      }
      const next = code !== '' ? code : null;
      await tx.execute(
        sql`UPDATE wa_groups SET group_code = ${next} WHERE org_id = ${ctx.orgId} AND id = ${id}`,
      );
      await this.audit.record(tx, {
        module: GROUP_MODULE,
        recordId: id,
        action: 'update',
        delta: { groupCode: { old: row.group_code, new: next } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: GROUP_MODULE,
        aggregateId: id,
        eventType: 'store.group_code_changed',
        payload: { groupId: uuid, cleared: next === null },
      });
      return toGroup(await this.orFail(tx, ctx.orgId, uuid));
    });
  }

  private async orFail(tx: Tx, orgId: number, uuid: string): Promise<Raw> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wa_groups g WHERE g.org_id = ${orgId} AND g.uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as Raw | undefined;
    if (!row) throw AppError.notFound('Group', uuid);
    return row;
  }
}
