import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateSalesItemInput,
  type ListSalesItemsQuery,
  type ListSalesItemsResponse,
  type SalesItem,
  type UpdateSalesItemInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { toSalesItem } from './products-services.mapper';
import {
  ProductsServicesRepository,
  type SalesItemRow,
  type SalesItemValues,
} from './products-services.repository';

const MODULE_KEY = 'sales_items';

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** The values a create writes: what was not given takes its default. */
export function valuesOfCreate(input: CreateSalesItemInput): SalesItemValues {
  return {
    kind: input.kind,
    name: input.name,
    sku: input.sku ?? null,
    description: input.description ?? null,
    unit: input.unit ?? null,
    unitPriceMinor: input.unitPriceMinor,
    currency: input.currency,
    taxRatePercent: input.taxRatePercent ?? null,
    isActive: input.isActive,
  };
}

/** The values an update writes: a field that was not sent keeps the stored value, and one sent as null / empty clears it. */
export function valuesOfUpdate(row: SalesItemRow, input: UpdateSalesItemInput): SalesItemValues {
  return {
    kind: input.kind ?? row.kind,
    name: input.name ?? row.name,
    sku: input.sku === undefined ? row.sku : input.sku,
    description: input.description === undefined ? row.description : input.description,
    unit: input.unit === undefined ? row.unit : input.unit,
    unitPriceMinor: input.unitPriceMinor ?? row.unitPriceMinor,
    currency: input.currency ?? row.currency,
    taxRatePercent: input.taxRatePercent === undefined ? row.taxRatePercent : input.taxRatePercent,
    isActive: input.isActive ?? row.isActive,
  };
}

/**
 * The price list of the Products and services add-on (docs/specs/crm-deal-estimate-invoice-products.md 5). Every route is behind the plan
 * feature `products_services` (see the controller), so a workspace without the app never reaches this. Writes record an audit row in the
 * same transaction.
 */
@Injectable()
export class ProductsServicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ProductsServicesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListSalesItemsQuery): Promise<ListSalesItemsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const [rows, total, counts] = await Promise.all([
        this.repo.list(tx, ctx.orgId, query),
        this.repo.count(tx, ctx.orgId, query),
        this.repo.counts(tx, ctx.orgId),
      ]);
      return { data: rows.map(toSalesItem), total, page: query.page, limit: query.limit, counts };
    });
  }

  async get(uuid: string): Promise<SalesItem> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Product or service', uuid);
      return toSalesItem(row);
    });
  }

  async create(input: CreateSalesItemInput): Promise<SalesItem> {
    const ctx = RequestContextStore.require();
    try {
      return await this.db.tx(async (tx) => {
        const row = await this.repo.insert(
          tx,
          ctx.orgId,
          ctx.userId ?? null,
          valuesOfCreate(input),
        );
        await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'insert' });
        return toSalesItem(row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.skuTaken(input.sku ?? '');
      throw err;
    }
  }

  async update(uuid: string, input: UpdateSalesItemInput): Promise<SalesItem> {
    const ctx = RequestContextStore.require();
    try {
      return await this.db.tx(async (tx) => {
        const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
        if (!existing) throw AppError.notFound('Product or service', uuid);
        const saved = await this.repo.update(
          tx,
          ctx.orgId,
          existing.id,
          input.rowVersion,
          valuesOfUpdate(existing, input),
        );
        if (!saved) throw AppError.rowVersionConflict('Product or service');
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: existing.id,
          action: 'update',
        });
        return toSalesItem(saved);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.skuTaken(input.sku ?? '');
      throw err;
    }
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Product or service', uuid);
      await this.repo.remove(tx, ctx.orgId, existing.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
    });
  }

  private skuTaken(sku: string): AppError {
    return new AppError(
      ERROR_CODES.PRD_SKU_TAKEN,
      `Another product or service already has the SKU "${sku}".`,
      HttpStatus.CONFLICT,
      [{ path: 'sku', message: 'Another item already has this SKU' }],
    );
  }
}
