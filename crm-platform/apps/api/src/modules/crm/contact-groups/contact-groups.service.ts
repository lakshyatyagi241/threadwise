import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ContactGroupRef,
  type ContactGroupResponse,
  type CreateContactGroupInput,
  type CreateContactGroupResponse,
  type ListContactGroupsQuery,
  type PageResponse,
  type SetContactGroupsInput,
  type UpdateContactGroupInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope } from '../contacts/contact-scope';
import { ContactsRepository } from '../contacts/contacts.repository';
import { toContactGroupResponse } from './contact-groups.mapper';
import { ContactGroupsRepository } from './contact-groups.repository';
import { segmentNamesUsing } from '../segments/segment-usage';

const MODULE_KEY = 'contact_groups';

const nameTaken = (name: string, existingId: string) =>
  new AppError(
    ERROR_CODES.CON_GROUP_NAME_TAKEN,
    `A group named "${name}" already exists.`,
    HttpStatus.CONFLICT,
    [{ path: 'existingId', message: existingId }],
  );

/**
 * Contact groups (TW-CON-033..037).
 *
 * Rules carried over from Reference: a name is unique per workspace ignoring case, and creating
 * an existing name hands back that group instead of failing (so a double-clicked Save is
 * harmless). Rules fixed: the unique index enforces it (Reference compared names in PHP and could
 * race), renaming onto a taken name is refused (Reference allowed it), and deleting detaches by
 * foreign-key cascade, in the delete's own transaction (Reference rewrote every contact's JSON
 * array, non-transactionally, and nulled their phone hash on the way).
 */
@Injectable()
export class ContactGroupsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactGroupsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async list(query: ListContactGroupsQuery): Promise<PageResponse<ContactGroupResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query);
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toContactGroupResponse), page };
    });
  }

  async get(uuid: string): Promise<ContactGroupResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Contact group', uuid);
      return toContactGroupResponse(row);
    });
  }

  async create(input: CreateContactGroupInput): Promise<CreateContactGroupResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByName(tx, ctx.orgId, input.name);
      if (existing) return { ...toContactGroupResponse(existing), existing: true };

      const created = await this.repo.insertIfAbsent(tx, ctx.orgId, {
        name: input.name,
        note: input.note,
        color: input.color,
        createdBy: ctx.userId,
      });
      if (!created) {
        // Lost a race with a simultaneous create of the same name: that group is the answer.
        const winner = await this.repo.findByName(tx, ctx.orgId, input.name);
        if (!winner) throw AppError.validation('Could not create the group');
        return { ...toContactGroupResponse(winner), existing: true };
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_group.created',
        payload: { uuid: created.uuid, name: input.name },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return { ...toContactGroupResponse(row!), existing: false };
    });
  }

  async update(uuid: string, input: UpdateContactGroupInput): Promise<ContactGroupResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Contact group', uuid);

      const values: { name?: string; note?: string | null; color?: string | null } = {};
      if (input.name !== undefined) values.name = input.name;
      // Absent keeps, null clears.
      if (input.note !== undefined) values.note = input.note;
      if (input.color !== undefined) values.color = input.color;

      if (values.name !== undefined && values.name.toLowerCase() !== existing.name.toLowerCase()) {
        const clash = await this.repo.findByName(tx, ctx.orgId, values.name);
        if (clash && clash.id !== existing.id) throw nameTaken(values.name, clash.uuid);
      }

      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.repo.updateWithVersion(sp, ctx.orgId, existing.id, input.rowVersion, values),
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw nameTaken(values.name ?? existing.name, '');
        }
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Contact group');

      const after = await this.repo.findById(tx, ctx.orgId, existing.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          { name: existing.name, note: existing.note, color: existing.color },
          { name: after!.name, note: after!.note, color: after!.color },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_group.updated',
        payload: { uuid, name: after!.name },
      });
      return toContactGroupResponse(after!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Contact group', uuid);

      // Segments that use this group are not blocked: the condition now matches nothing and is flagged
      // (invalidConditions). GET /segments/usage?kind=group&ref=<id> lists them before the delete.
      const segmentNames = await segmentNamesUsing(tx, ctx.orgId, 'group', uuid);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        delta: {
          name: { old: existing.name, new: null },
          members: { old: existing.memberCount, new: 0 },
          ...(segmentNames.length > 0 ? { segments: { old: segmentNames, new: null } } : {}),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_group.deleted',
        payload: {
          uuid,
          name: existing.name,
          detachedContacts: existing.memberCount,
          segments: segmentNames,
        },
      });
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  // --- one contact's groups ----------------------------------------------------------------

  async groupsOfContact(contactUuid: string): Promise<ContactGroupRef[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      const rows = await this.repo.groupsOfContact(tx, ctx.orgId, contact.id);
      return rows.map((r) => ({ id: r.uuid, name: r.name, color: r.color }));
    });
  }

  /** Replace the contact's groups with exactly `input.groupIds`: an empty array removes the last one too. */
  async setGroupsOfContact(
    contactUuid: string,
    input: SetContactGroupsInput,
  ): Promise<ContactGroupRef[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );

      const uniqueUuids = [...new Set(input.groupIds)];
      const idByUuid = await this.repo.resolveIds(tx, ctx.orgId, uniqueUuids);
      const missing = uniqueUuids.find((u) => !idByUuid.has(u));
      if (missing) throw AppError.notFound('Contact group', missing);

      const before = await this.repo.groupsOfContact(tx, ctx.orgId, contact.id);
      const { added, removed } = await this.repo.replaceMembership(tx, ctx.orgId, contact.id, [
        ...idByUuid.values(),
      ]);
      const after = await this.repo.groupsOfContact(tx, ctx.orgId, contact.id);

      if (added.length > 0 || removed.length > 0) {
        await this.audit.record(tx, {
          module: 'contacts',
          recordId: contact.id,
          action: 'update',
          delta: { groups: { old: before.map((g) => g.name), new: after.map((g) => g.name) } },
        });
        const uuidOf = new Map(after.concat(before).map((g) => [g.id, g.uuid]));
        for (const id of added) {
          await this.outbox.emit(tx, {
            aggregateModule: 'contacts',
            aggregateId: contact.id,
            eventType: 'contact.group_added',
            payload: { uuid: contactUuid, groupId: uuidOf.get(id) },
          });
        }
        for (const id of removed) {
          await this.outbox.emit(tx, {
            aggregateModule: 'contacts',
            aggregateId: contact.id,
            eventType: 'contact.group_removed',
            payload: { uuid: contactUuid, groupId: uuidOf.get(id) },
          });
        }
      }
      return after.map((r) => ({ id: r.uuid, name: r.name, color: r.color }));
    });
  }
}
