import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  RESERVED_ATTRIBUTE_KEYS,
  SYSTEM_ATTRIBUTES,
  type AttributeCatalog,
  type AttributeListResponse,
  type AttributePickerFeed,
  type AttributeResponse,
  type CreateAttributeInput,
  type DeleteAttributeQuery,
  type ListAttributesQuery,
  type ResolveMergeTagInput,
  type ResolveMergeTagResponse,
  type UpdateAttributeInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { PlanUsageService } from '../../plans-subscriptions-trials';
import { assertContactScope } from '../contacts/contact-scope';
import { ContactsRepository } from '../contacts/contacts.repository';
import { propertyPermissionKey, type PropertyAction } from '../field-metadata-permission';
import { toAttributeResponse } from './attributes.mapper';
import { AttributesRepository } from './attributes.repository';
import { renderMergeTags, type MergeContact } from './merge-tags';

const MODULE_KEY = 'fields';

/**
 * Attributes (TW-CON-042..048): the merge variables of a workspace, kept in the typed field
 * registry. Compared with Reference:
 *  - managing them needs the Contact Properties permissions (Reference let every member, viewers
 *    included, create, edit and delete them);
 *  - the active flag is an explicit boolean, so an attribute can really be switched off;
 *  - keys are `^[a-z][a-z0-9_]{0,63}$`, unique, and may not shadow a system token or a contact
 *    column (the column would silently win at send time);
 *  - deleting one that contacts hold values for asks for confirmation;
 *  - an inactive attribute is hidden from the picker and not resolved at send time.
 */
