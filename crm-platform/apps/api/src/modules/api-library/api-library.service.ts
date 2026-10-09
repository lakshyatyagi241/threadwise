import { HttpStatus, Injectable } from '@nestjs/common';
import {
  API_LIBRARY_SECRET_MASK,
  ERROR_CODES,
  apiLibraryDefinitionTokens,
  apiLibraryIsSensitiveName,
  type ApiLibraryContactPropertiesResponse,
  type ApiLibraryDetail,
  type ApiLibraryOptionsResponse,
  type ApiLibraryUsageResponse,
  type CreateApiLibraryApiInput,
  type ListApiLibraryApisQuery,
  type ListApiLibraryApisResponse,
  type UpdateApiLibraryApiInput,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AttributesService } from '../crm';
import { numberedPage, toDetail, toItem, toOption } from './api-library.mapper';
import { maskUrl, sameOrigin, urlWithDefaults } from './api-library.rules';
import {
  ApiLibraryRepository,
  type ApiRow,
  type NewApi,
  type StoredApiHeader,
} from './api-library.repository';

const MODULE_KEY = 'api_library';
/** A workspace's saved APIs. Not a plan limit (no plan feature fits): a guard against a runaway client. */
export const MAX_APIS = 200;

/** The contact's own text fields a flow can write (the rule of ContactsService.setFieldFromFlow), with the words the picker shows. */
export const WRITABLE_CONTACT_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'title', label: 'Title' },
  { key: 'language', label: 'Language' },
  { key: 'address', label: 'Address' },
];

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * The saved APIs of a workspace. The value of a secret header is encrypted before it is stored and decrypted only to send; no read
 * ever returns it (detail and list show the mask, and an update that sends the mask back keeps the stored value). Every write records an
 * audit row and an outbox event in the same transaction. The name is permanent: flows read the answer as `{{Name.field}}`.
 */
