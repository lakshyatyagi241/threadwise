import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  WSP_TEAM_DEFAULT_COLOR,
  type CreateWspTeamInput,
  type ListWspTeamsQuery,
  type PageResponse,
  type UpdateWspTeamInput,
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
import { TeamsRepository, type TeamRow } from './teams.repository';

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

/**
 * Teams inside a workspace (TW-WSP-022): the groups the inbox routes conversations to. Any signed-in member may read; creating,
 * editing and deleting need `team.manage` (the controller's decorator).
 *
 * Intended fixes over Reference: `memberIds` must be active members of THIS workspace (Reference attached any user id, even another
 * tenant's), and a team name is unique per workspace.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TeamsRepository,
    private readonly members: MembersRepository,
    private readonly outbox: OutboxService,
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
      const members = await this.repo.members(
        tx,
        ctx.orgId,
        items.map((t) => t.id),
      );
      return {
        data: items.map((t) =>
          toTeamResponse(
            t,
            members.filter((m) => m.teamId === t.id),
          ),
        ),
        page,
      };
    });
  }

  async create(input: CreateWspTeamInput): Promise<WspTeam> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      if (await this.repo.nameTaken(tx, ctx.orgId, input.name)) throw this.nameTaken(input.name);
      const memberIds = await this.resolveMembers(tx, ctx.orgId, input.memberIds);
      const deviceIds = await this.resolveDevices(tx, ctx.orgId, input.deviceIds);

      const id = await this.insertWithUniqueSlug(tx, ctx.orgId, {
        name: input.name,
        color: input.color ?? WSP_TEAM_DEFAULT_COLOR,
        description: input.description?.trim() || null,
        assignmentStrategy: input.assignmentStrategy,
        deviceIds,
      });
      await this.repo.syncMembers(tx, ctx.orgId, id, memberIds);

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

      const changes = {
        name: input.name,
        color: input.color,
        description:
          input.description === undefined ? undefined : input.description?.trim() || null,
        assignmentStrategy: input.assignmentStrategy,
        deviceIds,
      };
      let updated: boolean;
      try {
        updated = await this.repo.update(tx, ctx.orgId, team.id, input.rowVersion, changes);
      } catch (err) {
        if (isNameClash(err)) throw this.nameTaken(input.name ?? team.name);
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Team');
      if (memberIds !== undefined) await this.repo.syncMembers(tx, ctx.orgId, team.id, memberIds);

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
      if (memberIds !== undefined) delta.members = { old: null, new: memberIds.length };
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

  // --- internals ----------------------------------------------------------------------------------------------------------------

  private async load(tx: Tx, orgId: number, team: TeamRow): Promise<WspTeam> {
    return toTeamResponse(team, await this.repo.members(tx, orgId, [team.id]));
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
}
