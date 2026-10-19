import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';
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
import { AccountGateService, PasswordService, SessionService } from '../../auth';
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
    private readonly sessions: SessionService,
    private readonly gates: AccountGateService,
  ) {}

  /** Role uuids in a request must all be roles of the caller's workspace: an unknown or foreign one is refused, never dropped. */
  private async resolveRoleIdsStrict(tx: Tx, orgId: number, uuids: string[]): Promise<number[]> {
    const ids = await this.repo.resolveRoleIds(tx, orgId, uuids);
    if (ids.length !== new Set(uuids).size) {
      throw AppError.validation('One or more roles do not exist in this workspace', [
        { path: 'roleIds', message: 'unknown role' },
      ]);
    }
    return ids;
  }

  async list(query: ListUsersQuery): Promise<PageResponse<UserResponse>> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
        q: query.q,
        status: query.status,
        teamId: query.teamId,
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

      const teamRows = await this.repo.teamsForUsers(
        tx,
        ctx.orgId,
        items.map((u) => u.id),
      );
      return {
        data: items.map((row) => toUserResponse(row, rolesByUser.get(row.id) ?? [], teamRows)),
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
      return toUserResponse(row, roleRows, await this.repo.teamsForUsers(tx, ctx.orgId, [row.id]));
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
      return toUserResponse(row, roleRows, await this.repo.teamsForUsers(tx, ctx.orgId, [row.id]));
    });
  }

  async create(input: CreateUserInput): Promise<UserResponse> {
    return this.roleRules.withDenialAudit('user.create', () => this.createInTx(input));
  }

  private async createInTx(input: CreateUserInput): Promise<UserResponse> {
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

      const roleIds = await this.resolveRoleIdsStrict(tx, ctx.orgId, input.roleIds);
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
      return toUserResponse(row!, roleRows, []);
    });
  }

  async update(uuid: string, input: UpdateUserInput): Promise<UserResponse> {
    return this.roleRules.withDenialAudit('user.update', () => this.updateInTx(uuid, input));
  }

  private async updateInTx(uuid: string, input: UpdateUserInput): Promise<UserResponse> {
    const ctx = RequestContextStore.require();
    let rolesChanged = false;
    let suspendedUserId = null as number | null;

    const result = await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('User', uuid);

      if (input.status === 'inactive' && existing.status !== 'inactive') {
        const held = await this.repo.currentRoles(tx, ctx.orgId, existing.id);
        await this.roleRules.assertCanDeactivate(
          tx,
          ctx.orgId,
          ctx.userId!,
          existing.id,
          held.map((r) => r.id),
        );
      }

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

      if (input.status === 'inactive' && existing.status !== 'inactive') {
        suspendedUserId = existing.id;
      }

      if (input.roleIds !== undefined) {
        const roleIds = await this.resolveRoleIdsStrict(tx, ctx.orgId, input.roleIds);
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
        rolesChanged = true;
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
      return toUserResponse(
        after!,
        roleRows,
        await this.repo.teamsForUsers(tx, ctx.orgId, [existing.id]),
      );
    });

    // Both run only once the change is committed, so a request racing the edit cannot cache the old state again.
    if (rolesChanged) await this.rbac.bumpRolesVersion(ctx.orgId);
    if (suspendedUserId !== null) {
      // Suspension ends access now, not when the access token or the 30 s gate cache runs out.
      await this.sessions.revokeAllForUser(ctx.orgId, suspendedUserId, 'member_suspended');
      await this.gates.invalidate(ctx.orgId, suspendedUserId);
    }
    return result;
  }
}