@Injectable()
export class AttributesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AttributesRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly planUsage: PlanUsageService,
  ) {}

  private require(action: PropertyAction): void {
    const ctx = RequestContextStore.require();
    const key = propertyPermissionKey('contacts', action);
    if (!this.rbac.can(ctx.grants!, key).allowed) throw AppError.forbidden(key);
  }

  async list(query: ListAttributesQuery): Promise<AttributeListResponse> {
    this.require('read');
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query);
      const { items, page } = buildPage(rows, query.limit);
      return {
        data: items.map(toAttributeResponse),
        page,
        counts: await this.repo.counts(tx, ctx.orgId),
      };
    });
  }

  async get(uuid: string): Promise<AttributeResponse> {
    this.require('read');
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row || row.isSystem) throw AppError.notFound('Attribute', uuid);
      return toAttributeResponse(row);
    });
  }

  async create(input: CreateAttributeInput): Promise<AttributeResponse> {
    this.require('create');
    const ctx = RequestContextStore.require();
    if (RESERVED_ATTRIBUTE_KEYS.has(input.key)) {
      throw new AppError(
        ERROR_CODES.CON_ATTRIBUTE_KEY_RESERVED,
        `"${input.key}" is a built-in token. Pick another key.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'key', message: 'reserved' }],
      );
    }
    // The plan's `custom_fields` cap: a contact attribute is a non-system row of `fields`.
    return this.db.tx(async (tx) => {
      await this.planUsage.assertCanAddIn(tx, ctx.orgId, 'custom_fields');
      if (await this.repo.keyTaken(tx, ctx.orgId, input.key)) {
        throw new AppError(
          ERROR_CODES.FIELD_KEY_TAKEN,
          `Attribute key "${input.key}" is already used.`,
          HttpStatus.CONFLICT,
        );
      }
      const sectionId = await this.repo.attributeSectionId(tx, ctx.orgId);
      const created = await this.repo.insert(tx, ctx.orgId, {
        sectionId,
        key: input.key,
        label: input.name,
        fieldType: input.type,
        isActive: input.isActive,
        config: {
          ...(input.defaultValue ? { defaultValue: input.defaultValue } : {}),
          ...(input.description ? { description: input.description } : {}),
        },
        position: await this.repo.nextPosition(tx, ctx.orgId, sectionId),
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'field.created',
        payload: { uuid: created.uuid, moduleKey: 'contacts', key: input.key },
      });
      return toAttributeResponse((await this.repo.findById(tx, ctx.orgId, created.id))!);
    });
  }

  async update(uuid: string, input: UpdateAttributeInput): Promise<AttributeResponse> {
    this.require('update');
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing || existing.isSystem) throw AppError.notFound('Attribute', uuid);

      const values: Record<string, unknown> = {};
      if (input.name !== undefined) values.label = input.name;
      if (input.isActive !== undefined) values.isActive = input.isActive;
      if (input.defaultValue !== undefined || input.description !== undefined) {
        const config = { ...existing.config };
        // null or '' clears, absent keeps
        if (input.defaultValue !== undefined) {
          if (input.defaultValue) config.defaultValue = input.defaultValue;
          else delete config.defaultValue;
        }
        if (input.description !== undefined) {
          if (input.description) config.description = input.description;
          else delete config.description;
        }
        values.config = config;
      }

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('Attribute');

      const after = (await this.repo.findById(tx, ctx.orgId, existing.id))!;
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          { label: existing.label, isActive: existing.isActive, config: existing.config },
          { label: after.label, isActive: after.isActive, config: after.config },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'field.updated',
        payload: { uuid, key: existing.key },
      });
      return toAttributeResponse(after);
    });
  }

  async remove(uuid: string, query: DeleteAttributeQuery): Promise<void> {
    this.require('delete');
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing || existing.isSystem) throw AppError.notFound('Attribute', uuid);

      // The values stay on the contacts either way; the question is whether the caller knows
      // that templates and flows using {{key}} will go blank.
      const holders = await this.repo.countContactsWithValue(tx, ctx.orgId, existing.key);
      if (holders > 0 && !query.force) {
        throw new AppError(
          ERROR_CODES.CON_ATTRIBUTE_IN_USE,
          `${holders} contact(s) hold a value for "${existing.key}". Deleting the attribute keeps those values but any template using {{${existing.key}}} will render blank. Confirm to delete.`,
          HttpStatus.CONFLICT,
          [{ path: 'contacts', message: String(holders) }],
        );
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'field.deleted',
        payload: { uuid, key: existing.key },
      });
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  // --- the picker feed and the catalogue (any member who can read contacts: it is what composers use) --------

  async pickerFeed(): Promise<AttributePickerFeed> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const active = await this.repo.listActive(tx, ctx.orgId);
      return {
        system: SYSTEM_ATTRIBUTES.map((a) => ({
          key: a.key,
          name: a.name,
          description: a.description,
        })),
        custom: active.map((a) => ({
          key: a.key,
          name: a.label,
          description: typeof a.config.description === 'string' ? a.config.description : null,
          value: typeof a.config.defaultValue === 'string' ? a.config.defaultValue : null,
        })),
      };
    });
  }

  /**
   * Every token a send screen can offer, grouped, each with a sample from the newest contact.
   * One list: a key that two groups would offer appears once, in the earlier group, and every
   * key listed is one the resolver resolves.
   */
  async catalog(): Promise<AttributeCatalog> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      // one connection per transaction: awaited in turn, not in parallel
      const active = await this.repo.listActive(tx, ctx.orgId);
      const sampleRow = await this.repo.newestContact(tx, ctx.orgId);
      const dataKeys = await this.repo.discoverDataKeys(tx, ctx.orgId);
      const sample = (v: unknown): string | null => {
        if (v === null || v === undefined || v === '') return null;
        const s = String(v);
        return s.length > 60 ? `${s.slice(0, 57)}...` : s;
      };
      const data = (sampleRow?.data ?? {}) as Record<string, unknown>;

      const seen = new Set<string>();
      const take = (
        group: string,
        items: Array<{ key: string; label: string; sample: string | null }>,
      ) => {
        const out = items.filter((i) => !seen.has(i.key));
        out.forEach((i) => seen.add(i.key));
        return { group, items: out };
      };
      const phoneDigits =
        typeof sampleRow?.phone === 'string' ? sampleRow.phone.replace(/\D/g, '') : '';
      const contactItems = [
        { key: 'name', label: 'Name', sample: sample(sampleRow?.name) },
        { key: 'first_name', label: 'First name', sample: sample(sampleRow?.firstName) },
        { key: 'middle_name', label: 'Middle name', sample: sample(sampleRow?.middleName) },
        { key: 'last_name', label: 'Last name', sample: sample(sampleRow?.lastName) },
        { key: 'title', label: 'Title', sample: sample(sampleRow?.title) },
        { key: 'phone', label: 'Phone', sample: sample(phoneDigits) },
        { key: 'country_code', label: 'Country code', sample: sample(sampleRow?.countryCode) },
        { key: 'email', label: 'Email', sample: sample(sampleRow?.email) },
        { key: 'address', label: 'Address', sample: sample(sampleRow?.address) },
        { key: 'language', label: 'Language', sample: sample(sampleRow?.language) },
        { key: 'groups', label: 'Groups', sample: sample(sampleRow?.groups) },
      ];
      const registered = new Set(active.map((a) => a.key));
      // The contact's company (BL-196): its columns and the workspace's company properties, for someone who may read companies.
      const canCompanies = ctx.grants
        ? this.rbac.can(ctx.grants, 'record.companies.read').allowed
        : false;
      const companyItems = canCompanies
        ? [
            { key: 'company', label: 'Company name', sample: null },
            { key: 'company.industry', label: 'Company industry', sample: null },
            { key: 'company.website', label: 'Company website', sample: null },
            { key: 'company.email', label: 'Company email', sample: null },
            { key: 'company.phone', label: 'Company phone', sample: null },
            { key: 'company.size', label: 'Company size', sample: null },
            { key: 'company.address', label: 'Company address', sample: null },
            ...(await this.repo.listCompanyProperties(tx, ctx.orgId)).map((p) => ({
              key: `company.${p.key}`,
              label: p.label,
              sample: null,
            })),
          ]
        : [];
      const groups = [
        take('contact', contactItems),
        take(
          'custom_field',
          dataKeys
            .filter((k) => !registered.has(k.toLowerCase()))
            .map((k) => ({
              key: k,
              label: k.replace(/[_.-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
              sample: sample(data[k]),
            })),
        ),
        take(
          'workspace',
          active.map((a) => ({
            key: a.key,
            label: a.label,
            sample: sample(a.config.defaultValue),
          })),
        ),
        take('company', companyItems),
        take('system', [
          { key: 'today', label: 'Today', sample: new Date().toISOString().slice(0, 10) },
          { key: 'business_name', label: 'Business name', sample: null },
          { key: 'company_name', label: 'Company name', sample: null },
        ]),
      ];
      return { groups: groups as AttributeCatalog['groups'] };
    });
  }

  // --- merge-tag preview ---------------------------------------------------------------------

  async resolvePreview(input: ResolveMergeTagInput): Promise<ResolveMergeTagResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let contact: MergeContact | undefined;
      if (input.contactId) {
        const ref = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, input.contactId);
        if (!ref) throw AppError.notFound('Contact', input.contactId);
        const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
        await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, ref);
        const columns = await this.repo.contactForMerge(tx, ctx.orgId, ref.id);
        const chips = await this.contactsRepo.groupChips(tx, ctx.orgId, [ref.id]);
        contact = { ...columns!, groups: chips.map((c) => c.name) };
      }
      const active = await this.repo.listActive(tx, ctx.orgId);
      const orgName = await this.repo.orgName(tx, ctx.orgId);
      return renderMergeTags(input.template, {
        contact,
        attributeDefaults: new Map(
          active.map((a) => [
            a.key,
            typeof a.config.defaultValue === 'string' ? a.config.defaultValue : null,
          ]),
        ),
        system: {
          today: new Date().toISOString().slice(0, 10),
          businessName: orgName,
          companyName: orgName,
        },
      });
    });
  }
}
