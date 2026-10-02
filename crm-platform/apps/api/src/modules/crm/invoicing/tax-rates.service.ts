import { HttpStatus, Injectable } from '@nestjs/common';
import { formatRate, getTaxProfile, parseRate, taxPresetsForCountry } from '@crm/tax';
import {
  ERROR_CODES,
  TAX_TYPES,
  type ApplyTaxPresetsInput,
  type ApplyTaxPresetsResponse,
  type CreateTaxRateInput,
  type ListTaxPresetsQuery,
  type ListTaxRatesQuery,
  type TaxPresetsResponse,
  type TaxRateResponse,
  type TaxRatesResponse,
  type TaxType,
  type UpdateTaxRateInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import { trimPercent } from './invoice-content';
import { InvoicesRepository } from './invoices.repository';
import { TaxRatesRepository, type TaxRateRow } from './tax-rates.repository';

export const TAX_RATE_MODULE = 'tax-rates';

export function toTaxRateResponse(r: TaxRateRow): TaxRateResponse {
  return {
    id: r.uuid,
    name: r.name,
    type: r.taxType,
    rate: r.ratePercent,
    inclusive: r.inclusive,
    isDefault: r.isDefault,
    isActive: r.isActive,
    description: r.description,
    country: r.country,
    region: r.region,
    components: r.components ? r.components.map((c) => ({ type: c.type, rate: c.ratePercent })) : null,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    defaultHsnSac: r.defaultHsnSac,
    usedBy: r.usedBy,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const bad = (message: string, path: string): AppError =>
  new AppError(ERROR_CODES.TAX_RATE_INVALID, message, HttpStatus.UNPROCESSABLE_ENTITY, [{ path, message }]);

/** The percentage exactly (up to 4 decimals, 0 to 100), and the components of a compound rate (their sum must be the rate). */
function parsePercent(
  rate: string,
  components: Array<{ type: string; rate: string }> | null | undefined,
): { ratePercent: string; components: Array<{ type: string; ratePercent: string }> | null | undefined } {
  const ppm = parseRate(rate);
  if (ppm === null || ppm < 0n || ppm > 1_000_000n) throw bad('a rate is between 0 and 100 with at most 4 decimals', 'rate');
  const ratePercent = formatRate(ppm);
  if (components === undefined) return { ratePercent, components: undefined };
  if (components === null) return { ratePercent, components: null };
  let sum = 0n;
  const parsed = components.map((c, i) => {
    const p = parseRate(c.rate);
    if (p === null || p < 0n || p > 1_000_000n) throw bad('a component rate is between 0 and 100', `components.${i}.rate`);
    sum += p;
    return { type: c.type.toUpperCase(), ratePercent: formatRate(p) };
  });
  if (sum !== ppm) throw bad('the components must add up to the rate', 'components');
  return { ratePercent, components: parsed };
}

const asTaxType = (t: string): TaxType => ((TAX_TYPES as readonly string[]).includes(t) ? (t as TaxType) : 'other');

/**
 * Tax rates (WD-INV "tax rates": absent in WaDesk). One transaction per write: the lock, the change, the audit row and the outbox
 * event commit together. A line snapshots the rate it was priced with, so nothing here ever changes an invoice that was written.
 * Country presets (docs/tax-engine.md) are applied through the same `create` rules.
 */
@Injectable()
export class TaxRatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaxRatesRepository,
    private readonly invoices: InvoicesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListTaxRatesQuery): Promise<TaxRatesResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const today = query.active ? await this.today(tx, ctx.orgId) : undefined;
      const rows = await this.repo.list(tx, ctx.orgId, { pickableOn: today, country: query.country });
      return { data: rows.map(toTaxRateResponse) };
    });
  }

  async get(uuid: string): Promise<TaxRateResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Tax rate', uuid);
      return toTaxRateResponse(row);
    });
  }

  async create(input: CreateTaxRateInput): Promise<TaxRateResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => toTaxRateResponse(await this.createIn(tx, ctx.orgId, ctx.userId, input)));
  }

  private async createIn(tx: Tx, orgId: number, userId: number | null, input: CreateTaxRateInput): Promise<TaxRateRow> {
    const { ratePercent, components } = parsePercent(input.rate, input.components);
    const isActive = input.isActive ?? true;
    const isDefault = input.isDefault ?? false;
    if (isDefault && !isActive) throw bad('a default rate must be active', 'isDefault');
    this.assertWindow(input.effectiveFrom, input.effectiveTo);
    if (await this.repo.nameTaken(tx, orgId, input.name)) throw this.nameTaken(input.name);
    if (isDefault) await this.repo.clearDefault(tx, orgId);
    const id = await this.repo.insert(tx, orgId, userId, {
      name: input.name,
      taxType: input.type ?? 'other',
      ratePercent,
      inclusive: input.inclusive ?? false,
      isActive,
      isDefault,
      description: input.description ?? null,
      country: input.country ?? null,
      region: input.region ?? null,
      components: components ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      defaultHsnSac: input.defaultHsnSac ?? null,
    });
    const row = (await this.repo.findById(tx, orgId, id))!;
    await this.audit.record(tx, {
      module: TAX_RATE_MODULE,
      recordId: id,
      action: 'insert',
      delta: {
        name: { old: null, new: row.name },
        rate: { old: null, new: row.ratePercent },
        inclusive: { old: null, new: row.inclusive },
        isDefault: { old: null, new: row.isDefault },
      },
    });
    await this.emit(tx, 'tax_rate.created', row);
    return row;
  }

  async update(uuid: string, input: UpdateTaxRateInput): Promise<TaxRateResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Tax rate', uuid);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Tax rate');

      const patch: Parameters<TaxRatesRepository['update']>[4] = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.name !== undefined && input.name !== row.name) {
        if (await this.repo.nameTaken(tx, ctx.orgId, input.name, row.id)) throw this.nameTaken(input.name);
        patch.name = input.name;
        delta.name = { old: row.name, new: input.name };
      }
      if (input.type !== undefined && input.type !== row.taxType) {
        patch.taxType = input.type;
        delta.type = { old: row.taxType, new: input.type };
      }
      if (input.rate !== undefined || input.components !== undefined) {
        const { ratePercent, components } = parsePercent(
          input.rate ?? row.ratePercent,
          input.components === undefined
            ? row.components?.map((c) => ({ type: c.type, rate: c.ratePercent }))
            : input.components,
        );
        if (ratePercent !== row.ratePercent) {
          patch.ratePercent = ratePercent;
          delta.rate = { old: row.ratePercent, new: ratePercent };
        }
        if (components !== undefined) patch.components = components;
      }
      if (input.inclusive !== undefined && input.inclusive !== row.inclusive) {
        patch.inclusive = input.inclusive;
        delta.inclusive = { old: row.inclusive, new: input.inclusive };
      }
      if (input.isActive !== undefined && input.isActive !== row.isActive) {
        patch.isActive = input.isActive;
        delta.isActive = { old: row.isActive, new: input.isActive };
        // A default that is switched off would silently tax nothing: it stops being the default.
        if (!input.isActive && row.isDefault) {
          patch.isDefault = false;
          delta.isDefault = { old: true, new: false };
        }
      }
      for (const k of ['description', 'country', 'region', 'effectiveFrom', 'effectiveTo', 'defaultHsnSac'] as const) {
        if (input[k] !== undefined && (input[k] ?? null) !== row[k]) {
          patch[k] = input[k] ?? null;
          delta[k] = { old: row[k], new: input[k] ?? null };
        }
      }
      this.assertWindow(
        patch.effectiveFrom !== undefined ? patch.effectiveFrom : row.effectiveFrom,
        patch.effectiveTo !== undefined ? patch.effectiveTo : row.effectiveTo,
      );
      if (Object.keys(patch).length > 0) {
        const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
        if (!ok) throw AppError.rowVersionConflict('Tax rate');
        await this.audit.record(tx, { module: TAX_RATE_MODULE, recordId: row.id, action: 'update', delta });
        await this.emit(tx, 'tax_rate.updated', (await this.repo.findById(tx, ctx.orgId, row.id))!);
      }
      return toTaxRateResponse((await this.repo.findById(tx, ctx.orgId, row.id))!);
    });
  }

  /** Makes a rate the workspace default; the previous default stops being one. Idempotent. */
  async setDefault(uuid: string): Promise<TaxRateResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Tax rate', uuid);
      if (!row.isActive) throw bad('a default rate must be active', 'isDefault');
      if (!row.isDefault) {
        await this.repo.clearDefault(tx, ctx.orgId);
        await this.repo.update(tx, ctx.orgId, row.id, row.rowVersion, { isDefault: true });
        await this.audit.record(tx, {
          module: TAX_RATE_MODULE,
          recordId: row.id,
          action: 'update',
          delta: { isDefault: { old: false, new: true } },
        });
        await this.emit(tx, 'tax_rate.updated', (await this.repo.findById(tx, ctx.orgId, row.id))!);
      }
      return toTaxRateResponse((await this.repo.findById(tx, ctx.orgId, row.id))!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Tax rate', uuid);
      await this.audit.record(tx, {
        module: TAX_RATE_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { name: { old: row.name, new: null }, rate: { old: row.ratePercent, new: null } },
      });
      await this.emit(tx, 'tax_rate.deleted', row);
      await this.repo.delete(tx, ctx.orgId, row.id);
    });
  }

  // --- country presets ---------------------------------------------------------------------------------------------------------

  /** The country's tax rows as the engine knows them, marked with the ones the workspace already has. */
  async presets(query: ListTaxPresetsQuery): Promise<TaxPresetsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const profile = getTaxProfile(query.country);
      if (!profile) throw bad(`There is no tax preset for ${query.country}; add rates by hand`, 'country');
      const asOf = query.asOf ?? (await this.today(tx, ctx.orgId));
      const existing = new Set((await this.repo.list(tx, ctx.orgId, {})).map((r) => r.name.toLowerCase()));
      const rows = this.presetRows(profile.code, asOf);
      return {
        country: profile.code,
        countryName: profile.name,
        asOf,
        data: rows.map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          rate: r.rate,
          inclusive: r.inclusive,
          isDefault: r.isDefault,
          region: r.region,
          description: r.description,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          components: r.components,
          exists: existing.has(r.name.toLowerCase()),
        })),
        notes: [...profile.notes],
        disclaimer:
          'Rates, thresholds and rules are defaults compiled from public sources; they change. They are not legal, tax or accounting advice: check them with your accountant or tax authority before relying on them.',
      };
    });
  }

  /** Creates ordinary tax rates from a preset; names that already exist are skipped, so applying twice adds nothing. */
  async applyPresets(input: ApplyTaxPresetsInput): Promise<ApplyTaxPresetsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const profile = getTaxProfile(input.country);
      if (!profile) throw bad(`There is no tax preset for ${input.country}`, 'country');
      const asOf = input.asOf ?? (await this.today(tx, ctx.orgId));
      let rows = this.presetRows(profile.code, asOf);
      if (input.codes?.length) {
        const wanted = new Set(input.codes);
        const unknown = input.codes.filter((c) => !rows.some((r) => r.code === c));
        if (unknown.length) throw bad(`Unknown preset rows: ${unknown.join(', ')}`, 'codes');
        rows = rows.filter((r) => wanted.has(r.code));
      }
      const hasDefault = !!(await this.repo.findDefault(tx, ctx.orgId));
      const created: TaxRateResponse[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      let defaultTaken = hasDefault;
      for (const r of rows) {
        if (await this.repo.nameTaken(tx, ctx.orgId, r.name)) {
          skipped.push({ name: r.name, reason: 'a rate with this name exists' });
          continue;
        }
        const makeDefault = input.setDefault && r.isDefault && !defaultTaken;
        const row = await this.createIn(tx, ctx.orgId, ctx.userId, {
          name: r.name,
          type: r.type,
          rate: r.rate,
          inclusive: r.inclusive,
          isDefault: makeDefault,
          description: r.description,
          country: profile.code.length === 2 ? profile.code : null,
          region: r.region,
          components: r.components,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
        });
        if (makeDefault) defaultTaken = true;
        created.push(toTaxRateResponse(row));
      }
      return { created, skipped };
    });
  }

  /** The engine's rows for a country on a date, mapped to what a tax rate needs. India's combined slab yields an intra-state and an IGST row. */
  private presetRows(country: string, asOf: string) {
    const out: Array<{
      code: string;
      name: string;
      type: TaxType;
      rate: string;
      inclusive: boolean;
      isDefault: boolean;
      region: string | null;
      description: string | null;
      effectiveFrom: string;
      effectiveTo: string | null;
      components: Array<{ type: string; rate: string }> | null;
    }> = [];
    for (const p of taxPresetsForCountry(country, { asOf })) {
      const common = {
        inclusive: p.inclusive,
        isDefault: p.isDefault,
        region: p.region,
        description: p.description,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
      };
      if (p.components) {
        out.push({
          ...common,
          code: p.code,
          name: `${p.name} (CGST + SGST)`.slice(0, 60),
          type: 'gst',
          rate: trimPercent(p.ratePercent),
          components: p.components.intra.map((c) => ({ type: c.code, rate: trimPercent(c.ratePercent) })),
        });
        out.push({
          ...common,
          isDefault: false,
          code: `${p.code}_INTER`,
          name: `${p.name} (IGST)`.slice(0, 60),
          type: 'igst',
          rate: trimPercent(p.ratePercent),
          components: null,
        });
      } else {
        out.push({ ...common, code: p.code, name: p.name, type: asTaxType(p.type), rate: trimPercent(p.ratePercent), components: null });
      }
    }
    return out;
  }

  private emit(tx: Tx, eventType: string, row: TaxRateRow): Promise<void> {
    return this.outbox.emit(tx, {
      aggregateModule: TAX_RATE_MODULE,
      aggregateId: row.id,
      eventType,
      payload: {
        uuid: row.uuid,
        name: row.name,
        rate: row.ratePercent,
        type: row.taxType,
        inclusive: row.inclusive,
        isDefault: row.isDefault,
        isActive: row.isActive,
      },
    });
  }

  private assertWindow(from: string | null | undefined, to: string | null | undefined): void {
    if (from && to && to < from) throw bad('the effective-to date is before the effective-from date', 'effectiveTo');
  }

  private nameTaken(name: string): AppError {
    return new AppError(ERROR_CODES.TAX_RATE_NAME_TAKEN, `A tax rate named "${name}" already exists`, HttpStatus.CONFLICT, [
      { path: 'name', message: 'taken' },
    ]);
  }

  private async today(tx: Tx, orgId: number): Promise<string> {
    const o = await this.invoices.orgSettings(tx, orgId);
    return todayIn(resolveTimezone(o.timezone));
  }
}
