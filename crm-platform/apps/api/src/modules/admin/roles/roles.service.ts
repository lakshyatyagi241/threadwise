import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateRoleInput,
  type PaginationQuery,
  type RoleResponse,
  type UpdateRoleInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { WorkspaceRoleRulesService } from '../../roles-permissions';
import { toRoleResponse, type RoleViewContext } from './roles.mapper';
import { RolesRepository, type RoleRow } from './roles.repository';

const MODULE_KEY = 'roles';

/** Owner, Admin, Manager, Agent and Viewer are the ladder every grant rule compares against: they stay, under their names. */
const presetError = (name: string, what: string) =>
  new AppError(
    ERROR_CODES.RBAC_PRESET_ROLE,
    `The ${name} role is a preset and ${what}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'id', message: `The ${name} role is a preset and ${what}.` }],
  );

/** Roles & Permissions — Settings > Users & Permissions. */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RolesRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly roleRules: WorkspaceRoleRulesService,
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

      const views = await this.views(tx, ctx.orgId, ctx.userId!, items);
      return {
        data: items.map((row) =>
          toRoleResponse(row, grantsByRole.get(row.id) ?? [], views.get(row.id)!),
        ),
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
      return toRoleResponse(
        row,
        grantRows,
        (await this.views(tx, ctx.orgId, ctx.userId!, [row])).get(row.id)!,
      );
    });
  }

  async create(input: CreateRoleInput): Promise<RoleResponse> {
    return this.roleRules.withDenialAudit('role.create', () => this.createInTx(input));
  }

  private async createInTx(input: CreateRoleInput): Promise<RoleResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByName(tx, ctx.orgId, input.name);
      if (existing) {
        throw AppError.validation('A role with this name already exists', [
          { path: 'name', message: 'already in use' },
        ]);
      }

      // A new role cannot carry anything its creator does not hold (TW-RBAC-026: no handing out more than you have).
      await this.roleRules.assertCanEditGrants(
        tx,
        ctx.orgId,
        ctx.userId!,
        { id: 0, name: input.name, systemKey: null },
        [],
        input.grants,
      );
      const created = await this.repo.insert(tx, ctx.orgId, input.name);
      if (input.grants.length > 0) {
        await this.repo.replaceGrants(tx, ctx.orgId, created.id, input.grants);
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      this.logger.log({ orgId: ctx.orgId, roleId: created.id }, 'role created');

      const row = await this.repo.findByUuid(tx, ctx.orgId, created.uuid);
      const grantRows = await this.repo.grantsForRoles(tx, ctx.orgId, [created.id]);
      return toRoleResponse(
        row!,
        grantRows,
        (await this.views(tx, ctx.orgId, ctx.userId!, [row!])).get(row!.id)!,
      );
    });
  }

  async update(uuid: string, input: UpdateRoleInput): Promise<RoleResponse> {
    return this.roleRules.withDenialAudit('role.update', () => this.updateInTx(uuid, input));
  }

  private async updateInTx(uuid: string, input: UpdateRoleInput): Promise<RoleResponse> {
    const ctx = RequestContextStore.require();

    const result = await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Role', uuid);
      if (existing.isLocked) {
        throw AppError.validation('System roles cannot be modified', [
          { path: 'id', message: 'role is locked' },
        ]);
      }

      if (existing.systemKey && input.name !== undefined && input.name !== existing.name) {
        throw presetError(existing.name, 'cannot be renamed');
      }
      if (input.grants !== undefined) {
        const current = await this.repo.grantsForRoles(tx, ctx.orgId, [existing.id]);
        await this.roleRules.assertCanEditGrants(
          tx,
          ctx.orgId,
          ctx.userId!,
          { id: existing.id, name: existing.name, systemKey: existing.systemKey },
          current,
          input.grants,
        );
      }

      const values: Record<string, unknown> = {};
      if (input.name !== undefined) values.name = input.name;
      // A grants-only edit still takes the optimistic lock (and bumps the version): rewrite the name unchanged.
      if (input.grants !== undefined && values.name === undefined) values.name = existing.name;

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
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'update' });

      const after = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      const grantRows = await this.repo.grantsForRoles(tx, ctx.orgId, [existing.id]);
      return toRoleResponse(
        after!,
        grantRows,
        (await this.views(tx, ctx.orgId, ctx.userId!, [after!])).get(after!.id)!,
      );
    });
    // Every user holding this role has a stale cached grant set now. Bump only once the change is committed, so a request
    // racing the edit cannot cache the old grants under the new version.
    if (input.grants !== undefined) await this.rbac.bumpRolesVersion(ctx.orgId);
    return result;
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();

    await this.roleRules.withDenialAudit('role.delete', () => this.removeInTx(uuid, ctx.orgId));
    await this.rbac.bumpRolesVersion(ctx.orgId);
  }

  private async removeInTx(uuid: string, orgId: number): Promise<void> {
    const ctx = { orgId };
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Role', uuid);
      if (existing.isLocked) {
        throw AppError.validation('System roles cannot be deleted', [
          { path: 'id', message: 'role is locked' },
        ]);
      }

      if (existing.systemKey) throw presetError(existing.name, 'cannot be deleted');
      const holders =
        (await this.repo.userCounts(tx, ctx.orgId, [existing.id])).get(existing.id) ?? 0;
      if (holders > 0) {
        throw new AppError(
          ERROR_CODES.RBAC_ROLE_IN_USE,
          `${holders} member(s) still hold the ${existing.name} role. Move them to another role first.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'id', message: `${holders} member(s) still hold this role.` }],
        );
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  /** What the caller may do with each role: how many members it has, whether they can hand it out, whether they can edit it. */
  private async views(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    rows: RoleRow[],
  ): Promise<Map<number, RoleViewContext>> {
    const counts = await this.repo.userCounts(
      tx,
      orgId,
      rows.map((r) => r.id),
    );
    const grantable = new Set(await this.roleRules.grantableRoleIds(tx, orgId, actorUserId));
    const out = new Map<number, RoleViewContext>();
    for (const r of rows) {
      out.set(r.id, {
        userCount: counts.get(r.id) ?? 0,
        grantable: grantable.has(r.id),
        editable: await this.roleRules.canEditRole(tx, orgId, actorUserId, r),
      });
    }
    return out;
  }
}
