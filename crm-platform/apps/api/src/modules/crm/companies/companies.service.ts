import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  checkConditionValue,
  segmentKindForFieldType,
  type BulkCompanyIdsInput,
  type CompanyActivityPage,
  type CompanyBulkResult,
  type CompanyContactsPage,
  type CompanyIndustriesResponse,
  type CompanyPropertyFilter,
  type CompanyResponse,
  type CompanySelectItem,
  type CompanySort,
  type CompanySortDir,
  type CompanySelectQuery,
  type CompanyStatsQuery,
  type CompanyStatsResponse,
  type CreateCompanyInput,
  type LinkCompanyContactsInput,
  type ListCompaniesQuery,
  type ListCompanyActivityQuery,
  type ListCompanyContactsQuery,
  type PageResponse,
  type RecordScope,
  type UpdateCompanyInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { DisplayIdService } from '../../../kernel/identifiers/display-id.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, contactScopeCondition, ContactsRepository } from '../contacts';
import { assertOwnerWithinScope } from '../owner-scope';
import { addTo, moneyList, type CurrencySums } from '../deals/deal-money';
import { propertySort } from '../property-predicates';
import { companyEventPayload, companyRollup, toCompanyResponse } from './companies.mapper';
import {
  CompaniesRepository,
  companyScopeCondition,
  type CompanyFilter,
  type CompanyListInput,
  type CompanyPatch,
  type CompanyRow,
} from './companies.repository';
import {
  assertRequiredProperties,
  mergeProperties,
  type CompanyPropertyDef,
} from './company-properties';
import {
  companySortId,
  encodeCompanyCursor,
  hostLabel,
  encodeIdCursor,
  foldActivity,
} from './company-rules';

export const COMPANY_MODULE = 'companies';

const DISPLAY_PREFIX = 'COM';

/** The filter fields a list and the stats share, as they arrive from a query. */
interface FilterInput {
  q?: string;
  ownerId?: string;
  unassigned?: boolean;
  industry?: string;
  hasOpenDeals?: boolean;
  props?: CompanyPropertyFilter[];
}

/** What a list or an export orders by. */
interface SortInput {
  sort: CompanySort;
  sortKey?: string;
  sortDir?: CompanySortDir;
}

type PropertyKind = NonNullable<ReturnType<typeof segmentKindForFieldType>>;

type Delta = Record<string, { old: unknown; new: unknown }>;

/**
 * Companies (TW-CTP-001..). One transaction per operation: the row lock, the write, the audit row and the outbox events commit
 * together or not at all.
 *
 * What differs from Reference (all in the inventory's "Port decisions"): the record scope and the capability keys apply to every
 * route (Reference: any member of a plan with the sales pipeline); the owner must be an active member; the search runs in the
 * database over every company, not in PHP over the newest 500; the rollups are exact and per currency; an update takes the
 * `rowVersion` it read; a delete is audited and unlinks every record that pointed at the company (Reference unlinked contacts and
 * deals by hand and left tasks, projects, proposals and payments dangling); and a company's contacts can be linked and unlinked
 * from the company (Reference could only do it through the AI copilot).
 */
