import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  WSP_TEAM_DEFAULT_COLOR,
  WSP_TEAM_MAX_DEPTH,
  type AddWspTeamMemberInput,
  type CreateWspTeamInput,
  type ListWspTeamsQuery,
  type PageResponse,
  type UpdateWspTeamInput,
  type UpdateWspTeamMemberInput,
  type WspTeam,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MembersRepository } from './members.repository';
import { toTeamResponse } from './teams.mapper';
import { TeamsPlanService } from './teams-plan.service';
import { TeamsRepository, type TeamChanges, type TeamRow } from './teams.repository';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `sales-team-k3x9`: the name, lowercased and dashed, plus four random characters (Reference's slug, kept for deep links). */
function makeSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Array.from(
    { length: 4 },
    () => SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)],
  ).join('');
  return base ? `${base}-${suffix}` : `team-${suffix}`;
}

/** The unique (org, name) index decided a race the name pre-check could not see. */
const isNameClash = (err: unknown): boolean =>
  (err as { code?: string }).code === '23505' &&
  (err as { constraint?: string }).constraint === 'teams_org_id_name_key';

/** The database's own cycle guard (`trg_teams_guard_parent`) caught a race the service check could not see. */
const isParentCycle = (err: unknown): boolean =>
  (err as { constraint?: string }).constraint === 'chk_teams_parent_cycle';

