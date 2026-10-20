import { HttpStatus, Injectable } from '@nestjs/common';
import {
  activityCapabilities,
  ERROR_CODES,
  MAX_CUSTOM_ACTIVITIES,
  MAX_OPTIONS_PER_LIST,
  type ActivityBehaviour,
  type ActivityOption,
  type ActivityOptionKind,
  type SalesActivityType,
  type ActivityTypesResponse,
  type AddActivityOptionInput,
  type CreateActivityTypeInput,
  type PhoneCountsAs,
  type ReorderActivityOptionsInput,
  type UpdateActivityTypeInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import {
  customKeyOf,
  initialSwitches,
  isFullOrder,
  nameKeyOf,
  slugOf,
  unsupportedSwitches,
} from './activity-type-rules';
import {
  ActivityTypesRepository,
  type ActivityOptionRow,
  type ActivityOptionWithOwner,
  type ActivityTypeRow,
  type TypePatch,
} from './activity-types.repository';

const MODULE_KEY = 'activity_types';

const toOption = (o: ActivityOptionRow): ActivityOption => ({
  id: o.uuid,
  kind: o.kind,
  key: o.key,
  name: o.name,
  isSystem: o.isSystem,
  countsAs: o.countsAs,
  position: o.position,
});

function toActivity(a: ActivityTypeRow, options: ActivityOptionRow[]): SalesActivityType {
  const mine = options.filter((o) => o.activityTypeId === a.id);
  return {
    id: a.uuid,
    key: a.key,
    name: a.name,
    isDefault: a.isDefault,
    behavesAs: a.behavesAs,
    icon: a.icon,
    position: a.position,
    showInCalendar: a.showInCalendar,
    allowComplete: a.allowComplete,
    allowEditCompleted: a.allowEditCompleted,
    mobileCheckIn: a.mobileCheckIn,
    outcomesEnabled: a.outcomesEnabled,
    taskTypes: mine.filter((o) => o.kind === 'type').map(toOption),
    outcomes: mine.filter((o) => o.kind === 'outcome').map(toOption),
    rowVersion: a.rowVersion,
  };
}

/**
 * Settings > Sales Activities: the registry of the workspace's activity types and their lists. The same service answers the questions the
 * task, meeting and call screens ask ("may this be completed?", "is this outcome one of the current ones?"), so there is one place that
 * knows what a switch means.
 */
@Injectable()
export class ActivityTypesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ActivityTypesRepository,
    private readonly audit: AuditService,
  ) {}

  // --- the settings page --------------------------------------------------------------------------------------------------

  async list(): Promise<ActivityTypesResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({ data: await this.snapshot(tx, ctx.orgId) }));
  }

  async create(input: CreateActivityTypeInput): Promise<SalesActivityType> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.ensureSeeded(tx, ctx.orgId);
      if ((await this.repo.countCustom(tx, ctx.orgId)) >= MAX_CUSTOM_ACTIVITIES) {
        throw new AppError(
          ERROR_CODES.ACTIVITY_LIMIT_REACHED,
          `A workspace can have at most ${MAX_CUSTOM_ACTIVITIES} custom activities.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const existing = await this.repo.customNamesAndKeys(tx, ctx.orgId);
      const wanted = nameKeyOf(input.name);
      if (existing.some((e) => !e.archived && e.name !== null && nameKeyOf(e.name) === wanted)) {
        throw this.nameTaken();
      }
      let attempt = 0;
      while (existing.some((e) => e.key === customKeyOf(input.name, attempt))) attempt += 1;

      const sw = initialSwitches(input.behavesAs);
      const id = await this.repo.insertType(tx, ctx.orgId, {
        key: customKeyOf(input.name, attempt),
        name: input.name,
        behavesAs: input.behavesAs,
        icon: input.icon,
        position: await this.repo.nextTypePosition(tx, ctx.orgId),
        showInCalendar: sw.showInCalendar,
        allowComplete: sw.allowComplete,
        outcomesEnabled: sw.outcomesEnabled,
        createdBy: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: id,
        action: 'insert',
        delta: {
          name: { old: null, new: input.name },
          behavesAs: { old: null, new: input.behavesAs },
        },
      });
      return this.one(tx, ctx.orgId, id);
    });
  }

  async update(uuid: string, input: UpdateActivityTypeInput): Promise<SalesActivityType> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.requireType(tx, ctx.orgId, uuid, true);
      if (input.rowVersion !== row.rowVersion)
        throw AppError.rowVersionConflict('SalesActivityType');
      if (row.isDefault && input.name !== undefined) throw this.locked();
      if (row.isDefault && input.icon !== undefined) throw this.locked();
      const bad = unsupportedSwitches(row.behavesAs, input);
      if (bad.length > 0) {
        throw new AppError(
          ERROR_CODES.ACTIVITY_FEATURE_OFF,
          `This activity does not offer: ${bad.join(', ')}.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (input.name !== undefined) {
        const wanted = nameKeyOf(input.name);
        const others = await this.repo.customNamesAndKeys(tx, ctx.orgId);
        if (
          others.some(
            (e) =>
              !e.archived && e.key !== row.key && e.name !== null && nameKeyOf(e.name) === wanted,
          )
        ) {
          throw this.nameTaken();
        }
      }

      const patch: TypePatch = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const set = <K extends keyof TypePatch & keyof ActivityTypeRow>(k: K) => {
        const next = input[k as keyof UpdateActivityTypeInput];
        if (next !== undefined && next !== row[k]) {
          (patch as Record<string, unknown>)[k] = next;
          delta[k] = { old: row[k], new: next };
        }
      };
      set('name');
      set('icon');
      set('showInCalendar');
      set('allowComplete');
      set('allowEditCompleted');
      set('mobileCheckIn');
      set('outcomesEnabled');
      if (Object.keys(patch).length > 0) {
        const ok = await this.repo.updateType(tx, ctx.orgId, row.id, input.rowVersion, patch);
        if (!ok) throw AppError.rowVersionConflict('SalesActivityType');
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: row.id,
          action: 'update',
          delta,
        });
      }
      return this.one(tx, ctx.orgId, row.id);
    });
  }

  /** Removes a custom activity from the list. Its records keep their outcomes; a default cannot be removed. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.requireType(tx, ctx.orgId, uuid, true);
      if (row.isDefault) throw this.locked();
      await this.repo.archiveType(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'delete',
        delta: { name: { old: row.name, new: null } },
      });
    });
  }

  async addOption(uuid: string, input: AddActivityOptionInput): Promise<SalesActivityType> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.requireType(tx, ctx.orgId, uuid, true);
      this.assertListOffered(row, input.kind);
      const all = await this.repo.allOptionsOf(tx, ctx.orgId, row.id, input.kind);
      const active = all.filter((o) => o.deletedAt === null);
      if (active.length >= MAX_OPTIONS_PER_LIST) {
        throw new AppError(
          ERROR_CODES.ACTIVITY_LIMIT_REACHED,
          `A list can have at most ${MAX_OPTIONS_PER_LIST} items.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const key = slugOf(input.name);
      const same = all.find((o) => o.key === key);
      if (same && same.deletedAt === null) throw this.nameTaken();
      // Only a phone outcome needs to say what it counts as; an outcome of anything else is just a label.
      const countsAs: PhoneCountsAs | null =
        input.kind === 'outcome' && row.behavesAs === 'phone'
          ? (input.countsAs ?? 'connected')
          : null;
      const position = active.length === 0 ? 0 : Math.max(...active.map((o) => o.position)) + 1;
      let optionId: number;
      if (same) {
        // The same name as a removed one: bring it back (its old records keep pointing at it).
        await this.repo.reviveOption(
          tx,
          ctx.orgId,
          same.id,
          position,
          same.isSystem ? null : input.name,
          countsAs,
        );
        optionId = same.id;
      } else {
        optionId = await this.repo.insertOption(tx, ctx.orgId, {
          typeId: row.id,
          kind: input.kind,
          key: await this.freeKey(all, key),
          name: input.name,
          countsAs,
          position,
        });
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: {
          [input.kind === 'type' ? 'taskTypeAdded' : 'outcomeAdded']: {
            old: null,
            new: input.name,
          },
        },
      });
      void optionId;
      return this.one(tx, ctx.orgId, row.id);
    });
  }

  async removeOption(uuid: string, optionUuid: string): Promise<SalesActivityType> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.requireType(tx, ctx.orgId, uuid, true);
      const option = await this.repo.findOptionByUuid(tx, ctx.orgId, row.id, optionUuid);
      if (!option) throw AppError.notFound('ActivityOption', optionUuid);
      // Soft delete: a record that holds it still reads it, only the pickers stop offering it.
      await this.repo.softDeleteOption(tx, ctx.orgId, option.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: {
          [option.kind === 'type' ? 'taskTypeRemoved' : 'outcomeRemoved']: {
            old: option.name ?? option.key,
            new: null,
          },
        },
      });
      return this.one(tx, ctx.orgId, row.id);
    });
  }

  async reorderOptions(
    uuid: string,
    input: ReorderActivityOptionsInput,
  ): Promise<SalesActivityType> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.requireType(tx, ctx.orgId, uuid, true);
      this.assertListOffered(row, input.kind);
      const active = (await this.repo.allOptionsOf(tx, ctx.orgId, row.id, input.kind)).filter(
        (o) => o.deletedAt === null,
      );
      if (
        !isFullOrder(
          active.map((o) => o.uuid),
          input.ids,
        )
      ) {
        throw AppError.validation('Send every item of the list once, in the new order.', [
          { path: 'ids', message: 'Not the current list' },
        ]);
      }
      const byUuid = new Map(active.map((o) => [o.uuid, o.id]));
      await this.repo.setPositions(
        tx,
        ctx.orgId,
        input.ids.map((id) => byUuid.get(id)!),
      );
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: {
          [input.kind === 'type' ? 'taskTypeOrder' : 'outcomeOrder']: {
            old: null,
            new: input.ids.length,
          },
        },
      });
      return this.one(tx, ctx.orgId, row.id);
    });
  }

  // --- what the task, meeting and call screens ask ----------------------------------------------------------------------

  /** The switches of a default activity ('task', 'meeting' or 'phone'), seeding the workspace first if it has none yet. */
  async settingsOf(
    tx: Tx,
    orgId: number,
    key: 'task' | 'meeting' | 'phone',
  ): Promise<ActivityTypeRow> {
    let row = await this.repo.findTypeByKey(tx, orgId, key);
    if (!row) {
      await this.repo.seed(tx, orgId);
      row = await this.repo.findTypeByKey(tx, orgId, key);
    }
    if (!row) throw AppError.notFound('SalesActivityType', key);
    return row;
  }

  /**
   * A task type or outcome a person picked, checked against the current lists: it must exist, not be removed, be of the wanted kind and
   * belong to an activity that behaves as `behavesAs`; an outcome also needs the activity's "outcomes" switch on.
   */
  async resolveOption(
    tx: Tx,
    orgId: number,
    optionUuid: string,
    kind: ActivityOptionKind,
    behavesAs: ActivityBehaviour,
  ): Promise<ActivityOptionWithOwner> {
    const option = await this.repo.optionWithOwner(tx, orgId, optionUuid);
    const invalid = () =>
      new AppError(
        ERROR_CODES.ACTIVITY_OPTION_INVALID,
        kind === 'type'
          ? 'That task type is not in the list any more.'
          : 'That outcome is not in the list any more.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    if (!option || option.deletedAt !== null || option.activityArchived) throw invalid();
    if (option.kind !== kind || option.activityBehavesAs !== behavesAs) throw invalid();
    if (kind === 'outcome' && !option.activityOutcomesEnabled) {
      throw new AppError(
        ERROR_CODES.ACTIVITY_FEATURE_OFF,
        'Outcomes are switched off for this activity.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return option;
  }

  /** The id of the seeded "Follow up" task type, for the follow-up tasks lead handling makes. Null when the workspace has no defaults yet. */
  async followUpTypeId(tx: Tx, orgId: number): Promise<number | null> {
    return this.repo.systemOptionId(tx, orgId, 'task', 'type', 'follow_up');
  }

  // --- internals ----------------------------------------------------------------------------------------------------------

  private async ensureSeeded(tx: Tx, orgId: number): Promise<void> {
    if ((await this.repo.findTypeByKey(tx, orgId, 'task')) === undefined)
      await this.repo.seed(tx, orgId);
  }

  private async snapshot(tx: Tx, orgId: number): Promise<SalesActivityType[]> {
    await this.ensureSeeded(tx, orgId);
    const [types, options] = await Promise.all([
      this.repo.listTypes(tx, orgId),
      this.repo.listOptions(tx, orgId),
    ]);
    return types.map((t) => toActivity(t, options));
  }

  private async one(tx: Tx, orgId: number, id: number): Promise<SalesActivityType> {
    const all = await this.snapshot(tx, orgId);
    const types = await this.repo.listTypes(tx, orgId);
    const row = types.find((t) => t.id === id);
    const found = all.find((a) => a.id === row?.uuid);
    if (!found) throw AppError.notFound('SalesActivityType');
    return found;
  }

  private async requireType(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock: boolean,
  ): Promise<ActivityTypeRow> {
    const row = await this.repo.findTypeByUuid(tx, orgId, uuid, lock);
    if (!row) throw AppError.notFound('SalesActivityType', uuid);
    return row;
  }

  private assertListOffered(row: ActivityTypeRow, kind: ActivityOptionKind): void {
    const cap = activityCapabilities(row.behavesAs);
    // The default Task activity's outcomes are the workspace's task outcomes (`/v2/task-outcomes`), not rows of this registry.
    if (kind === 'outcome' && row.key === 'task' && row.isDefault) {
      throw new AppError(
        ERROR_CODES.ACTIVITY_FEATURE_OFF,
        'Task outcomes are edited through /v2/task-outcomes.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if ((kind === 'type' && !cap.taskTypes) || (kind === 'outcome' && !cap.outcomes)) {
      throw new AppError(
        ERROR_CODES.ACTIVITY_FEATURE_OFF,
        kind === 'type' ? 'This activity has no task types.' : 'This activity has no outcomes.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /** Keys are unique per list including removed items; two names that slug alike (after a revive was ruled out) get a number. */
  private async freeKey(all: ActivityOptionRow[], key: string): Promise<string> {
    if (!all.some((o) => o.key === key)) return key;
    let i = 2;
    while (all.some((o) => o.key === `${key}_${i}`)) i += 1;
    return `${key}_${i}`.slice(0, 60);
  }

  private nameTaken(): AppError {
    return new AppError(
      ERROR_CODES.ACTIVITY_NAME_TAKEN,
      'That name is already in use here.',
      HttpStatus.CONFLICT,
    );
  }

  private locked(): AppError {
    return new AppError(
      ERROR_CODES.ACTIVITY_DEFAULT_LOCKED,
      'A default activity cannot be renamed or removed. Its switches and lists can be changed.',
      HttpStatus.CONFLICT,
    );
  }
}
