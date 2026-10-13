import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AUDIT_LOG_MODULE,
  AUDIT_LOG_PERMISSIONS,
  ERROR_CODES,
  type AuditLogDetail,
  type AuditLogEntry,
  type AuditLogFacets,
  type AuditLogFacetsQuery,
  type AuditLogListResponse,
  type AuditLogQuery,
  type AuditLogSettings,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { renderDelta } from './audit-pii';
import {
  actorKindOf,
  decodePosition,
  encodePosition,
  resolveWindow,
  type RowPosition,
} from './audit-log.rules';
import { AuditLogRepository, LINKABLE, type AuditRow } from './audit-log.repository';

/** The one permission that may see personal values unmasked: the Owner-only settings key. No preset but Owner holds it. */
export const REVEAL_PERMISSION = 'org.owner_settings.manage';

/** What a support (act-as) session says about itself, by session uuid. */
type Sessions = Map<string, { reason: string; readOnly: boolean; startedAt: Date }>;

/**
 * The tenant-facing audit log, read side (spec docs/specs/audit-log-tenant.md). Every read is bounded by a time window (the partitions
 * outside it are never touched) and by the caller's workspace (RLS underneath, `org_id` in every statement). Field values are only
 * ever returned through the PII-safe renderer (`audit-pii.ts`); the list carries field NAMES only.
 *
 * Reading the log is audited: opening one entry writes an `audit-log` / `read` row (who looked at which entry, and whether they could
 * see personal values unmasked); every export request writes an `audit-log-exports` / `export` row. Listing and filtering do not.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AuditLogRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  /** Whether this request may see personal values: the Owner key, and never through a platform support (act-as) session. */
  canReveal(): boolean {
    const ctx = RequestContextStore.require();
    if (ctx.impersonation || !ctx.grants) return false;
    return this.rbac.can(ctx.grants, REVEAL_PERMISSION).allowed;
  }

  canExport(): boolean {
    const ctx = RequestContextStore.require();
    return !!ctx.grants && this.rbac.can(ctx.grants, AUDIT_LOG_PERMISSIONS.export).allowed;
  }

  async settings(): Promise<AuditLogSettings> {
    let retentionDays: number | null = null;
    try {
      retentionDays = await this.db.privileged((tx) => this.repo.retentionDays(tx));
    } catch {
      retentionDays = null;
    }
    return { retentionDays, canExport: this.canExport(), canReveal: this.canReveal() };
  }

  async list(query: AuditLogQuery): Promise<AuditLogListResponse> {
    const ctx = RequestContextStore.require();
    const window = resolveWindow(query);
    const after = query.cursor ? this.position(query.cursor) : null;
    const empty: AuditLogListResponse = {
      data: [],
      page: { nextCursor: null, hasMore: false, limit: query.limit },
      range: { from: window.from.toISOString(), to: window.to.toISOString() },
    };

    const { rows, links } = await this.db.tx(async (tx) => {
      let actorDbId: number | undefined;
      if (query.actorId) {
        const found = await this.repo.userId(tx, ctx.orgId, query.actorId);
        if (found === null) return { rows: [], links: new Map<string, string>() };
        actorDbId = found;
      }
      const page = await this.repo.page(
        tx,
        query,
        { orgId: ctx.orgId, window, actorDbId, after },
        query.limit + 1,
      );
      return { rows: page, links: await this.links(tx, ctx.orgId, page.slice(0, query.limit)) };
    });
    if (rows.length === 0) return empty;

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const sessions = await this.sessions(ctx.orgId, items);
    const last = items[items.length - 1]!;
    return {
      data: items.map((r) => this.toEntry(r, links, sessions)),
      page: {
        nextCursor: hasMore ? encodePosition({ atText: last.atText, id: last.id }) : null,
        hasMore,
        limit: query.limit,
      },
      range: empty.range,
    };
  }

  /** One entry with its field changes through the renderer. Writes the `read` audit row (the same transaction). */
  async detail(entryId: string): Promise<AuditLogDetail> {
    const ctx = RequestContextStore.require();
    const pos = this.position(entryId);
    const reveal = this.canReveal();

    const { row, links } = await this.db.tx(async (tx) => {
      const found = await this.repo.byPosition(tx, ctx.orgId, pos);
      if (!found) throw this.notFound();
      // Who looked at which entry, and whether they could see personal values unmasked.
      await this.audit.record(tx, {
        module: AUDIT_LOG_MODULE,
        recordId: found.id,
        action: 'read',
        delta: {
          entry: { old: null, new: { module: found.module, action: found.action } },
          revealed: { old: false, new: reveal },
        },
      });
      return { row: found, links: await this.links(tx, ctx.orgId, [found]) };
    });
    const sessions = await this.sessions(ctx.orgId, [row]);
    const entry = this.toEntry(row, links, sessions);
    return { ...entry, delta: renderDelta(row.delta, { module: row.module, reveal }), canReveal: reveal };
  }

  async facets(query: AuditLogFacetsQuery): Promise<AuditLogFacets> {
    const ctx = RequestContextStore.require();
    const window = resolveWindow(query);
    return this.db.tx((tx) => this.repo.facets(tx, ctx.orgId, window));
  }

  // --- pieces ------------------------------------------------------------------------------------------------------------------

  private position(raw: string): RowPosition {
    const pos = decodePosition(raw);
    if (!pos) throw this.notFound();
    return pos;
  }

  private notFound(): AppError {
    return new AppError(
      ERROR_CODES.AUDIT_ENTRY_NOT_FOUND,
      'Audit entry not found',
      HttpStatus.NOT_FOUND,
    );
  }

  /** `module:recordId` -> app path, for the record types that have a screen and rows that still exist. */
  private async links(tx: Tx, orgId: number, rows: AuditRow[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const byModule = new Map<string, Set<number>>();
    for (const r of rows) {
      if (!LINKABLE[r.module]) continue;
      const id = Number(r.recordId);
      if (!Number.isSafeInteger(id)) continue;
      (byModule.get(r.module) ?? byModule.set(r.module, new Set()).get(r.module)!).add(id);
    }
    for (const [module, ids] of byModule) {
      const spec = LINKABLE[module]!;
      const uuids = await this.repo.recordUuids(tx, orgId, spec.table, [...ids]);
      for (const [id, uuid] of uuids) out.set(`${module}:${id}`, spec.path(uuid));
    }
    return out;
  }

  /** The support sessions behind the act-as rows of a page: the reason the operator gave. Platform-only table, read privileged. */
  private async sessions(orgId: number, rows: AuditRow[]): Promise<Sessions> {
    const ids = [...new Set(rows.map((r) => r.sessionUuid).filter((v): v is string => !!v))];
    if (ids.length === 0) return new Map();
    try {
      return await this.db.privileged((tx) => this.repo.impersonationSessions(tx, orgId, ids));
    } catch {
      return new Map();
    }
  }

  toEntry(row: AuditRow, links: Map<string, string>, sessions: Sessions): AuditLogEntry {
    const kind = actorKindOf(row.actorType);
    const session = row.sessionUuid ? sessions.get(row.sessionUuid) : undefined;
    return {
      id: encodePosition({ atText: row.atText, id: row.id }),
      at: row.at.toISOString(),
      actor: {
        kind,
        id: kind === 'user' ? row.userUuid : null,
        name: kind === 'user' ? row.userName : kind === 'api_key' ? row.keyName : null,
      },
      module: row.module,
      action: row.action,
      recordId: row.recordId,
      record: { href: links.get(`${row.module}:${row.recordId}`) ?? null },
      requestId: row.requestId,
      actAs: row.sessionUuid
        ? {
            reason: session?.reason ?? null,
            readOnly: session?.readOnly ?? null,
            startedAt: session?.startedAt.toISOString() ?? null,
          }
        : null,
      changedFields: row.changedFields,
    };
  }

}
