import { Injectable, Logger } from '@nestjs/common';
import type {
  CreateUserInput,
  ListUsersQuery,
  PageResponse,
  UpdateUserInput,
  UserResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { PasswordService } from '../../auth';
import { WorkspaceRoleRulesService } from '../../roles-permissions';
import { toUserResponse } from './users.mapper';
import { UsersRepository } from './users.repository';

const MODULE_KEY = 'users';

/** Staff user management — Settings > Users & Permissions > Users. */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: UsersRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly passwords: PasswordService,
    private readonly roleRules: WorkspaceRoleRulesService,
  ) {}

  async list(query: ListUsersQuery): Promise<PageResponse<UserResponse>> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
        q: query.q,
        status: query.status,
      });

      const { items, page } = buildPage(rows, query.limit);
      const roleRows = await this.repo.rolesForUsers(
        tx,
        ctx.orgId,
        items.map((u) => u.id),
      );
      const rolesByUser = new Map<number, typeof roleRows>();
      for (const r of roleRows) {
        rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r]);
      }

      return {
        data: items.map((row) => toUserResponse(row, rolesByUser.get(row.id) ?? [])),
        page,
      };
    });
  }

  async getByUuid(uuid: string): Promise<UserResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('User', uuid);
      const roleRows = await this.repo.rolesForUsers(tx, ctx.orgId, [row.id]);
      return toUserResponse(row, roleRows);
    });
  }

  /** The caller's own profile. No permission check beyond being authenticated. */
  async getSelf(): Promise<UserResponse> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findById(tx, ctx.orgId, ctx.userId!);
      if (!row) throw AppError.notFound('User');
      const roleRows = await this.repo.rolesForUsers(tx, ctx.orgId, [row.id]);
      return toUserResponse(row, roleRows);
    });
  }

  async create(input: CreateUserInput): Promise<UserResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByEmail(tx, ctx.orgId, input.email);
      if (existing) {
        throw AppError.validation('A user with this email already exists', [
          { path: 'email', message: 'already in use' },
        ]);
      }

      // Same rules as sign-up, reset and change (TW-AUTH-035): an admin-set
      // password is not exempt from the policy.
      await this.passwords.assertAcceptable(input.password, {
        email: input.email,
        fullName: input.fullName,
      });
      const passwordHash = await this.passwords.hash(input.password);
      const created = await this.repo.insert(tx, ctx.orgId, {
        email: input.email,
        fullName: input.fullName,
        passwordHash,
      });

      const roleIds = await this.repo.resolveRoleIds(tx, ctx.orgId, input.roleIds);
      if (roleIds.length > 0) {
        // Creating a member needs org.member.invite (TW-RBAC-027) and each role handed out must be one the actor may grant (TW-RBAC-026).
        const actorGrants = await this.rbac.grantsForUser(ctx.orgId, ctx.userId!);
        if (!this.rbac.can(actorGrants, 'org.member.invite').allowed)
          throw AppError.forbidden('org.member.invite');
        await this.roleRules.assertCanChangeRoles(tx, {
          orgId: ctx.orgId,
          actorUserId: ctx.userId!,
          targetUserId: created.id,
          currentRoleIds: [],
          newRoleIds: roleIds,
        });
        await this.repo.replaceRoles(tx, ctx.orgId, created.id, roleIds);
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'user.created',
        payload: { uuid: created.uuid, email: input.email },
      });

      this.logger.log({ orgId: ctx.orgId, userId: created.id }, 'user created');

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      const roleRows = await this.repo.rolesForUsers(tx, ctx.orgId, [created.id]);
      return toUserResponse(row!, roleRows);
    });
  }

  async update(uuid: string, input: UpdateUserInput): Promise<UserResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('User', uuid);

      const values: Record<string, unknown> = {};
      if (input.fullName !== undefined) values.fullName = input.fullName;
      if (input.status !== undefined) values.status = input.status;

      if (Object.keys(values).length > 0) {
        const updated = await this.repo.updateWithVersion(
          tx,
          ctx.orgId,
          existing.id,
          input.rowVersion,
          values,
        );
        if (!updated) throw AppError.rowVersionConflict('User');
      }

      if (input.roleIds !== undefined) {
        const roleIds = await this.repo.resolveRoleIds(tx, ctx.orgId, input.roleIds);
        const before = await this.repo.currentRoles(tx, ctx.orgId, existing.id);
        const beforeIds = before.map((r) => r.id);
        await this.roleRules.assertCanChangeRoles(tx, {
          orgId: ctx.orgId,
          actorUserId: ctx.userId!,
          targetUserId: existing.id,
          currentRoleIds: beforeIds,
          newRoleIds: roleIds,
        });
        await this.repo.replaceRoles(tx, ctx.orgId, existing.id, roleIds);
        // Role membership changed — every cached grant set for this user is stale.
        await this.rbac.bumpRolesVersion(ctx.orgId);
        // Reference's member.role_changed row carried only the new role; the previous one is recorded too.
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: existing.id,
          action: 'update',
          delta: {
            roles: {
              old: before.map((r) => r.name).sort(),
              new: await this.repo.roleNames(tx, ctx.orgId, roleIds),
            },
          },
        });
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'update' });

      const after = await this.repo.findById(tx, ctx.orgId, existing.id);
      const roleRows = await this.repo.rolesForUsers(tx, ctx.orgId, [existing.id]);
      return toUserResponse(after!, roleRows);
    });
  }
}
