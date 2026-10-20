import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  WSP_INVITE_TTL_DAYS,
  inviteWspMemberSchema,
  type ChangeWspMemberRoleInput,
  type InviteWspMemberInput,
  type InviteWspMemberResponse,
  type SetWspAvailabilityInput,
  type UpdateWspMemberDetailsInput,
  type WspAvailability,
  type ListWspMembersQuery,
  type PageResponse,
  type WspMember,
  type WspMemberActionResponse,
  type WspMembersSummary,
  type WspRoleTier,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore, type RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  AccountGateService,
  MailService,
  PasswordService,
  SessionService,
  UserTokensService,
} from '../auth';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WorkspaceRoleRulesService } from '../roles-permissions';
import { assertCanActOn, type Actor } from './member-rules';
import { toMemberResponse, toMemberStatus, toRoleRef } from './members.mapper';
import { MembersRepository, TIER_SCORE, type MemberRow } from './members.repository';

const INVITE_TTL_SECONDS = WSP_INVITE_TTL_DAYS * 24 * 60 * 60;
/** A reset link is the auth domain's own: same token kind, same 60 minute life, same page. */
const RESET_TTL_SECONDS = 60 * 60;

interface Acting extends Actor {
  id: number;
  uuid: string;
  fullName: string;
}

interface Delivery {
  email: string;
  fullName: string;
  url: string;
}