@Injectable()
export class ApiLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ApiLibraryRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly attributes: AttributesService,
  ) {}

  async list(query: ListApiLibraryApisQuery): Promise<ListApiLibraryApisResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const filter = { search: query.search || undefined, method: query.method };
      if (query.page !== undefined) {
        const rows = await this.repo.list(tx, ctx.orgId, {
          ...filter,
          offset: (query.page - 1) * query.limit,
          limit: query.limit,
          order: query.order,
        });
        const total = await this.repo.countMatching(tx, ctx.orgId, filter);
        return numberedPage(rows.map(toItem), total, query.page, query.limit);
      }
      const rows = await this.repo.list(tx, ctx.orgId, {
        ...filter,
        cursor: query.cursor,
        limit: query.limit,
        order: query.order,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toItem), page };
    });
  }

  async get(uuid: string): Promise<ApiLibraryDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('API', uuid);
      return toDetail(row);
    });
  }

  /** The pickers' feed: name, method, variables and exposed response fields of every API. */
  async options(): Promise<ApiLibraryOptionsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({ data: (await this.repo.all(tx, ctx.orgId)).map(toOption) }));
  }

  async create(input: CreateApiLibraryApiInput): Promise<ApiLibraryDetail> {
    const ctx = RequestContextStore.require();
    const def = this.prepare(input, undefined);
    try {
      return await this.db.tx(async (tx) => {
        await this.repo.lockForCreate(tx, ctx.orgId);
        if ((await this.repo.count(tx, ctx.orgId)) >= MAX_APIS) {
          throw new AppError(
            ERROR_CODES.ALIB_LIMIT_REACHED,
            `A workspace can keep ${MAX_APIS} saved APIs. Delete one you no longer use.`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (await this.repo.nameTaken(tx, ctx.orgId, input.name)) throw this.nameTaken(input.name);
        const row = await this.repo.insert(tx, ctx.orgId, {
          ...def,
          name: input.name,
          createdBy: ctx.userId,
        });
        await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'insert' });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: row.id,
          eventType: 'api_library.created',
          payload: { uuid: row.uuid, name: row.name, method: row.method },
        });
        return toDetail(row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.nameTaken(input.name);
      throw err;
    }
  }

  async update(uuid: string, input: UpdateApiLibraryApiInput): Promise<ApiLibraryDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('API', uuid);
      const def = this.prepare(input, existing);
      const ok = await this.repo.update(tx, ctx.orgId, existing.id, input.rowVersion, def);
      if (!ok) throw AppError.rowVersionConflict('API');
      const row = (await this.repo.findByUuid(tx, ctx.orgId, uuid))!;
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: diff(existing, row),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'api_library.updated',
        payload: { uuid: row.uuid, name: row.name },
      });
      return toDetail(row);
    });
  }

  /** Flows that call the API. */
  async usage(uuid: string): Promise<ApiLibraryUsageResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('API', uuid);
      return { data: await this.usageOf(tx, ctx.orgId, row.uuid) };
    });
  }

  /**
   * Deletes the API. While a flow still calls it the answer is 409 ALIB_IN_USE with the flows in `details` (path = flow id, message =
   * flow name); `force` deletes anyway (the node then leaves by its `error` port and logs that the API is gone). The runs it logged stay.
   */
  async remove(uuid: string, force: boolean): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('API', uuid);
      if (!force) {
        const used = await this.usageOf(tx, ctx.orgId, row.uuid);
        if (used.length > 0) {
          throw new AppError(
            ERROR_CODES.ALIB_IN_USE,
            `"${row.name}" is used by ${used.length} flow${used.length === 1 ? '' : 's'}. Remove it from them first, or delete it anyway.`,
            HttpStatus.CONFLICT,
            used.map((u) => ({ path: u.id, message: u.name })),
          );
        }
      }
      await this.repo.remove(tx, ctx.orgId, row.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'api_library.deleted',
        payload: { uuid: row.uuid, name: row.name },
      });
    });
  }

  /**
   * The contact properties a response field can be saved into: the contact's own text fields and the workspace's ACTIVE custom
   * properties (the CRM attributes domain's picker feed), which is exactly what a flow is allowed to write.
   */
  async contactProperties(): Promise<ApiLibraryContactPropertiesResponse> {
    const feed = await this.attributes.pickerFeed();
    const taken = new Set(WRITABLE_CONTACT_FIELDS.map((f) => f.key));
    return {
      data: [
        ...WRITABLE_CONTACT_FIELDS.map((f) => ({ ...f, kind: 'system' as const })),
        ...feed.custom
          .filter((c) => !taken.has(c.key))
          .map((c) => ({ key: c.key, label: c.name, kind: 'custom' as const })),
      ],
    };
  }

  // --- internals ---------------------------------------------------------------------------------------------------------------------

  private async usageOf(
    tx: Parameters<ApiLibraryRepository['flowsUsing']>[0],
    orgId: number,
    uuid: string,
  ) {
    return (await this.repo.flowsUsing(tx, orgId, uuid)).map((u) => ({
      kind: 'flow' as const,
      id: u.uuid,
      name: u.name,
      published: u.published,
      nodeCount: u.nodeCount,
    }));
  }

  private nameTaken(name: string): AppError {
    return new AppError(
      ERROR_CODES.ALIB_NAME_TAKEN,
      `An API named "${name}" already exists.`,
      HttpStatus.CONFLICT,
      [{ path: 'name', message: 'Another API already has this name' }],
    );
  }

  /**
   * The row to store for a validated definition: variables the definition no longer uses are dropped, a header that reads like a
   * secret is a secret, and the value of a secret header is sealed (or, when the form sent the mask back, the stored value is kept).
   */
  private prepare(
    input: CreateApiLibraryApiInput | UpdateApiLibraryApiInput,
    existing: ApiRow | undefined,
  ): Omit<NewApi, 'name' | 'createdBy'> {
    const used = new Set(apiLibraryDefinitionTokens(input).map((t) => t.toLowerCase()));
    // A kept secret stays with the address it was saved for: pointing the API at another host means typing the secret again, so an
    // editor cannot aim a token they cannot read at a server of their own.
    const sameTarget =
      existing !== undefined &&
      sameOrigin(
        urlWithDefaults(input.url, input.variables),
        urlWithDefaults(existing.url, existing.variables),
      );
    const headers: StoredApiHeader[] = input.headers.map((h, i) => {
      const secret = h.secret || apiLibraryIsSensitiveName(h.key);
      if (h.value === API_LIBRARY_SECRET_MASK) {
        const kept = sameTarget
          ? existing?.headers.find((x) => x.secret && x.key.toLowerCase() === h.key.toLowerCase())
          : undefined;
        if (!kept) {
          throw AppError.validation('Enter the value of the header again', [
            {
              path: `headers.${i}.value`,
              message: `Enter the value of "${h.key}" again (a kept secret stays with the address it was saved for)`,
            },
          ]);
        }
        return { key: h.key, value: kept.value, secret: true };
      }
      return { key: h.key, value: secret ? this.crypto.encrypt(h.value) : h.value, secret };
    });
    return {
      method: input.method,
      url: input.url,
      payloadType: input.payloadType,
      variables: input.variables
        .filter((v) => used.has(v.name.toLowerCase()))
        .map((v) => ({ name: v.name, source: v.source, defaultValue: v.defaultValue })),
      headers,
      body: input.body,
      functionCode: input.functionCode?.trim() ? input.functionCode : null,
      mappingConfig: input.mapping,
      responseVariables: [...new Set(input.responseVariables)],
    };
  }
}

/** Only the fields that changed, and never a secret: a header change says "changed", not what it was. */
function diff(before: ApiRow, after: ApiRow): Record<string, { old: unknown; new: unknown }> {
  const delta: Record<string, { old: unknown; new: unknown }> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (before.method !== after.method) delta.method = { old: before.method, new: after.method };
  if (before.url !== after.url) delta.url = { old: maskUrl(before.url), new: maskUrl(after.url) };
  if (before.payloadType !== after.payloadType)
    delta.payloadType = { old: before.payloadType, new: after.payloadType };
  if (!same(before.variables, after.variables))
    delta.variables = { old: 'changed', new: 'changed' };
  if (!same(before.headers, after.headers)) delta.headers = { old: 'changed', new: 'changed' };
  if (!same(before.body, after.body)) delta.body = { old: 'changed', new: 'changed' };
  if (before.functionCode !== after.functionCode)
    delta.functionCode = { old: 'changed', new: 'changed' };
  if (!same(before.mappingConfig, after.mappingConfig))
    delta.mapping = { old: 'changed', new: 'changed' };
  if (!same(before.responseVariables, after.responseVariables))
    delta.responseVariables = { old: before.responseVariables, new: after.responseVariables };
  return delta;
}
