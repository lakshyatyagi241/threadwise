import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { ERROR_CODES, type RecordScope } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { RbacService, type GrantSet } from '../../kernel/rbac/rbac.service';

/** The five WaDesk workspace roles, by preset `system_key`, and their rank in the ladder (WD-RBAC-024). */
export const PRESET_RANK: Readonly<Record<string, number>> = {
  admin: 100, // displayed "Owner"
  workspace_admin: 80,
  manager: 60,
  agent: 40,
  viewer: 20,
};

/** Only an Owner may grant or revoke these two (WD-RBAC-026 rule 1). */
const OWNER_GRANTED = new Set(['admin', 'workspace_admin']);

const SCOPE_RANK: Record<RecordScope, number> = { own: 0, team: 1, all: 2 };

interface RoleInfo {
  id: number;
  name: string;
  systemKey: string | null;
}

export interface RoleChange {
  orgId: number;
  actorUserId: number;
  targetUserId: number;
  currentRoleIds: number[];
  newRoleIds: number[];
}

/**
 * Who may hand out which workspace role (WD-RBAC-026, 027). Pure rules plus the reads they need; the callers (the staff-user
 * service, and any future member-invite flow) own the transaction and the audit row.
 *
 * Differences from WaDesk, all closing gaps its inventory lists (D-RBAC-06):
 *   - the target's CURRENT role is checked too, so an Admin cannot demote an Owner or another Admin;
 *   - a custom role can only be granted by someone who already holds every permission in it (no handing out more than you have);
 *   - the organization always keeps an Owner (the database enforces it as well, at commit).
 */
@Injectable()
export class WorkspaceRoleRulesService {
  constructor(private readonly rbac: RbacService) {}

  async assertCanChangeRoles(tx: Tx, change: RoleChange): Promise<void> {
    const { orgId, actorUserId, targetUserId } = change;
    const current = new Set(change.currentRoleIds);
    const next = new Set(change.newRoleIds);
    const added = [...next].filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !next.has(id));
    if (added.length === 0 && removed.length === 0) return;

    if (actorUserId === targetUserId) {
      throw new AppError(
        ERROR_CODES.RBAC_SELF_ROLE_CHANGE,
        'You cannot change your own role.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'roleIds', message: 'You cannot change your own role.' }],
      );
    }

    const actorGrants = await this.rbac.grantsForUser(orgId, actorUserId);
    if (!this.rbac.can(actorGrants, 'org.member.role_assign').allowed)
      throw AppError.forbidden('org.member.role_assign');

    const roles = await this.rolesById(tx, orgId, [...added, ...removed, ...change.currentRoleIds]);
    const actorRank = await this.rankOfUser(tx, orgId, actorUserId);
    const targetRank = Math.max(
      0,
      ...change.currentRoleIds.map((id) => this.rankOf(roles.get(id))),
    );
    // Nobody changes the role of someone above them: an Admin cannot demote an Owner or another Admin.
    if (
      targetRank > actorRank ||
      (targetRank >= PRESET_RANK.workspace_admin! && actorRank < PRESET_RANK.admin!)
    ) {
      throw this.forbidden(this.topRole(roles, change.currentRoleIds));
    }

    for (const id of [...added, ...removed]) {
      const role = roles.get(id);
      if (!role)
        throw AppError.validation('Unknown role.', [{ path: 'roleIds', message: 'Unknown role.' }]);
      if (role.systemKey && OWNER_GRANTED.has(role.systemKey)) {
        if (actorRank < PRESET_RANK.admin!) throw this.forbidden(role);
        continue;
      }
      if (role.systemKey) {
        if (actorRank < PRESET_RANK[role.systemKey]!) throw this.forbidden(role);
        continue;
      }
      // Custom role: a grant the actor does not hold cannot be handed out.
      if (removed.includes(id)) continue;
      if (!(await this.actorCovers(tx, orgId, actorGrants, id))) throw this.forbidden(role);
    }

