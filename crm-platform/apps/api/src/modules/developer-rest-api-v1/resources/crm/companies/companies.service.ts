import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  listCompaniesQuerySchema,
  updateCompanySchema,
  v1UpdateCompanySchema,
  type V1Company,
  type V1CompaniesQuery,
  type V1CreateCompany,
} from '@crm/contracts';
import { AppError } from '../../../../../common/errors/app-error';
import { ZodValidationPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { CompaniesService } from '../../../../crm';
import { has, isUuid, uuidOrNotFound } from '../v1-ids';
import { toV1Company } from './companies.mapper';

const UPDATE_ATTEMPTS = 2;

/** The staff service camelCase `details` paths, as the public field names. */
const WIRE_FIELD: Record<string, string> = {
  ownerId: 'owner_user_id',
  sizeRange: 'size_range',
  customFields: 'custom_fields',
};

const invalidOwner = () =>
  AppError.validation('The given data was invalid.', [
    { path: 'owner_user_id', message: 'The selected owner_user_id is invalid.' },
  ]);

/** A failure of the delegated service with its `details` paths worded as the public fields. */
function toV1CompanyError(err: unknown): unknown {
  if (!(err instanceof AppError)) return err;
  if (err.code === ERROR_CODES.COMPANY_OWNER_INVALID) return invalidOwner();
  if (!err.details) return err;
  const details = err.details.map((d) => ({
    path: d.path.replace(/^(ownerId|sizeRange|customFields)/, (m) => WIRE_FIELD[m] ?? m),
    message: d.message,
  }));
  return new AppError(err.code, err.message, err.getStatus(), details);
}

/** An owner reference of the body: a blank one means nobody, a uuid is checked by the service, anything else is refused. */
function ownerRef(ref: string | null | undefined): string | null {
  if (ref === null || ref === undefined || ref === '' || ref === '0') return null;
  if (!isUuid(ref)) throw invalidOwner();
  return ref.toLowerCase();
}

/**
 * Companies of the customer API (BL-196; an extension, Reference has no companies in its API). `CompaniesService` does the work with
 * the key's grants (`companies:read` / `companies:write`) at record scope `all`, so the audit rows, the outbox events, the typed
 * company properties and the required-property rules are exactly the dashboard's. A create that leaves `owner_user_id` out is owned by
 * the key's member; a blank one means nobody.
 */
@Injectable()
export class V1CompaniesService {
  constructor(private readonly companies: CompaniesService) {}

  async list(paging: { limit: number; cursor?: string }, filter: V1CompaniesQuery) {
    const empty = {
      data: [] as V1Company[],
      page: { nextCursor: null, hasMore: false, limit: paging.limit },
    };
    // A value that matches nothing is an empty list, not an error (as for deals).
    if (filter.owner_user_id && !isUuid(filter.owner_user_id)) return empty;
    const query = listCompaniesQuerySchema.parse({
      limit: paging.limit,
      cursor: paging.cursor,
      q: filter.search || undefined,
      industry: filter.industry || undefined,
      ownerId: filter.owner_user_id || undefined,
    });
    const res = await this.companies.list(query, 'all');
    return { data: res.data.map(toV1Company), page: res.page };
  }

  async show(id: string): Promise<V1Company> {
    return toV1Company(await this.companies.get(uuidOrNotFound(id, 'Company'), 'all'));
  }

  async create(body: V1CreateCompany): Promise<V1Company> {
    try {
      const created = await this.companies.create({
        name: body.name,
        website: body.website,
        email: body.email,
        phone: body.phone,
        industry: body.industry,
        sizeRange: body.size_range,
        address: body.address,
        notes: body.notes,
        customFields: (body.custom_fields ?? undefined) as never,
        // Omitted means the key's member; a blank one means nobody.
        ...(body.owner_user_id === undefined ? {} : { ownerId: ownerRef(body.owner_user_id) }),
      });
      return toV1Company(created);
    } catch (err) {
      throw toV1CompanyError(err);
    }
  }

  async update(id: string, raw: unknown): Promise<V1Company> {
    const uuid = uuidOrNotFound(id, 'Company');
    // Lookup first, validation second: an unknown id with a bad body is a 404 (as for deals).
    await this.companies.get(uuid, 'all');
    const body = new ZodValidationPipe(v1UpdateCompanySchema).transform(raw ?? {});
    try {
      for (let attempt = 1; ; attempt += 1) {
        const current = await this.companies.get(uuid, 'all');
        const patch: Record<string, unknown> = { rowVersion: current.rowVersion };
        if (has(raw, 'name') && body.name !== undefined) patch.name = body.name;
        if (has(raw, 'website')) patch.website = body.website ?? null;
        if (has(raw, 'email')) patch.email = body.email ?? null;
        if (has(raw, 'phone')) patch.phone = body.phone ?? null;
        if (has(raw, 'industry')) patch.industry = body.industry ?? null;
        if (has(raw, 'size_range')) patch.sizeRange = body.size_range ?? null;
        if (has(raw, 'address')) patch.address = body.address ?? null;
        if (has(raw, 'notes')) patch.notes = body.notes ?? null;
        if (has(raw, 'owner_user_id')) patch.ownerId = ownerRef(body.owner_user_id);
        if (has(raw, 'custom_fields') && body.custom_fields)
          patch.customFields = body.custom_fields;
        try {
          return toV1Company(
            await this.companies.update(uuid, updateCompanySchema.parse(patch), 'all'),
          );
        } catch (err) {
          if (
            attempt < UPDATE_ATTEMPTS &&
            err instanceof AppError &&
            err.code === ERROR_CODES.ROW_VERSION_CONFLICT
          )
            continue;
          throw err;
        }
      }
    } catch (err) {
      throw toV1CompanyError(err);
    }
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const uuid = uuidOrNotFound(id, 'Company');
    await this.companies.remove(uuid, 'all');
    return { id: uuid, deleted: true };
  }
}