@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CompaniesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly displayIds: DisplayIdService,
    private readonly contacts: ContactsRepository,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------

  async list(
    query: ListCompaniesQuery,
    scope: RecordScope,
  ): Promise<PageResponse<CompanyResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const args = await this.listArgs(tx, ctx.orgId, query, scope);
      if (!args)
        return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      const rows = await this.repo.list(tx, ctx.orgId, {
        ...args,
        cursor: query.cursor,
        limit: query.limit,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: await this.toResponses(tx, ctx.orgId, items),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCompanyCursor(
                  companySortId(args.sort, args.property?.key, args.dir ?? 'desc'),
                  args.sort === 'property'
                    ? (last.sortKey ?? '')
                    : args.sort === 'name'
                      ? last.nameKey
                      : last.createdAtIso,
                  last.id,
                )
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  /**
   * The filter, the scope and the order of a list or an export, with every uuid and property resolved (the list and the file agree
   * because both are built here). `null` means the filter names something that is not in this workspace: the answer is empty.
   */
  async listArgs(
    tx: Tx,
    orgId: number,
    query: FilterInput & SortInput,
    scope: RecordScope,
  ): Promise<Omit<CompanyListInput, 'cursor' | 'limit'> | null> {
    const ctx = RequestContextStore.require();
    const filter = await this.resolveFilter(tx, orgId, query);
    if (!filter) return null;
    const dir = query.sortDir ?? (query.sort === 'created' ? 'desc' : 'asc');
    let property: CompanyListInput['property'];
    if (query.sort === 'property') {
      const key = query.sortKey!;
      const known = (await this.filterableProperties(tx, orgId)).get(key);
      const by = known ? propertySort(sql`c.data`, key, known.kind) : undefined;
      if (!by) {
        throw new AppError(
          ERROR_CODES.COMPANY_FILTER_INVALID,
          'The list cannot be ordered by that property.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'sortKey', message: known ? 'cannot be ordered' : 'not a company property' }],
        );
      }
      property = { key, sort: by };
    }
    return {
      filter,
      scope: companyScopeCondition(orgId, scope, ctx.userId),
      sort: query.sort,
      property,
      dir,
    };
  }

  /** The tiles over the list, inside the same filter and scope (Reference computed them from the rows it had loaded). */
  async stats(query: CompanyStatsQuery, scope: RecordScope): Promise<CompanyStatsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const can = this.can();
      const filter = await this.resolveFilter(tx, ctx.orgId, query);
      if (!filter) {
        return {
          total: 0,
          withOpenDeals: can.deals ? 0 : null,
          wonValue: can.deals ? [] : null,
        };
      }
      const s = await this.repo.stats(
        tx,
        ctx.orgId,
        filter,
        companyScopeCondition(ctx.orgId, scope, ctx.userId),
      );
      const won: CurrencySums = new Map();
      for (const w of s.won) addTo(won, w.currency, w.total);
      return {
        total: s.total,
        withOpenDeals: can.deals ? s.withOpenDeals : null,
        wonValue: can.deals ? moneyList(won) : null,
      };
    });
  }

  async industries(scope: RecordScope): Promise<CompanyIndustriesResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      data: await this.repo.industries(
        tx,
        ctx.orgId,
        companyScopeCondition(ctx.orgId, scope, ctx.userId),
      ),
    }));
  }

  /** Reference's `GET companies/search`: up to `limit` companies by a substring of the name, newest first. */
  async selectData(query: CompanySelectQuery, scope: RecordScope): Promise<CompanySelectItem[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.selectData(tx, ctx.orgId, {
        q: query.q,
        limit: query.limit,
        scope: companyScopeCondition(ctx.orgId, scope, ctx.userId),
      });
      return rows.map((r) => ({ id: r.uuid, name: r.name, industry: r.industry }));
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<CompanyResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Company', uuid);
      await this.assertScope(tx, scope, row);
      return (await this.toResponses(tx, ctx.orgId, [row]))[0]!;
    });
  }

  /** The company's contacts, newest first. The caller's own contact scope applies: a contact they may not see is not listed. */
  async listContacts(
    uuid: string,
    query: ListCompanyContactsQuery,
    scope: RecordScope,
  ): Promise<CompanyContactsPage> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Company', uuid);
      await this.assertScope(tx, scope, row);
      const read = this.rbac.can(ctx.grants!, 'record.contacts.read');
      if (!read.allowed) throw AppError.forbidden('record.contacts.read');
      const rows = await this.repo.contactsOf(tx, ctx.orgId, row.id, {
        cursor: query.cursor,
        limit: query.limit,
        scope: contactScopeCondition(ctx.orgId, read.scope, ctx.userId),
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map((r) => ({ id: r.uuid, name: r.name, phone: r.phone, email: r.email })),
        page: {
          nextCursor: hasMore && last ? encodeIdCursor(last.id) : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  /** Who changed what, newest first: the company's audit trail, with people and contacts named. */
  async activity(
    uuid: string,
    query: ListCompanyActivityQuery,
    scope: RecordScope,
  ): Promise<CompanyActivityPage> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Company', uuid);
      await this.assertScope(tx, scope, row);
      const { items, nextCursor, hasMore } = await this.audit.listByRecord(
        tx,
        ctx.orgId,
        COMPANY_MODULE,
        row.id,
        { limit: query.limit, cursor: query.cursor },
      );

      // Names for every person and contact an entry mentions, in two lookups.
      const actorIds = items
        .filter((i) => i.actorType === 'user' && i.actorId !== null)
        .map((i) => i.actorId as number);
      const ownerUuids = new Set<string>();
      const contactUuids = new Set<string>();
      for (const i of items) {
        for (const [field, change] of Object.entries(i.delta ?? {})) {
          for (const v of [change.old, change.new]) {
            if (typeof v !== 'string') continue;
            if (field === 'owner') ownerUuids.add(v);
            if (field === 'contactLinked' || field === 'contactUnlinked') contactUuids.add(v);
          }
        }
      }
      const people = await this.repo.userNames(
        tx,
        ctx.orgId,
        [...new Set(actorIds)],
        [...ownerUuids],
      );
      const contactNames = await this.repo.contactNames(tx, ctx.orgId, [...contactUuids]);

      const data = foldActivity(
        items.map((i) => {
          const actor =
            i.actorType === 'user' && i.actorId !== null ? people.byId.get(i.actorId) : undefined;
          return {
            action: i.action,
            actor: actor ? { id: actor.uuid, name: actor.name } : null,
            at: i.at,
            delta: i.delta,
          };
        }),
        (field, value) => {
          if (typeof value !== 'string') return value;
          if (field === 'owner') return people.byUuid.get(value) ?? null;
          if (field === 'contactLinked' || field === 'contactUnlinked')
            return { id: value, name: contactNames.get(value) ?? null };
          return value;
        },
      );
      return { data, page: { nextCursor, hasMore, limit: query.limit } };
    });
  }

  // --- writes ----------------------------------------------------------------------------------------------------------

  async create(input: CreateCompanyInput): Promise<CompanyResponse> {
    return this.db.tx((tx) => this.createIn(tx, input));
  }

  /** `create`, inside the caller's transaction (the CSV import makes each row in its own savepoint). */
  async createIn(
    tx: Tx,
    input: CreateCompanyInput,
    /** The workspace's company properties, when the caller already read them (an import makes many companies). */
    knownDefs?: readonly CompanyPropertyDef[],
  ): Promise<CompanyResponse> {
    const ctx = RequestContextStore.require();
    {
      // Omitted means the caller (so a record scope of `own` keeps sight of what its holder creates); null means nobody.
      const ownerId =
        input.ownerId === undefined
          ? ctx.userId
          : await this.resolveOwner(tx, ctx.orgId, input.ownerId);
      await this.assertOwnerAllowed(tx, 'record.companies.create', ownerId);
      // The workspace's company properties: a value must fit its property, and a required one must be answered (even when none is sent).
      const defs = knownDefs ?? (await this.repo.propertyDefs(tx, ctx.orgId));
      const { next: data, changed: customKeys } = mergeProperties(
        defs,
        input.customFields ?? {},
        {},
      );
      assertRequiredProperties(defs, data);
      const id = await this.repo.insert(tx, ctx.orgId, {
        name: input.name,
        domain: input.website ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        industry: input.industry ?? null,
        sizeRange: input.sizeRange ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        data,
        ownerId,
        createdBy: ctx.userId,
        displayId: await this.displayIds.next(tx, ctx.orgId, COMPANY_MODULE, DISPLAY_PREFIX),
      });
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, {
        module: COMPANY_MODULE,
        recordId: row.id,
        action: 'insert',
        delta: {
          name: { old: null, new: row.name },
          ...(row.website !== null ? { website: { old: null, new: row.website } } : {}),
          ...(row.industry !== null ? { industry: { old: null, new: row.industry } } : {}),
          ...(row.ownerUuid !== null ? { owner: { old: null, new: row.ownerUuid } } : {}),
          ...(customKeys.length > 0 ? { customFieldKeys: { old: null, new: customKeys } } : {}),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COMPANY_MODULE,
        aggregateId: row.id,
        eventType: 'company.created',
        payload: companyEventPayload(row),
      });
      return (await this.toResponses(tx, ctx.orgId, [row]))[0]!;
    }
  }

  /**
   * The company of a public form's submission (docs/specs/forms-builder-app.md 9.3), inside the caller's transaction (the public pipeline
   * writes the contact, the company and the submission together). Finds the company by website, then by name; a match has its blanks
   * filled and nothing a person typed is overwritten; no match creates one, owned by `ownerId`. Audited and announced like a company made
   * by hand (`company.created` / `company.updated`, `via: 'form'`). Returns null when the input names neither a website nor a company.
   */
  async resolveForSubmission(
    tx: Tx,
    orgId: number,
    input: {
      name: string | null;
      host: string | null;
      email: string | null;
      phone: string | null;
      industry: string | null;
      sizeRange: string | null;
      address: string | null;
      notes: string | null;
      custom: Record<string, unknown>;
      ownerId: number | null;
      /** Match an existing company (`false` = the form does not touch existing companies; a new one is made). */
      match: boolean;
    },
  ): Promise<{ id: number; uuid: string; created: boolean } | null> {
    const name = input.name?.trim() ? input.name.trim().slice(0, 191) : null;
    if (!name && !input.host) return null;
    const found = input.match
      ? await this.repo.findByDomainOrName(tx, orgId, { host: input.host, name })
      : undefined;
    if (found) {
      const changed = await this.repo.fillBlanks(tx, orgId, found.id, {
        domain: input.host,
        email: input.email,
        phone: input.phone,
        industry: input.industry,
        sizeRange: input.sizeRange,
        address: input.address,
        notes: input.notes,
        custom: input.custom,
      });
      if (changed.length > 0) {
        const after = (await this.repo.findById(tx, orgId, found.id))!;
        await this.audit.record(tx, {
          module: COMPANY_MODULE,
          recordId: found.id,
          action: 'update',
          delta: Object.fromEntries(
            changed.map((k) => [k, { old: null, new: 'filled by a form' }]),
          ),
        });
        await this.outbox.emit(tx, {
          aggregateModule: COMPANY_MODULE,
          aggregateId: found.id,
          eventType: 'company.updated',
          payload: { ...companyEventPayload(after), changed, via: 'form' },
        });
      }
      return { id: found.id, uuid: found.uuid, created: false };
    }
    const id = await this.repo.insert(tx, orgId, {
      name: name ?? hostLabel(input.host!),
      domain: input.host,
      email: input.email,
      phone: input.phone,
      industry: input.industry,
      sizeRange: input.sizeRange,
      address: input.address,
      notes: input.notes,
      data: {},
      ownerId: input.ownerId,
      createdBy: null,
      displayId: await this.displayIds.next(tx, orgId, COMPANY_MODULE, DISPLAY_PREFIX),
    });
    if (Object.keys(input.custom).length > 0)
      await this.repo.fillBlanks(tx, orgId, id, { custom: input.custom });
    const row = (await this.repo.findById(tx, orgId, id))!;
    await this.audit.record(tx, {
      module: COMPANY_MODULE,
      recordId: row.id,
      action: 'insert',
      delta: { name: { old: null, new: row.name } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: COMPANY_MODULE,
      aggregateId: row.id,
      eventType: 'company.created',
      payload: { ...companyEventPayload(row), via: 'form' },
    });
    return { id: row.id, uuid: row.uuid, created: true };
  }

  async update(
    uuid: string,
    input: UpdateCompanyInput,
    scope: RecordScope,
  ): Promise<CompanyResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Company');

      const patch: CompanyPatch = {};
      const delta: Delta = {};
      const text = (
        key: 'name' | 'email' | 'phone' | 'industry' | 'address' | 'notes',
        value: string | null | undefined,
        column: keyof CompanyPatch,
        current: string | null,
      ) => {
        if (value === undefined || value === current) return;
        (patch as Record<string, unknown>)[column] = value;
        delta[key] = { old: current, new: value };
      };
      text('name', input.name, 'name', row.name);
      text('email', input.email, 'email', row.email);
      text('phone', input.phone, 'phone', row.phone);
      text('industry', input.industry, 'industry', row.industry);
      text('address', input.address, 'address', row.address);
      text('notes', input.notes, 'notes', row.notes);
      if (input.website !== undefined && input.website !== row.website) {
        patch.domain = input.website;
        delta.website = { old: row.website, new: input.website };
      }
      if (input.sizeRange !== undefined && input.sizeRange !== row.sizeRange) {
        patch.size_range = input.sizeRange;
        delta.sizeRange = { old: row.sizeRange, new: input.sizeRange };
      }
      if (input.ownerId !== undefined) {
        const owner = await this.resolveOwner(tx, ctx.orgId, input.ownerId);
        if (owner !== row.ownerId) {
          await this.assertOwnerAllowed(tx, 'record.companies.update', owner, scope);
          patch.owner_id = owner;
        }
      }
      if (input.customFields !== undefined) {
        // A save that sends properties answers for all of them (a required one cannot be blanked); an edit of other fields does not.
        const defs = await this.repo.propertyDefs(tx, ctx.orgId);
        const merged = mergeProperties(defs, input.customFields, row.data);
        assertRequiredProperties(defs, merged.next);
        if (merged.changed.length > 0) {
          patch.data = merged.next;
          delta.customFieldKeys = { old: null, new: merged.changed };
        }
      }

      if (Object.keys(patch).length > 0) {
        const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
        if (!ok) throw AppError.rowVersionConflict('Company');
        const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
        // Ids in the trail are uuids, read back from the row after the write (the repository speaks bigint, the audit must not).
        if (row.ownerUuid !== after.ownerUuid)
          delta.owner = { old: row.ownerUuid, new: after.ownerUuid };
        await this.audit.record(tx, {
          module: COMPANY_MODULE,
          recordId: row.id,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: COMPANY_MODULE,
          aggregateId: row.id,
          eventType: 'company.updated',
          payload: { ...companyEventPayload(after), changed: Object.keys(delta) },
        });
      }
      const current = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      return (await this.toResponses(tx, ctx.orgId, [current]))[0]!;
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      await this.deleteRow(tx, ctx.orgId, row);
    });
  }

  async bulkDelete(input: BulkCompanyIdsInput, scope: RecordScope): Promise<CompanyBulkResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const result: CompanyBulkResult = { succeeded: [], failed: [] };
      for (const id of [...new Set(input.ids)]) {
        try {
          // Each company in its own savepoint: one bad id (unknown, out of scope, a race) rolls back only itself.
          await tx.transaction(async (rowTx) => {
            const row = await this.lockForWrite(rowTx, id, scope);
            await this.deleteRow(rowTx, ctx.orgId, row);
          });
          result.succeeded.push(id);
        } catch (err) {
          result.failed.push(this.failure(id, err));
        }
      }
      return result;
    });
  }

  // --- the company's contacts ----------------------------------------------------------------------------------------------

  /**
   * Puts existing contacts under the company; a contact that belonged to another company moves. Needs record.contacts.update on
   * each contact (its own record scope applies). Each contact is its own savepoint: the rest succeed and the failures are listed.
   */
  async linkContacts(
    uuid: string,
    input: LinkCompanyContactsInput,
    scope: RecordScope,
  ): Promise<CompanyBulkResult> {
    const ctx = RequestContextStore.require();
    const update = this.rbac.can(ctx.grants!, 'record.contacts.update');
    if (!update.allowed) throw AppError.forbidden('record.contacts.update');
    return this.db.tx(async (tx) => {
      const company = await this.lockForWrite(tx, uuid, scope);
      const result: CompanyBulkResult = { succeeded: [], failed: [] };
      for (const contactUuid of [...new Set(input.contactIds)]) {
        try {
          await tx.transaction((rowTx) =>
            this.moveContact(rowTx, company, contactUuid, company.id, update.scope),
          );
          result.succeeded.push(contactUuid);
        } catch (err) {
          result.failed.push(this.failure(contactUuid, err));
        }
      }
      return result;
    });
  }

  /** Takes a contact out of the company (the contact is kept). 404 when it is not one of the company's contacts. */
  async unlinkContact(uuid: string, contactUuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    const update = this.rbac.can(ctx.grants!, 'record.contacts.update');
    if (!update.allowed) throw AppError.forbidden('record.contacts.update');
    await this.db.tx(async (tx) => {
      const company = await this.lockForWrite(tx, uuid, scope);
      const contact = await this.repo.contactCompany(tx, ctx.orgId, contactUuid);
      if (!contact || contact.companyId !== company.id)
        throw AppError.notFound('Contact', contactUuid);
      await this.moveContact(tx, company, contactUuid, null, update.scope);
    });
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  /**
   * Moves one contact to `toCompanyId` (null = out of any company), with the audit rows and events on the contact and on each
   * company it leaves or joins. Moving to the company it is already in changes nothing.
   */
  private async moveContact(
    tx: Tx,
    company: CompanyRow,
    contactUuid: string,
    toCompanyId: number | null,
    contactScope: RecordScope,
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    const ref = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
    if (!ref) throw AppError.notFound('Contact', contactUuid);
    await assertContactScope(tx, this.contacts, ctx.orgId, contactScope, ctx.userId!, ref.ownerId);
    const contact = (await this.contacts.findById(tx, ctx.orgId, ref.id))!;
    if (contact.companyId === toCompanyId) return;

    const previousUuid =
      contact.companyId === null
        ? null
        : await this.repo.companyUuid(tx, ctx.orgId, contact.companyId);
    await this.contacts.updateFieldsById(tx, ctx.orgId, contact.id, {
      companyId: toCompanyId,
      updatedBy: ctx.userId,
    });
    // The contact's own history shows the change in the field the contacts screen already knows.
    await this.audit.record(tx, {
      module: 'contacts',
      recordId: contact.id,
      action: 'update',
      delta: { companyId: { old: previousUuid, new: toCompanyId === null ? null : company.uuid } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'contacts',
      aggregateId: contact.id,
      eventType: 'contact.updated',
      payload: {
        uuid: contactUuid,
        previousStage: contact.lifecycleStage,
        stage: contact.lifecycleStage,
        companyId: toCompanyId === null ? null : company.uuid,
        previousCompanyId: previousUuid,
      },
    });
    if (contact.companyId !== null) {
      await this.audit.record(tx, {
        module: COMPANY_MODULE,
        recordId: contact.companyId,
        action: 'update',
        delta: { contactUnlinked: { old: contactUuid, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COMPANY_MODULE,
        aggregateId: contact.companyId,
        eventType: 'company.contact_unlinked',
        payload: { uuid: previousUuid, contactId: contactUuid },
      });
    }
    if (toCompanyId !== null) {
      await this.audit.record(tx, {
        module: COMPANY_MODULE,
        recordId: toCompanyId,
        action: 'update',
        delta: { contactLinked: { old: null, new: contactUuid } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COMPANY_MODULE,
        aggregateId: toCompanyId,
        eventType: 'company.contact_linked',
        payload: { uuid: company.uuid, contactId: contactUuid, previousCompanyId: previousUuid },
      });
    }
  }

  private async deleteRow(tx: Tx, orgId: number, row: CompanyRow): Promise<void> {
    const counts = (
      await this.repo.counts(tx, orgId, [row.id], { contacts: true, deals: true })
    ).get(row.id);
    const unlinkedContacts = counts?.contacts ?? 0;
    const unlinkedDeals = (counts?.deals ?? []).reduce((sum, d) => sum + d.n, 0);
    await this.audit.record(tx, {
      module: COMPANY_MODULE,
      recordId: row.id,
      action: 'delete',
      delta: {
        name: { old: row.name, new: null },
        contactsUnlinked: { old: unlinkedContacts, new: null },
        dealsUnlinked: { old: unlinkedDeals, new: null },
      },
    });
    await this.outbox.emit(tx, {
      aggregateModule: COMPANY_MODULE,
      aggregateId: row.id,
      eventType: 'company.deleted',
      payload: { ...companyEventPayload(row), unlinkedContacts, unlinkedDeals },
    });
    await this.repo.deleteById(tx, orgId, row.id);
  }

  /** uuids of a filter to internal ids. `null` means a uuid in it is not in this workspace: the answer is empty. */
  private async resolveFilter(
    tx: Tx,
    orgId: number,
    f: FilterInput,
  ): Promise<CompanyFilter | null> {
    const out: CompanyFilter = {
      q: f.q,
      unassigned: f.unassigned,
      industry: f.industry,
      hasOpenDeals: f.hasOpenDeals,
    };
    if (f.ownerId) {
      const id = await this.repo.resolveUserId(tx, orgId, f.ownerId);
      if (id === undefined) return null;
      out.ownerId = id;
    }
    if (f.props && f.props.length > 0) out.props = await this.resolveProps(tx, orgId, f.props);
    return out;
  }

  /** The company properties a list can filter or order by: active and stored, by key, with the kind that decides their operators. */
  private async filterableProperties(
    tx: Tx,
    orgId: number,
  ): Promise<Map<string, { def: CompanyPropertyDef; kind: PropertyKind }>> {
    const out = new Map<string, { def: CompanyPropertyDef; kind: PropertyKind }>();
    for (const def of await this.repo.propertyDefs(tx, orgId)) {
      const kind = segmentKindForFieldType(def.fieldType);
      if (def.isActive && !def.isMasked && kind) out.set(def.key, { def, kind });
    }
    return out;
  }

  /** Property conditions checked against the registry: a missing, inactive or computed property, or an operator that does not suit it, is 422. */
  private async resolveProps(
    tx: Tx,
    orgId: number,
    props: readonly CompanyPropertyFilter[],
  ): Promise<NonNullable<CompanyFilter['props']>> {
    const known = await this.filterableProperties(tx, orgId);
    const problems: Array<{ path: string; message: string }> = [];
    const out: NonNullable<CompanyFilter['props']> = [];
    props.forEach((p, i) => {
      const entry = known.get(p.key);
      if (!entry) {
        problems.push({
          path: `props.${i}.key`,
          message: 'not a company property you can filter by',
        });
        return;
      }
      const why = checkConditionValue(entry.kind, p.operator, p.value);
      if (why) {
        problems.push({ path: `props.${i}`, message: why });
        return;
      }
      out.push({ key: p.key, kind: entry.kind, operator: p.operator, value: p.value });
    });
    if (problems.length > 0) {
      throw new AppError(
        ERROR_CODES.COMPANY_FILTER_INVALID,
        `A property condition cannot be used: ${problems.map((p) => p.message).join('; ')}.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        problems,
      );
    }
    return out;
  }

  /** `null` is nobody; a uuid must be an ACTIVE member of this workspace (422 otherwise). */
  private async resolveOwner(tx: Tx, orgId: number, uuid: string | null): Promise<number | null> {
    if (uuid === null) return null;
    const user = await this.repo.resolveActiveUser(tx, orgId, uuid);
    if (!user) {
      throw new AppError(
        ERROR_CODES.COMPANY_OWNER_INVALID,
        'The owner must be an active member of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'ownerId', message: uuid }],
      );
    }
    return user.id;
  }

  /** What the caller may count: a kind of record they cannot read has no figure on a company. */
  private can(): { contacts: boolean; deals: boolean } {
    const grants = RequestContextStore.require().grants!;
    return {
      contacts: this.rbac.can(grants, 'record.contacts.read').allowed,
      deals: this.rbac.can(grants, 'record.deals.read').allowed,
    };
  }

  private async toResponses(tx: Tx, orgId: number, rows: CompanyRow[]): Promise<CompanyResponse[]> {
    const can = this.can();
    const counts = await this.repo.counts(
      tx,
      orgId,
      rows.map((r) => r.id),
      can,
    );
    return rows.map((r) => toCompanyResponse(r, companyRollup(counts.get(r.id), can)));
  }

  /** AZ-007: the record scope also bounds who a company may be handed to (the caller, a teammate, or anyone for `all`). */
  private async assertOwnerAllowed(
    tx: Tx,
    permission: 'record.companies.create' | 'record.companies.update',
    nextOwnerId: number | null,
    scope?: RecordScope,
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    if (!ctx.grants && !scope) return;
    await assertOwnerWithinScope({
      scope: scope ?? this.rbac.can(ctx.grants!, permission).scope,
      actorUserId: ctx.userId,
      nextOwnerId,
      inActorTeam: (id) => this.repo.isInActorTeam(tx, ctx.orgId, ctx.userId!, id),
      path: 'ownerId',
    });
  }

  private async lockForWrite(tx: Tx, uuid: string, scope: RecordScope): Promise<CompanyRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
    if (!row) throw AppError.notFound('Company', uuid);
    await this.assertScope(tx, scope, row);
    return row;
  }

  /** Not-found, never forbidden: a company outside the caller's scope is not revealed to exist. */
  private async assertScope(tx: Tx, scope: RecordScope, row: CompanyRow): Promise<void> {
    const ctx = RequestContextStore.require();
    if (scope === 'all') return;
    const actor = ctx.userId;
    if (!actor) throw AppError.notFound('Company');
    if (row.ownerId === actor || row.createdById === actor) return;
    if (scope === 'team') {
      for (const other of [row.ownerId, row.createdById]) {
        if (other !== null && (await this.repo.isInActorTeam(tx, ctx.orgId, actor, other))) return;
      }
    }
    throw AppError.notFound('Company');
  }

  private failure(id: string, err: unknown): CompanyBulkResult['failed'][number] {
    if (err instanceof AppError) return { id, code: err.code, message: err.message };
    this.logger.error({ err, id }, 'a company bulk or link step failed');
    return { id, code: ERROR_CODES.INTERNAL, message: 'Unexpected error' };
  }
}