/**
 * Workspace members (TW-WSP-015..019, 046): the list, the invite by single-use link, role changes, removal and password reset.
 *
 * One role model: the roles are the RBAC domain's presets (Owner, Admin, Manager, Agent, Viewer) and custom roles, and who may
 * hand out which role, change a role, or demote the last Owner is `WorkspaceRoleRulesService`'s. What stays here is the member
 * lifecycle: an invitation is a link the invitee uses to choose their own password (no temporary password is ever shown),
 * removal is soft and ends sessions, nobody removes themselves or an Owner, nobody acts on a member who outranks them, and only
 * an Owner resets an Owner's password (docs/threadwise-port/parity/workspaces-teams-tenancy.md).
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MembersRepository,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly roleRules: WorkspaceRoleRulesService,
    private readonly tokens: UserTokensService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly gates: AccountGateService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------------------------------

  async list(query: ListWspMembersQuery): Promise<PageResponse<WspMember>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const page = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        q: query.q,
        tier: query.tier,
      });
      const ids = page.rows.map((r) => r.id);
      const [roles, teams] = await Promise.all([
        this.repo.rolesForUsers(tx, ctx.orgId, ids),
        this.repo.teamUuidsForUsers(tx, ctx.orgId, ids),
      ]);
      return {
        data: page.rows.map((row) =>
          toMemberResponse(
            row,
            roles.filter((r) => r.userId === row.id),
            teams.get(row.id) ?? [],
          ),
        ),
        page: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: query.limit },
      };
    });
  }

  async summary(): Promise<WspMembersSummary> {
    const ctx = RequestContextStore.require();
    const grants = await this.rbac.grantsForUser(ctx.orgId, ctx.userId!);
    const planLimit = await this.entitlements.limit(ctx.orgId, 'users');
    return this.db.tx(async (tx) => {
      const me = await this.actor(tx, ctx.orgId, ctx.userId!);
      const { byTier, pending } = await this.repo.tierCounts(tx, ctx.orgId);
      const count = (t: WspRoleTier) => byTier.get(t) ?? 0;
      // Which roles this caller may hand out is the RBAC rule (TW-RBAC-026), asked once for the whole picker.
      const grantable = new Set(await this.roleRules.grantableRoleIds(tx, ctx.orgId, ctx.userId!));
      const roles = (await this.repo.listRoles(tx, ctx.orgId))
        .map((r) => ({ ...toRoleRef(r), grantable: grantable.has(r.id) }))
        .sort((a, b) => TIER_SCORE[b.tier] - TIER_SCORE[a.tier] || a.name.localeCompare(b.name));
      return {
        counts: {
          all: [...byTier.values()].reduce((a, b) => a + b, 0),
          owner: count('owner'),
          admin: count('admin'),
          manager: count('manager'),
          agent: count('agent'),
          viewer: count('viewer'),
          custom: count('custom'),
          pending,
        },
        roles,
        seats: {
          used: await this.repo.seatsUsed(tx, ctx.orgId),
          limit: planLimit > 0 ? planLimit : null,
        },
        me: {
          id: me.uuid,
          tier: me.tier,
          canInvite: this.rbac.can(grants, 'org.member.invite').allowed,
          canAssignRoles: this.rbac.can(grants, 'org.member.role_assign').allowed,
          canManageTeams:
            this.rbac.can(grants, 'team.manage').allowed ||
            this.rbac.can(grants, 'inbox.team.manage').allowed,
        },
      };
    });
  }

  // --- invite -------------------------------------------------------------------------------------------------------------------

  /**
   * Order is Reference's (TW-WSP-016 rule 1): the seat limit first, so a full workspace says so even for a bad payload, then
   * the payload, then who may grant the role. `raw` is therefore validated here, not by a pipe in front of the handler.
   */
  async invite(raw: unknown): Promise<InviteWspMemberResponse> {
    const ctx = RequestContextStore.require();
    const done = await this.db.tx(async (tx) => {
      await this.entitlements.assertWithinLimit(
        ctx.orgId,
        'users',
        await this.repo.seatsUsed(tx, ctx.orgId),
      );
      const input = new ZodValidationPipe<InviteWspMemberInput>(inviteWspMemberSchema).transform(
        raw,
      );
      const actor = await this.actor(tx, ctx.orgId, ctx.userId!);

      const role = await this.repo.roleByUuid(tx, ctx.orgId, input.roleId);
      if (!role) {
        throw AppError.validation('Request payload failed validation', [
          { path: 'roleId', message: 'unknown role' },
        ]);
      }
      // Handing out a role is the RBAC rule (TW-RBAC-026). The invitee has no account yet, hence target 0 and no current roles.
      await this.roleRules.assertCanChangeRoles(tx, {
        orgId: ctx.orgId,
        actorUserId: ctx.userId!,
        targetUserId: 0,
        currentRoleIds: [],
        newRoleIds: [role.id],
      });

      const existing = await this.repo.userByEmail(tx, ctx.orgId, input.email);
      if (existing && existing.status !== 'inactive') {
        throw this.alreadyMember(input.email);
      }
      const passwordHash = await this.unusableHash();
      let userId: number;
      try {
        if (existing) {
          userId = existing.id;
          await this.repo.reactivate(tx, ctx.orgId, userId, {
            fullName: input.fullName,
            passwordHash,
          });
          await this.repo.resetSecurity(tx, ctx.orgId, userId);
        } else {
          userId = (await this.repo.insertPending(tx, ctx.orgId, { ...input, passwordHash })).id;
          await this.repo.ensureSecurity(tx, ctx.orgId, userId);
        }
      } catch (err) {
        // Two invitations for the same address racing: the unique (org, email) index decides, the loser is "already a member".
        if ((err as { code?: string }).code === '23505') throw this.alreadyMember(input.email);
        throw err;
      }
      // A reinvited member starts clean (the old number and limit do not come back); a new one gets what the form carried.
      if (existing || input.phone !== undefined || input.chatLimit !== undefined) {
        await this.repo.upsertDetails(tx, ctx.orgId, userId, {
          phone: input.phone ?? null,
          chatLimit: input.chatLimit ?? null,
        });
      }
      await this.repo.setSingleRole(tx, ctx.orgId, userId, role.id);
      const token = await this.tokens.issue(tx, ctx.orgId, userId, 'invite', INVITE_TTL_SECONDS, {
        invitedBy: actor.id,
      });

      const member = await this.load(tx, ctx.orgId, userId);
      await this.repo.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'members',
        recordId: userId,
        action: 'member.invited',
        delta: {
          email: { old: null, new: input.email },
          role: { old: null, new: role.name },
          reactivated: { old: null, new: !!existing },
        },
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'members',
        aggregateId: userId,
        eventType: 'member.invited',
        payload: { uuid: member.id, email: input.email, roleId: role.uuid, invitedBy: actor.uuid },
      });
      const org = await this.repo.orgInfo(tx, ctx.orgId);
      return {
        member,
        kind: 'invite' as const,
        delivery: {
          email: input.email,
          fullName: input.fullName,
          url: this.mail.link('/accept-invite', { token, org: org.slug }),
        },
        inviter: actor.fullName,
        workspace: org.name,
        roleName: role.name,
      };
    });
    return this.deliverInvite(done);
  }

  async resendInvite(uuid: string): Promise<WspMemberActionResponse> {
    const ctx = RequestContextStore.require();
    const done = await this.db.tx(async (tx) => {
      const actor = await this.actor(tx, ctx.orgId, ctx.userId!);
      const target = await this.requireMember(tx, ctx.orgId, uuid);
      if (toMemberStatus(target) !== 'pending') {
        throw new AppError(
          ERROR_CODES.WSP_INVITE_NOT_PENDING,
          'This member has already joined, so there is no invitation to send again.',
          HttpStatus.CONFLICT,
        );
      }
      assertCanActOn(actor, { tier: target.tier });
      return this.reissueInvite(tx, ctx, actor, target, 'member.invite_resent');
    });
    return this.deliverInvite(done);
  }

  // --- role ---------------------------------------------------------------------------------------------------------------------

  async changeRole(uuid: string, input: ChangeWspMemberRoleInput): Promise<WspMember> {
    return this.roleRules.withDenialAudit('member.change_role', () =>
      this.changeRoleInTx(uuid, input),
    );
  }

  private async changeRoleInTx(uuid: string, input: ChangeWspMemberRoleInput): Promise<WspMember> {
    const ctx = RequestContextStore.require();
    const result = await this.db.tx(async (tx) => {
      const target = await this.requireMember(tx, ctx.orgId, uuid);
      const role = await this.repo.roleByUuid(tx, ctx.orgId, input.roleId);
      if (!role) {
        throw AppError.validation('Request payload failed validation', [
          { path: 'roleId', message: 'unknown role' },
        ]);
      }
      const before = await this.repo.rolesForUsers(tx, ctx.orgId, [target.id]);
      // Self change, acting on someone above you, owner-only grants, custom roles you do not fully hold and the last Owner are
      // all the RBAC rule (TW-RBAC-026): one model for this screen and for Settings > Users.
      await this.roleRules.assertCanChangeRoles(tx, {
        orgId: ctx.orgId,
        actorUserId: ctx.userId!,
        targetUserId: target.id,
        currentRoleIds: before.map((r) => r.roleId),
        newRoleIds: [role.id],
      });
      if (!(await this.repo.touchWithVersion(tx, ctx.orgId, target.id, input.rowVersion))) {
        throw AppError.rowVersionConflict('Member');
      }
      await this.repo.setSingleRole(tx, ctx.orgId, target.id, role.id);
      await this.repo.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'members',
        recordId: target.id,
        action: 'member.role_changed',
        delta: { role: { old: before.map((r) => r.roleName), new: [role.name] } },
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'members',
        aggregateId: target.id,
        eventType: 'member.role_changed',
        payload: {
          uuid: target.uuid,
          roleId: role.uuid,
          previousRoleIds: before.map((r) => r.roleUuid),
        },
      });
      return this.load(tx, ctx.orgId, target.id);
    });
    // Cached grant sets are keyed by the organization's roles version: bump it only once the change is visible.
    await this.rbac.bumpRolesVersion(ctx.orgId);
    return result;
  }

  // --- details (phone, chat limit) ---------------------------------------------------------------------------------------------

  /**
   * The Change member dialog: phone number and maximum concurrent chats. Same rank rule as the other member actions (nobody edits
   * a member above them); optimistic by row version. The last login is read only and never accepted here.
   */
  async updateDetails(uuid: string, input: UpdateWspMemberDetailsInput): Promise<WspMember> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const actor = await this.actor(tx, ctx.orgId, ctx.userId!);
      const target = await this.requireMember(tx, ctx.orgId, uuid);
      assertCanActOn(actor, target);
      if (!(await this.repo.touchWithVersion(tx, ctx.orgId, target.id, input.rowVersion))) {
        throw AppError.rowVersionConflict('Member');
      }
      await this.repo.upsertDetails(tx, ctx.orgId, target.id, {
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.chatLimit !== undefined ? { chatLimit: input.chatLimit } : {}),
      });
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.phone !== undefined && input.phone !== target.phone) {
        delta.phone = { old: target.phone, new: input.phone };
      }
      if (input.chatLimit !== undefined && input.chatLimit !== target.chatLimit) {
        delta.chatLimit = { old: target.chatLimit, new: input.chatLimit };
      }
      await this.repo.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'members',
        recordId: target.id,
        action: 'member.details_changed',
        delta,
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'members',
        aggregateId: target.id,
        eventType: 'member.details_changed',
        payload: { uuid: target.uuid, changed: Object.keys(delta) },
      });
      return this.load(tx, ctx.orgId, target.id);
    });
  }

  // --- availability -------------------------------------------------------------------------------------------------------------

  /** The caller's own switch, as routing reads it: no stored status counts as `online`. */
  async myAvailability(): Promise<WspAvailability> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      status:
        (await this.repo.availabilityOf(tx, ctx.orgId, ctx.userId!)) === 'offline'
          ? 'offline'
          : 'online',
    }));
  }

  /**
   * Available / Offline for the caller only. `offline` takes the agent out of every automatic assignment (routing rules, round
   * robin, least busy); conversations already theirs stay theirs. Anything other than offline reads available.
   */
  async setMyAvailability(input: SetWspAvailabilityInput): Promise<WspAvailability> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.availabilityOf(tx, ctx.orgId, ctx.userId!);
      await this.repo.setAvailability(tx, ctx.orgId, ctx.userId!, input.status);
      if ((before === 'offline' ? 'offline' : 'online') !== input.status) {
        await this.repo.audit(tx, {
          orgId: ctx.orgId,
          actorId: ctx.actorId,
          actorType: ctx.actorType,
          module: 'members',
          recordId: ctx.userId!,
          action: 'member.availability_changed',
          delta: { availability: { old: before, new: input.status } },
          requestId: ctx.requestId,
        });
      }
      return { status: input.status };
    });
  }

  // --- remove -------------------------------------------------------------------------------------------------------------------

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const gone = await this.db.tx(async (tx) => {
      const actor = await this.actor(tx, ctx.orgId, ctx.userId!);
      const target = await this.requireMember(tx, ctx.orgId, uuid);
      if (target.id === ctx.userId) {
        throw new AppError(
          ERROR_CODES.WSP_CANNOT_REMOVE_SELF,
          'You cannot remove yourself from the workspace.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (target.tier === 'owner') {
        throw new AppError(
          ERROR_CODES.WSP_CANNOT_REMOVE_OWNER,
          'Cannot remove the workspace owner.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      assertCanActOn(actor, target);

      await this.repo.deactivate(tx, ctx.orgId, target.id);
      await this.repo.cancelLiveTokens(tx, ctx.orgId, target.id);
      await this.repo.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'members',
        recordId: target.id,
        action: 'member.removed',
        delta: {
          email: { old: target.email, new: null },
          status: { old: toMemberStatus(target), new: 'inactive' },
        },
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'members',
        aggregateId: target.id,
        eventType: 'member.removed',
        payload: { uuid: target.uuid, email: target.email, removedBy: actor.uuid },
      });
      return target;
    });
    // Access ends now, not when the 15 minute token runs out: sessions die, the cached gate and grants are dropped.
    await this.sessions.revokeAllForUser(ctx.orgId, gone.id, 'member_removed');
    await this.gates.invalidate(ctx.orgId, gone.id);
    await this.rbac.bumpRolesVersion(ctx.orgId);
  }

  // --- reset password -----------------------------------------------------------------------------------------------------------

  /**
   * Reference replaced the password with a temporary one it displayed. Here the member gets the auth domain's own
   * set-password link by email; nobody sees a password. A member who never accepted their invitation gets a fresh invitation.
   */
  async resetPassword(uuid: string): Promise<WspMemberActionResponse> {
    const ctx = RequestContextStore.require();
    const done = await this.db.tx(async (tx) => {
      const actor = await this.actor(tx, ctx.orgId, ctx.userId!);
      const target = await this.requireMember(tx, ctx.orgId, uuid);
      if (target.tier === 'owner' && actor.tier !== 'owner') {
        throw new AppError(
          ERROR_CODES.WSP_CANNOT_ACT_ON_HIGHER_RANK,
          "Only a workspace owner can reset the owner's password.",
          HttpStatus.FORBIDDEN,
        );
      }
      assertCanActOn(actor, target);

      if (toMemberStatus(target) === 'pending') {
        return this.reissueInvite(tx, ctx, actor, target, 'member.password_reset');
      }
      const token = await this.tokens.issue(
        tx,
        ctx.orgId,
        target.id,
        'password_reset',
        RESET_TTL_SECONDS,
      );
      await this.repo.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'members',
        recordId: target.id,
        action: 'member.password_reset',
        delta: { email: { old: null, new: target.email } },
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'members',
        aggregateId: target.id,
        eventType: 'member.password_reset',
        payload: { uuid: target.uuid, requestedBy: actor.uuid },
      });
      const org = await this.repo.orgInfo(tx, ctx.orgId);
      return {
        member: await this.load(tx, ctx.orgId, target.id),
        kind: 'reset' as const,
        delivery: {
          email: target.email,
          fullName: target.fullName,
          url: this.mail.link('/reset-password', { org: org.slug, token }),
        },
      };
    });
    return this.deliverInvite(done);
  }

  // --- internals ----------------------------------------------------------------------------------------------------------------

  private async reissueInvite(
    tx: Tx,
    ctx: RequestContext,
    actor: Acting,
    target: MemberRow,
    action: 'member.invite_resent' | 'member.password_reset',
  ) {
    const token = await this.tokens.issue(tx, ctx.orgId, target.id, 'invite', INVITE_TTL_SECONDS, {
      invitedBy: actor.id,
    });
    await this.repo.audit(tx, {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      module: 'members',
      recordId: target.id,
      action,
      delta: { email: { old: null, new: target.email } },
      requestId: ctx.requestId,
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'members',
      aggregateId: target.id,
      eventType: action,
      payload: { uuid: target.uuid, requestedBy: actor.uuid },
    });
    const org = await this.repo.orgInfo(tx, ctx.orgId);
    const roles = await this.repo.rolesForUsers(tx, ctx.orgId, [target.id]);
    return {
      member: await this.load(tx, ctx.orgId, target.id),
      kind: 'invite' as const,
      delivery: {
        email: target.email,
        fullName: target.fullName,
        url: this.mail.link('/accept-invite', { token, org: org.slug }),
      },
      inviter: actor.fullName,
      workspace: org.name,
      roleName: roles[0]?.roleName ?? '',
    };
  }

  /** Sends after the transaction committed; a mail that cannot go out hands the link back once, to the person who asked. */
  private async deliverInvite(done: {
    member: WspMember;
    kind: 'invite' | 'reset';
    delivery: Delivery;
    inviter?: string;
    workspace?: string;
    roleName?: string;
  }): Promise<WspMemberActionResponse> {
    const { delivery } = done;
    const sent =
      done.kind === 'invite'
        ? await this.mail.sendWorkspaceInvite(delivery.email, delivery.fullName, {
            inviter: done.inviter ?? null,
            workspace: done.workspace ?? '',
            role: done.roleName ?? '',
            url: delivery.url,
            days: WSP_INVITE_TTL_DAYS,
          })
        : await this.mail.sendPasswordReset(delivery.email, delivery.fullName, delivery.url);
    return { member: done.member, emailSent: sent, inviteLink: sent ? null : delivery.url };
  }

  private async actor(tx: Tx, orgId: number, userId: number): Promise<Acting> {
    const row = await this.repo.byId(tx, orgId, userId);
    if (!row) throw AppError.unauthenticated();
    return { id: row.id, uuid: row.uuid, fullName: row.fullName, tier: row.tier };
  }

  private async load(tx: Tx, orgId: number, userId: number): Promise<WspMember> {
    const row = await this.repo.byId(tx, orgId, userId);
    const [roles, teams] = await Promise.all([
      this.repo.rolesForUsers(tx, orgId, [userId]),
      this.repo.teamUuidsForUsers(tx, orgId, [userId]),
    ]);
    return toMemberResponse(row!, roles, teams.get(userId) ?? []);
  }

  /** A member of this organization who has not been removed, else 404 (a removed or foreign member looks the same). */
  private async requireMember(tx: Tx, orgId: number, uuid: string): Promise<MemberRow> {
    const row = await this.repo.byUuid(tx, orgId, uuid);
    if (!row || row.status === 'inactive') throw AppError.notFound('Member', uuid);
    return row;
  }

  private alreadyMember(email: string): AppError {
    return new AppError(
      ERROR_CODES.WSP_ALREADY_MEMBER,
      `${email} is already a member of this workspace.`,
      HttpStatus.CONFLICT,
    );
  }

  /** The password of an account nobody can sign in to yet: a hash of bytes that are never stored or shown. */
  private unusableHash(): Promise<string> {
    return this.passwords.hash(randomBytes(32).toString('base64url'));
  }
}
