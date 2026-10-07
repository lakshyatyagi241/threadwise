import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  SetUnofficialWorkspaceInput,
  UnofficialWorkspace,
  UnofficialWorkspaceListQuery,
  UnofficialWorkspaceListResponse,
  UnofficialWorkspaceOptionListResponse,
  UnofficialWorkspaceOptionsQuery,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, UnofficialWhatsappSwitch } from '../auth';

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ILIKE pattern for a substring match with the wildcard characters of the typed text escaped. */
function containing(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The columns of one allow-list entry, joined to its workspace, operator and device counts. */
const ENTRY = sql`
  SELECT o.id AS org_id, o.uuid AS org_uuid, o.name, o.slug, o.plan AS plan_slug,
         w.enabled_at, to_char(w.enabled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS enabled_iso,
         w.note, op.uuid AS operator_uuid, op.full_name AS operator_name, w.enabled_by_operator_id,
         (SELECT count(*)::int FROM devices d WHERE d.org_id = o.id) AS device_count,
         (SELECT count(*)::int FROM devices d WHERE d.org_id = o.id AND d.status = 'connected') AS active_device_count
  FROM unofficial_whatsapp_workspaces w
  JOIN organizations o ON o.id = w.org_id
  LEFT JOIN platform_operators op ON op.id = w.enabled_by_operator_id`;

function entryOf(r: Raw): UnofficialWorkspace {
  const operatorUuid = strOrNull(r.operator_uuid);
  const operatorName = strOrNull(r.operator_name);
  return {
    orgUuid: str(r.org_uuid),
    name: str(r.name),
    slug: str(r.slug),
    planSlug: strOrNull(r.plan_slug),
    enabledAt: new Date(str(r.enabled_at)).toISOString(),
    enabledBy:
      operatorUuid || operatorName
        ? {
            ...(operatorUuid ? { operatorUuid } : {}),
            ...(operatorName ? { name: operatorName } : {}),
          }
        : null,
    note: str(r.note),
    deviceCount: Number(r.device_count ?? 0),
    activeDeviceCount: Number(r.active_device_count ?? 0),
  };
}

/**
 * The allow-list of workspaces that may use the unofficial WhatsApp engine (owner decision 2026-10-06), for the platform super
 * admin console. The platform switch stays the global kill-switch; a workspace has access only when the switch is on AND it is
 * listed here. Every read and write goes through the privileged transaction (an operator is not a tenant), and every write is
 * audited with the operator id. Nothing a workspace owns is touched: devices, sessions, queued rows all stay.
 */
@Injectable()
export class UnofficialWorkspacesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuthAuditService,
    private readonly unofficial: UnofficialWhatsappSwitch,
  ) {}

  /** The allowed workspaces, newest first, with an optional name or slug filter. */
  async list(query: UnofficialWorkspaceListQuery): Promise<UnofficialWorkspaceListResponse> {
    const where: SQL[] = [];
    if (query.q) {
      const like = containing(query.q);
      where.push(sql`(o.name ILIKE ${like} OR o.slug ILIKE ${like})`);
    }
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      where.push(
        sql`(w.enabled_at, w.org_id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id}::bigint)`,
      );
    }
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        ${ENTRY}
        ${where.length > 0 ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
        ORDER BY w.enabled_at DESC, w.org_id DESC
        LIMIT ${query.limit + 1}`);
      return res.rows as Raw[];
    });
    const { items, page } = buildPage(
      rows.map((r) => ({
        createdAt: new Date(str(r.enabled_at)),
        createdAtIso: str(r.enabled_iso),
        id: Number(r.org_id),
        row: r,
      })),
      query.limit,
    );
    return { data: items.map((i) => entryOf(i.row)), page };
  }

  /** The "add workspace" picker: workspaces by name, slug or owner email, at most 20. */
  async options(
    query: UnofficialWorkspaceOptionsQuery,
  ): Promise<UnofficialWorkspaceOptionListResponse> {
    const like = query.q ? containing(query.q) : null;
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.uuid AS org_uuid, o.name, o.slug, o.plan AS plan_slug, ow.email::text AS owner_email,
               EXISTS (SELECT 1 FROM unofficial_whatsapp_workspaces w WHERE w.org_id = o.id) AS already_enabled
        FROM organizations o
        LEFT JOIN users ow ON ow.org_id = o.id AND ow.uuid::text = o.settings ->> 'ownerUserId'
        ${like ? sql`WHERE (o.name ILIKE ${like} OR o.slug ILIKE ${like} OR ow.email::text ILIKE ${like})` : sql``}
        ORDER BY o.name, o.id
        LIMIT ${Math.min(query.limit, 20)}`);
      return res.rows as Raw[];
    });
    return {
      data: rows.map((r) => ({
        orgUuid: str(r.org_uuid),
        name: str(r.name),
        slug: str(r.slug),
        planSlug: strOrNull(r.plan_slug),
        ownerEmail: strOrNull(r.owner_email),
        alreadyEnabled: r.already_enabled === true,
      })),
    };
  }

  /**
   * Allows (`enabled: true`, an upsert: a repeat keeps the first `enabledAt` and operator and updates the note when one is sent) or
   * removes (`enabled: false`) a workspace. Idempotent. Answers the entry; for a removal, the entry as it was just before it was
   * removed. 404 for an unknown workspace.
   */
  async set(
    orgUuid: string,
    input: SetUnofficialWorkspaceInput,
    operatorId: number,
  ): Promise<UnofficialWorkspace> {
    if (!UUID.test(orgUuid)) throw AppError.notFound('Workspace', orgUuid);
    const result = await this.db.privileged(async (tx) => {
      const found = await tx.execute(
        sql`SELECT id, name, slug, plan FROM organizations WHERE uuid = ${orgUuid}::uuid`,
      );
      const org = found.rows[0] as
        { id: number | string; name: string; slug: string; plan: string | null } | undefined;
      if (!org) throw AppError.notFound('Workspace', orgUuid);
      const orgId = Number(org.id);
      let entry: UnofficialWorkspace;
      if (input.enabled) {
        await tx.execute(sql`
          INSERT INTO unofficial_whatsapp_workspaces (org_id, enabled_by_operator_id, note)
          VALUES (${orgId}, ${operatorId}, ${input.note ?? ''})
          ON CONFLICT (org_id) DO UPDATE
            SET note = CASE WHEN ${input.note !== undefined}::boolean THEN EXCLUDED.note ELSE unofficial_whatsapp_workspaces.note END`);
        entry = await this.entry(tx, orgId);
      } else {
        // The entry as it was, so the console can say what was removed; absent means it was already off.
        const before = await this.entryOrNull(tx, orgId);
        await tx.execute(sql`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = ${orgId}`);
        entry = before ?? {
          orgUuid,
          name: org.name,
          slug: org.slug,
          planSlug: org.plan,
          enabledAt: new Date().toISOString(),
          enabledBy: null,
          note: '',
          deviceCount: 0,
          activeDeviceCount: 0,
        };
      }
      await this.audit.record(tx, {
        event: input.enabled
          ? 'platform.whatsapp_unofficial.workspace_enabled'
          : 'platform.whatsapp_unofficial.workspace_disabled',
        status: 'info',
        orgId,
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { orgUuid, name: org.name, slug: org.slug, note: entry.note, operatorId },
      });
      return entry;
    });
    // This instance reads the change at once; the others within the 5 s window.
    this.unofficial.invalidateAllowList();
    return result;
  }

  private async entryOrNull(tx: Tx, orgId: number): Promise<UnofficialWorkspace | null> {
    const res = await tx.execute(sql`${ENTRY} WHERE w.org_id = ${orgId}`);
    const row = res.rows[0] as Raw | undefined;
    return row ? entryOf(row) : null;
  }

  private async entry(tx: Tx, orgId: number): Promise<UnofficialWorkspace> {
    const e = await this.entryOrNull(tx, orgId);
    if (!e) throw AppError.notFound('Workspace');
    return e;
  }
}