    // Removing the Owner role from the last Owner is refused here with a clear message; the database enforces it too.
    const ownerRoleId = [...roles.values()].find((r) => r.systemKey === 'admin')?.id;
    if (ownerRoleId !== undefined && removed.includes(ownerRoleId)) {
      const res = await tx.execute(sql`
        SELECT count(*) AS n FROM user_roles ur JOIN users u ON u.org_id = ur.org_id AND u.id = ur.user_id
        WHERE ur.org_id = ${orgId} AND ur.role_id = ${ownerRoleId} AND ur.user_id <> ${targetUserId} AND u.status = 'active'
      `);
      if (Number((res.rows[0] as { n: string }).n) === 0) {
        throw new AppError(
          ERROR_CODES.RBAC_LAST_OWNER,
          'The workspace must keep at least one Owner.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'roleIds', message: 'The workspace must keep at least one Owner.' }],
        );
      }
    }
  }

  /**
   * Editing a role's grants: the actor may only add grants they hold themselves (at the same or a wider scope), the owner-only keys stay with
   * Owners, and the Owner and Admin presets are edited by an Owner only.
   */
  async assertCanEditGrants(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    role: RoleInfo,
    before: ReadonlyArray<{ permissionKey: string; effect: string; recordScope: RecordScope }>,
    after: ReadonlyArray<{ permissionKey: string; effect: string; recordScope: RecordScope }>,
  ): Promise<void> {
    const actorRank = await this.rankOfUser(tx, orgId, actorUserId);
    if (role.systemKey && OWNER_GRANTED.has(role.systemKey) && actorRank < PRESET_RANK.admin!)
      throw this.forbidden(role);
    const actorGrants = await this.rbac.grantsForUser(orgId, actorUserId);
    const had = new Map(before.map((g) => [g.permissionKey, g]));
    for (const g of after) {
      if (g.effect !== 'allow') continue;
      const old = had.get(g.permissionKey);
      if (old && old.effect === 'allow' && SCOPE_RANK[old.recordScope] >= SCOPE_RANK[g.recordScope])
        continue;
      if (!this.covers(actorGrants, g.permissionKey, g.recordScope)) {
        throw new AppError(
          ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN,
          `You cannot grant ${g.permissionKey}: you do not hold it.`,
          HttpStatus.FORBIDDEN,
          [{ path: 'grants', message: g.permissionKey }],
        );
      }
    }
  }

  /** Whether the caller may change this role's permissions: not locked, and the Owner and Admin presets only by an Owner. */
  async canEditRole(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    role: RoleInfo & { isLocked: boolean },
  ): Promise<boolean> {
    if (role.isLocked) return false;
    if (role.systemKey && OWNER_GRANTED.has(role.systemKey)) {
      return (await this.rankOfUser(tx, orgId, actorUserId)) >= PRESET_RANK.admin!;
    }
    return true;
  }

  /**
   * Deactivating a member: not yourself, not someone above you (an Admin cannot switch off an Owner or another Admin), and never the
   * last active Owner.
   */
  async assertCanDeactivate(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    targetUserId: number,
    targetRoleIds: number[],
  ): Promise<void> {
    if (actorUserId === targetUserId) {
      throw new AppError(
        ERROR_CODES.RBAC_SELF_DEACTIVATE,
        'You cannot deactivate your own account here.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'status', message: 'You cannot deactivate your own account here.' }],
      );
    }
    const roles = await this.rolesById(tx, orgId, targetRoleIds);
    const actorRank = await this.rankOfUser(tx, orgId, actorUserId);
    const targetRank = Math.max(0, ...targetRoleIds.map((id) => this.rankOf(roles.get(id))));
    if (
      targetRank > actorRank ||
      (targetRank >= PRESET_RANK.workspace_admin! && actorRank < PRESET_RANK.admin!)
    ) {
      throw this.forbidden(this.topRole(roles, targetRoleIds));
    }
    const ownerRoleId = [...roles.values()].find((r) => r.systemKey === 'admin')?.id;
    if (ownerRoleId !== undefined) {
      const res = await tx.execute(sql`
        SELECT count(*) AS n FROM user_roles ur JOIN users u ON u.org_id = ur.org_id AND u.id = ur.user_id
        WHERE ur.org_id = ${orgId} AND ur.role_id = ${ownerRoleId} AND ur.user_id <> ${targetUserId} AND u.status = 'active'
      `);
      if (Number((res.rows[0] as { n: string }).n) === 0) {
        throw new AppError(
          ERROR_CODES.RBAC_LAST_OWNER,
          'The workspace must keep at least one active Owner.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'status', message: 'The workspace must keep at least one active Owner.' }],
        );
      }
    }
  }

  /** Roles an actor may offer in a picker: the presets at or below their rank, and every custom role they fully cover. */
  async grantableRoleIds(tx: Tx, orgId: number, actorUserId: number): Promise<number[]> {
    const actorGrants = await this.rbac.grantsForUser(orgId, actorUserId);
    if (!this.rbac.can(actorGrants, 'org.member.role_assign').allowed) return [];
    const actorRank = await this.rankOfUser(tx, orgId, actorUserId);
    const res = await tx.execute(
      sql`SELECT id, name, system_key FROM roles WHERE org_id = ${orgId} ORDER BY id`,
    );
    const out: number[] = [];
    for (const r of res.rows as Array<{ id: number; name: string; system_key: string | null }>) {
      if (r.system_key) {
        const ok = OWNER_GRANTED.has(r.system_key)
          ? actorRank >= PRESET_RANK.admin!
          : actorRank >= PRESET_RANK[r.system_key]!;
        if (ok) out.push(r.id);
      } else if (await this.actorCovers(tx, orgId, actorGrants, r.id)) out.push(r.id);
    }
    return out;
  }

  // --- helpers -----------------------------------------------------------------------------------------------------

  private covers(actor: GrantSet, key: string, scope: RecordScope): boolean {
    const g = this.rbac.can(actor, key);
    return g.allowed && SCOPE_RANK[g.scope] >= SCOPE_RANK[scope];
  }

  private async actorCovers(
    tx: Tx,
    orgId: number,
    actor: GrantSet,
    roleId: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT permission_key, record_scope::text AS record_scope FROM role_grants
      WHERE org_id = ${orgId} AND role_id = ${roleId} AND effect = 'allow'
    `);
    return (res.rows as Array<{ permission_key: string; record_scope: RecordScope }>).every((g) =>
      this.covers(actor, g.permission_key, g.record_scope),
    );
  }

  private async rolesById(tx: Tx, orgId: number, ids: number[]): Promise<Map<number, RoleInfo>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT id, name, system_key FROM roles WHERE org_id = ${orgId} AND id IN (${sql.join(
        unique.map((i) => sql`${i}`),
        sql`, `,
      )})
    `);
    return new Map(
      (res.rows as Array<{ id: number; name: string; system_key: string | null }>).map((r) => [
        r.id,
        { id: r.id, name: r.name, systemKey: r.system_key },
      ]),
    );
  }

  private async rankOfUser(tx: Tx, orgId: number, userId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT r.system_key FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
      WHERE ur.org_id = ${orgId} AND ur.user_id = ${userId}
    `);
    return Math.max(
      0,
      ...(res.rows as Array<{ system_key: string | null }>).map((r) =>
        r.system_key ? (PRESET_RANK[r.system_key] ?? 0) : 0,
      ),
    );
  }

  private rankOf(role: RoleInfo | undefined): number {
    return role?.systemKey ? (PRESET_RANK[role.systemKey] ?? 0) : 0;
  }

  private topRole(roles: Map<number, RoleInfo>, ids: number[]): RoleInfo {
    return ids
      .map((id) => roles.get(id)!)
      .filter(Boolean)
      .sort((a, b) => this.rankOf(b) - this.rankOf(a))[0]!;
  }

  private forbidden(role: RoleInfo): AppError {
    return new AppError(
      ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN,
      `You don't have permission to grant the ${role.name} role.`,
      HttpStatus.FORBIDDEN,
      [{ path: 'roleIds', message: `You don't have permission to grant the ${role.name} role.` }],
    );
  }
}