/**
 * Teams inside a workspace (TW-WSP-022, Teams v2): the groups conversations are routed to, records are assigned from, and reports
 * are cut by. Reading needs `team.read`; creating, editing, deleting and changing who is on a team need `team.manage` (the old
 * `inbox.team.manage` is accepted as an alias for one release); both are the controller's decorators.
 *
 * Intended fixes over Reference: `memberIds` must be active members of THIS workspace (Reference attached any user id, even another
 * tenant's), and a team name is unique per workspace.
 *
 * Hierarchy: a team may have one parent, up to {@link WSP_TEAM_MAX_DEPTH} levels, never a loop (checked here for a clear message
 * and again by a database trigger for races). The manager is always a lead member of the team; a member who is removed stops
 * being the manager. Primary team: one per person at most; a person on a single team has it as primary.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TeamsRepository,
    private readonly members: MembersRepository,
    private readonly outbox: OutboxService,
    private readonly plan: TeamsPlanService,
  ) {}

  async list(query: ListWspTeamsQuery): Promise<PageResponse<WspTeam>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
        q: query.q,
      });
      const { items, page } = buildPage(rows, query.limit);
      const ids = items.map((t) => t.id);
      const [members, usage] = await Promise.all([
        this.repo.members(tx, ctx.orgId, ids),
        this.repo.usage(tx, ctx.orgId, ids),
      ]);
      return {
        data: items.map((t) =>
          toTeamResponse(
            t,
            members.filter((m) => m.teamId === t.id),
            usage.find((u) => u.teamId === t.id),
          ),
        ),
        page,
      };
    });
  }

  async get(uuid: string): Promise<WspTeam> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const team = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!team) throw AppError.notFound('Team', uuid);
      return this.load(tx, ctx.orgId, team);
    });
  }

  async create(input: CreateWspTeamInput): Promise<WspTeam> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.plan.assertCanCreate(tx, ctx.orgId);
      // A parent team or a lead/manager needs the plan feature `team_hierarchy`; leaving them empty is always allowed.
      if (input.parentId || input.leadId) await this.plan.assertHierarchy(ctx.orgId);
      // An automatic method (round robin, least loaded) needs `inbox_routing` (Smart routing); Manual is on every plan.
      await this.plan.assertAssignmentMethod(ctx.orgId, input.assignmentStrategy, 'manual');
      if (await this.repo.nameTaken(tx, ctx.orgId, input.name)) throw this.nameTaken(input.name);
      const memberIds = await this.resolveMembers(tx, ctx.orgId, input.memberIds);
      const deviceIds = await this.resolveDevices(tx, ctx.orgId, input.deviceIds);
      const parentId = await this.resolveParent(tx, ctx.orgId, null, input.parentId ?? null, 1);
      const leadUserId = await this.resolveLead(tx, ctx.orgId, input.leadId ?? null);

      const id = await this.insertWithUniqueSlug(tx, ctx.orgId, {
        name: input.name,
        color: input.color ?? WSP_TEAM_DEFAULT_COLOR,
        description: input.description?.trim() || null,
        assignmentStrategy: input.assignmentStrategy,
        deviceIds,
        parentId,
        receivesConversations: input.receivesConversations,
        receivesRecords: input.receivesRecords,
        businessHours: input.businessHours ?? null,
        timezone: input.timezone ?? null,
      });
      const touched = await this.repo.syncMembers(tx, ctx.orgId, id, memberIds);
      if (leadUserId !== null) {
        await this.repo.upsertMember(tx, ctx.orgId, id, leadUserId, 'lead');
        await this.repo.setLeadRaw(tx, ctx.orgId, id, leadUserId);
        touched.push(leadUserId);
      }
      await this.repo.settlePrimary(tx, ctx.orgId, touched);
      if (input.defaultAssigneeId) {
        const assignee = await this.resolveDefaultAssignee(
          tx,
          ctx.orgId,
          id,
          input.defaultAssigneeId,
        );
        await this.repo.setDefaultAssignee(tx, ctx.orgId, id, assignee);
      }

      const team = (await this.repo.byId(tx, ctx.orgId, id))!;
      await this.members.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'teams',
        recordId: id,
        action: 'team.created',
        delta: {
          name: { old: null, new: team.name },
          members: { old: null, new: memberIds.length },
        },
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'teams',
        aggregateId: id,
        eventType: 'team.created',
        payload: { uuid: team.uuid, name: team.name, memberCount: memberIds.length },
      });
      return this.load(tx, ctx.orgId, team);
    });
  }

  async update(uuid: string, input: UpdateWspTeamInput): Promise<WspTeam> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const team = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!team) throw AppError.notFound('Team', uuid);

      if (
        input.name !== undefined &&
        input.name !== team.name &&
        (await this.repo.nameTaken(tx, ctx.orgId, input.name, team.id))
      ) {
        throw this.nameTaken(input.name);
      }
      const memberIds =
        input.memberIds === undefined
          ? undefined
          : await this.resolveMembers(tx, ctx.orgId, input.memberIds);
      const deviceIds =
        input.deviceIds === undefined
          ? undefined
          : await this.resolveDevices(tx, ctx.orgId, input.deviceIds);
      // Setting a NEW parent or manager needs `team_hierarchy`; clearing one (null) stays allowed, and so does saving the team with the
      // parent and manager it already has (a workspace that lost the feature keeps its teams and can still edit them).
      if (
        (input.parentId && input.parentId !== team.parentUuid) ||
        (input.leadId && input.leadId !== team.leadUuid)
      ) {
        await this.plan.assertHierarchy(ctx.orgId);
      }
      // A different automatic method needs `inbox_routing` (Smart routing); keeping the stored one, or choosing Manual, is always allowed.
      await this.plan.assertAssignmentMethod(
        ctx.orgId,
        input.assignmentStrategy,
        team.assignmentStrategy,
      );
      const parentId =
        input.parentId === undefined
          ? undefined
          : await this.resolveParent(tx, ctx.orgId, team, input.parentId, 1);
      const leadUserId =
        input.leadId === undefined
          ? undefined
          : await this.resolveLead(tx, ctx.orgId, input.leadId ?? null);

      const changes: TeamChanges = {
        name: input.name,
        color: input.color,
        description:
          input.description === undefined ? undefined : input.description?.trim() || null,
        assignmentStrategy: input.assignmentStrategy,
        deviceIds,
        parentId,
        leadUserId,
        receivesConversations: input.receivesConversations,
        receivesRecords: input.receivesRecords,
        businessHours: input.businessHours,
        timezone: input.timezone,
      };
      // Read before the update writes the new manager, so the old one can be demoted.
      const previousLead = await this.previousLead(tx, ctx.orgId, team);
      let updated: boolean;
      try {
        updated = await this.repo.update(tx, ctx.orgId, team.id, input.rowVersion, changes);
      } catch (err) {
        if (isNameClash(err)) throw this.nameTaken(input.name ?? team.name);
        if (isParentCycle(err)) throw this.cycle();
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Team');

      const touched: number[] = [];
      if (memberIds !== undefined) {
        touched.push(...(await this.repo.syncMembers(tx, ctx.orgId, team.id, memberIds)));
        // Somebody taken off the list cannot stay the manager.
        if (
          previousLead !== null &&
          !memberIds.includes(previousLead) &&
          leadUserId === undefined
        ) {
          await this.repo.setLeadRaw(tx, ctx.orgId, team.id, null);
        }
      }
      if (leadUserId !== undefined) {
        if (previousLead !== null && previousLead !== leadUserId) {
          await this.repo.setMemberRole(tx, ctx.orgId, team.id, previousLead, 'member');
        }
        if (leadUserId !== null) {
          await this.repo.upsertMember(tx, ctx.orgId, team.id, leadUserId, 'lead');
          touched.push(leadUserId);
        }
      }
      await this.repo.settlePrimary(tx, ctx.orgId, touched);
      // The default assignee is checked against the team as saved just now (a person taken off the team cannot stay the default).
      if (input.defaultAssigneeId !== undefined) {
        const assignee =
          input.defaultAssigneeId === null
            ? null
            : await this.resolveDefaultAssignee(tx, ctx.orgId, team.id, input.defaultAssigneeId);
        await this.repo.setDefaultAssignee(tx, ctx.orgId, team.id, assignee);
      }

      const after = (await this.repo.byId(tx, ctx.orgId, team.id))!;
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (changes.name !== undefined && changes.name !== team.name)
        delta.name = { old: team.name, new: changes.name };
      if (changes.color !== undefined && changes.color !== team.color)
        delta.color = { old: team.color, new: changes.color };
      if (changes.description !== undefined && changes.description !== team.description) {
        delta.description = { old: team.description, new: changes.description };
      }
      if (
        changes.assignmentStrategy !== undefined &&
        changes.assignmentStrategy !== team.assignmentStrategy
      ) {
        delta.assignmentStrategy = {
          old: team.assignmentStrategy,
          new: changes.assignmentStrategy,
        };
      }
      if (deviceIds !== undefined) delta.deviceIds = { old: team.deviceIds, new: after.deviceIds };
      if (input.timezone !== undefined && (input.timezone ?? null) !== team.timezone)
        delta.timezone = { old: team.timezone, new: input.timezone ?? null };
      if (input.businessHours !== undefined)
        delta.businessHours = {
          old: team.businessHours !== null,
          new: input.businessHours !== null,
        };
      if (after.defaultAssigneeUuid !== team.defaultAssigneeUuid)
        delta.defaultAssignee = { old: team.defaultAssigneeUuid, new: after.defaultAssigneeUuid };
      if (memberIds !== undefined) delta.members = { old: null, new: memberIds.length };
      if (after.parentUuid !== team.parentUuid)
        delta.parent = { old: team.parentUuid, new: after.parentUuid };
      if (after.leadUuid !== team.leadUuid)
        delta.lead = { old: team.leadUuid, new: after.leadUuid };
      if (after.receivesConversations !== team.receivesConversations) {
        delta.receivesConversations = {
          old: team.receivesConversations,
          new: after.receivesConversations,
        };
      }
      if (after.receivesRecords !== team.receivesRecords)
        delta.receivesRecords = { old: team.receivesRecords, new: after.receivesRecords };
      await this.members.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'teams',
        recordId: team.id,
        action: 'team.updated',
        delta,
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'teams',
        aggregateId: team.id,
        eventType: 'team.updated',
        payload: { uuid: team.uuid, name: after.name, changed: Object.keys(delta) },
      });
      return this.load(tx, ctx.orgId, after);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const team = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!team) throw AppError.notFound('Team', uuid);
      await this.repo.delete(tx, ctx.orgId, team.id);
      await this.members.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'teams',
        recordId: team.id,
        action: 'team.deleted',
        delta: { name: { old: team.name, new: null } },
        requestId: ctx.requestId,
      });
      // Consumers (routing, the inbox) drop their references to the team on this event; conversations lose it by FK already.
      await this.outbox.emit(tx, {
        aggregateModule: 'teams',
        aggregateId: team.id,
        eventType: 'team.deleted',
        payload: { uuid: team.uuid, name: team.name },
      });
    });
  }

  // --- one person on a team -------------------------------------------------------------------------------------------------------

  /** Adds a person to the team, or changes their role / primary mark when they are on it already. */
  async addMember(uuid: string, input: AddWspTeamMemberInput): Promise<WspTeam> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const team = await this.requireTeam(tx, ctx.orgId, uuid);
      const [userId] = await this.resolveMembers(tx, ctx.orgId, [input.userId]);
      await this.applyMember(tx, ctx.orgId, team, userId!, input.role, input.isPrimary);
      await this.auditMember(tx, ctx, team, 'team.member_added', { userId: input.userId });
      return this.load(tx, ctx.orgId, (await this.repo.byId(tx, ctx.orgId, team.id))!);
    });
  }

  async updateMember(
    uuid: string,
    userUuid: string,
    input: UpdateWspTeamMemberInput,
  ): Promise<WspTeam> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const team = await this.requireTeam(tx, ctx.orgId, uuid);
      const [userId] = await this.resolveMembers(tx, ctx.orgId, [userUuid]);
      if (!(await this.repo.isMember(tx, ctx.orgId, team.id, userId!)))
        throw this.notOnTeam(userUuid);
      await this.applyMember(tx, ctx.orgId, team, userId!, input.role, input.isPrimary);
      await this.auditMember(tx, ctx, team, 'team.member_updated', {
        userId: userUuid,
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      });
      return this.load(tx, ctx.orgId, (await this.repo.byId(tx, ctx.orgId, team.id))!);
    });
  }

  async removeMember(uuid: string, userUuid: string): Promise<WspTeam> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const team = await this.requireTeam(tx, ctx.orgId, uuid);
      const found = await this.repo.activeUserIds(tx, ctx.orgId, [userUuid]);
      const userId = found.get(userUuid);
      if (userId === undefined || !(await this.repo.removeMember(tx, ctx.orgId, team.id, userId))) {
        throw this.notOnTeam(userUuid);
      }
      if ((await this.previousLead(tx, ctx.orgId, team)) === userId) {
        await this.repo.setLeadRaw(tx, ctx.orgId, team.id, null);
      }
      await this.repo.settlePrimary(tx, ctx.orgId, [userId]);
      await this.auditMember(tx, ctx, team, 'team.member_removed', { userId: userUuid });
      return this.load(tx, ctx.orgId, (await this.repo.byId(tx, ctx.orgId, team.id))!);
    });
  }

  // --- internals ----------------------------------------------------------------------------------------------------------------

  private async load(tx: Tx, orgId: number, team: TeamRow): Promise<WspTeam> {
    const [members, usage] = await Promise.all([
      this.repo.members(tx, orgId, [team.id]),
      this.repo.usage(tx, orgId, [team.id]),
    ]);
    return toTeamResponse(team, members, usage[0]);
  }

  private async requireTeam(tx: Tx, orgId: number, uuid: string): Promise<TeamRow> {
    const team = await this.repo.byUuid(tx, orgId, uuid);
    if (!team) throw AppError.notFound('Team', uuid);
    return team;
  }

  /** The manager as recorded, whether or not that person is active right now. */
  private previousLead(tx: Tx, orgId: number, team: TeamRow): Promise<number | null> {
    return this.repo.rawLeadUserId(tx, orgId, team.id);
  }

  private async applyMember(
    tx: Tx,
    orgId: number,
    team: TeamRow,
    userId: number,
    role: 'member' | 'lead' | undefined,
    isPrimary: boolean | undefined,
  ): Promise<void> {
    const onTeam = await this.repo.isMember(tx, orgId, team.id, userId);
    if (!onTeam || role !== undefined) {
      await this.repo.upsertMember(tx, orgId, team.id, userId, role ?? 'member');
    }
    // The manager is a lead; a manager demoted to member stops being the manager.
    if (role === 'member' && (await this.previousLead(tx, orgId, team)) === userId) {
      await this.repo.setLeadRaw(tx, orgId, team.id, null);
    }
    if (isPrimary === true) await this.repo.setPrimary(tx, orgId, team.id, userId);
    else if (isPrimary === false) await this.repo.clearPrimary(tx, orgId, team.id, userId);
    else await this.repo.settlePrimary(tx, orgId, [userId]);
  }

  private async auditMember(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    team: TeamRow,
    action: string,
    delta: Record<string, unknown>,
  ): Promise<void> {
    await this.members.audit(tx, {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      module: 'teams',
      recordId: team.id,
      action,
      delta,
      requestId: ctx.requestId,
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'teams',
      aggregateId: team.id,
      eventType: 'team.updated',
      payload: { uuid: team.uuid, name: team.name, changed: ['members'] },
    });
  }

  /** The member uuids as internal ids, every one an active member of this workspace; anything else is a 422, never attached. */
  private async resolveMembers(tx: Tx, orgId: number, uuids: string[]): Promise<number[]> {
    const unique = [...new Set(uuids)];
    const found = await this.repo.activeUserIds(tx, orgId, unique);
    const unknown = unique.filter((u) => !found.has(u));
    if (unknown.length > 0) {
      throw new AppError(
        ERROR_CODES.WSP_TEAM_MEMBER_UNKNOWN,
        'Some of the chosen members are not active members of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        unknown.map((u) => ({ path: 'memberIds', message: `${u} is not an active member` })),
      );
    }
    return unique.map((u) => found.get(u)!);
  }

  /** The default assignee as an internal id: an active member who is on the team (they take what nobody else can). */
  private async resolveDefaultAssignee(
    tx: Tx,
    orgId: number,
    teamId: number,
    uuid: string,
  ): Promise<number> {
    const found = await this.repo.activeUserIds(tx, orgId, [uuid]);
    const id = found.get(uuid);
    if (id === undefined || !(await this.repo.isMember(tx, orgId, teamId, id))) {
      throw new AppError(
        ERROR_CODES.WSP_TEAM_MEMBER_UNKNOWN,
        'The default assignee must be an active member of this team.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'defaultAssigneeId', message: `${uuid} is not an active member of the team` }],
      );
    }
    return id;
  }

  private async resolveLead(tx: Tx, orgId: number, uuid: string | null): Promise<number | null> {
    if (uuid === null) return null;
    const found = await this.repo.activeUserIds(tx, orgId, [uuid]);
    const id = found.get(uuid);
    if (id === undefined) {
      throw new AppError(
        ERROR_CODES.WSP_TEAM_MEMBER_UNKNOWN,
        'The chosen manager is not an active member of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'leadId', message: `${uuid} is not an active member` }],
      );
    }
    return id;
  }

  /**
   * The parent as an internal id. A team cannot sit under itself or one of its own descendants, and the tree stays within
   * {@link WSP_TEAM_MAX_DEPTH} levels counting the team's own subtree.
   */
  private async resolveParent(
    tx: Tx,
    orgId: number,
    team: TeamRow | null,
    parentUuid: string | null,
    ownHeight: number,
  ): Promise<number | null> {
    if (parentUuid === null) return null;
    const parent = await this.repo.byUuid(tx, orgId, parentUuid);
    if (!parent) {
      throw new AppError(
        ERROR_CODES.WSP_TEAM_PARENT_INVALID,
        'The chosen parent team does not exist in this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'parentId', message: 'unknown team' }],
      );
    }
    let below = ownHeight;
    if (team) {
      const subtree = await this.repo.subtreeIds(tx, orgId, team.id);
      if (subtree.includes(parent.id)) throw this.cycle();
      below = await this.repo.heightBelow(tx, orgId, team.id);
    }
    const depth = (await this.repo.depthOf(tx, orgId, parent.id)) + below;
    if (depth > WSP_TEAM_MAX_DEPTH) {
      throw new AppError(
        ERROR_CODES.WSP_TEAM_PARENT_INVALID,
        `Teams can be nested ${WSP_TEAM_MAX_DEPTH} levels deep at most.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'parentId', message: `deeper than ${WSP_TEAM_MAX_DEPTH} levels` }],
      );
    }
    return parent.id;
  }

  /** Devices of this workspace only; an id that is not one is dropped silently, as Reference did. Empty means every device. */
  private async resolveDevices(tx: Tx, orgId: number, uuids: string[]): Promise<string[]> {
    const unique = [...new Set(uuids)];
    const existing = await this.repo.existingDeviceUuids(tx, orgId, unique);
    return unique.filter((u) => existing.has(u));
  }

  private async insertWithUniqueSlug(
    tx: Tx,
    orgId: number,
    v: Omit<Parameters<TeamsRepository['insert']>[2], 'slug'>,
  ): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = makeSlug(v.name);
      if (await this.repo.slugTaken(tx, orgId, slug)) continue;
      try {
        return await this.repo.insert(tx, orgId, { ...v, slug });
      } catch (err) {
        if (isNameClash(err)) throw this.nameTaken(v.name);
        throw err;
      }
    }
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'Could not allocate a team address; try again.',
      HttpStatus.CONFLICT,
    );
  }

  private nameTaken(name: string): AppError {
    return new AppError(
      ERROR_CODES.WSP_TEAM_NAME_TAKEN,
      `A team called "${name}" already exists in this workspace.`,
      HttpStatus.CONFLICT,
      [{ path: 'name', message: 'already in use' }],
    );
  }

  private cycle(): AppError {
    return new AppError(
      ERROR_CODES.WSP_TEAM_PARENT_CYCLE,
      'A team cannot sit under itself or under one of its own sub-teams.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'parentId', message: 'would create a loop' }],
    );
  }

  private notOnTeam(userUuid: string): AppError {
    return new AppError(
      ERROR_CODES.WSP_TEAM_MEMBER_NOT_ON_TEAM,
      'That person is not on this team.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'userId', message: `${userUuid} is not on this team` }],
    );
  }
}
