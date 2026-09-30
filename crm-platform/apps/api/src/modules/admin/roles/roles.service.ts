import { Injectable, Logger } from '@nestjs/common';
import type {
  CreateRoleInput,
  PaginationQuery,
  RoleResponse,
  UpdateRoleInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { toRoleResponse } from './roles.mapper';
import { RolesRepository } from './roles.repository';

const MODULE_KEY = 'roles';

/** Roles & Permissions — Settings > Users & Permissions. */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RolesRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async list(query: PaginationQuery) {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
      });

      const { items, page } = buildPage(rows, query.limit);
      const grantRows = await this.repo.grantsForRoles(
        tx,
        ctx.orgId,
        items.map((r) => r.id),
      );
      const grantsByRole = new Map<number, typeof grantRows>();
      for (const g of grantRows) {
        grantsByRole.set(g.roleId, [...(grantsByRole.get(g.roleId) ?? []), g]);
      }

      return {
        data: items.map((row) => toRoleResponse(row, grantsByRole.get(row.id) ?? [])),
        page,
      };
    });
  }

  async getByUuid(uuid: string): Promise<RoleResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Role', uuid);
      const grantRows = await this.repo.grantsForRoles(tx, ctx.orgId, [row.id]);
      return toRoleResponse(row, grantRows);
    });
  }

  async create(input: CreateRoleInput): Promise<RoleResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByName(tx, ctx.orgId, input.name);
      if (existing) {
        throw AppError.validation('A role with this name already exists', [
          { path: 'name', message: 'already in use' },
        ]);
      }

      const created = await this.repo.insert(tx, ctx.orgId, input.name);
      if (input.grants.length > 0) {
        await this.repo.replaceGrants(tx, ctx.orgId, created.id, input.grants);
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      this.logger.log({ orgId: ctx.orgId, roleId: created.id }, 'role created');

      const row = await this.repo.findByUuid(tx, ctx.orgId, created.uuid);
      const grantRows = await this.repo.grantsForRoles(tx, ctx.orgId, [created.id]);
      return toRoleResponse(row!, grantRows);
    });
  }

  async update(uuid: string, input: UpdateRoleInput): Promise<RoleResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Role', uuid);
      if (existing.isLocked) {
        throw AppError.validation('System roles cannot be modified', [
          { path: 'id', message: 'role is locked' },
        ]);
      }

      const values: Record<string, unknown> = {};
      if (input.name !== undefined) values.name = input.name;

      if (Object.keys(values).length > 0) {
        const updated = await this.repo.updateWithVersion(
          tx,
          ctx.orgId,
          existing.id,
          input.rowVersion,
          values,
        );
        if (!updated) throw AppError.rowVersionConflict('Role');
      }

      if (input.grants !== undefined) {
        await this.repo.replaceGrants(tx, ctx.orgId, existing.id, input.grants);
        // Every user holding this role has a stale cached grant set now.
        await this.rbac.bumpRolesVersion(ctx.orgId);
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'update' });

      const after = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      const grantRows = await this.repo.grantsForRoles(tx, ctx.orgId, [existing.id]);
      return toRoleResponse(after!, grantRows);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();

    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Role', uuid);
      if (existing.isLocked) {
        throw AppError.validation('System roles cannot be deleted', [
          { path: 'id', message: 'role is locked' },
        ]);
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
      await this.rbac.bumpRolesVersion(ctx.orgId);
    });
  }
}
