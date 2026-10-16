import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  COMPANY_EXPORT_MAX,
  COMPANY_IMPORT_ROWS_MAX,
  ERROR_CODES,
  createCompanySchema,
  type CompanyImportResult,
  type ExportCompaniesQuery,
  type ImportCompaniesInput,
  type RecordScope,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { csvLine, guardFormula, UTF8_BOM } from '../contact-bulk/csv-writer';
import { parseCsv } from '../contact-import/csv-parser';
import { CompaniesService, COMPANY_MODULE } from './companies.service';
import { companyEventPayload } from './companies.mapper';
import { CompaniesRepository, companyScopeCondition } from './companies.repository';
import {
  cellToPropertyValue,
  exportColumns,
  mapHeaders,
  propertyToCell,
} from './company-csv-rules';
import { mergeProperties } from './company-properties';
import { hostLabel, normaliseCompanyDomain } from './company-rules';

/**
 * Companies as a spreadsheet (BL-196). Reference had neither: a file in, a file out, with the workspace's own company properties as
 * columns. The export holds what the list shows (same filters, same record scope); the import goes through the same write rules as
 * the form (limits, required properties, typed values, an owner who is an active member), one savepoint per row, so a bad row is
 * reported with its line and the rest are kept.
 */
@Injectable()
export class CompaniesCsvService {
  private readonly logger = new Logger(CompaniesCsvService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CompaniesRepository,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
  ) {}

  /** The file for a list's filters, inside the caller's export scope. */
  async export(query: ExportCompaniesQuery, scope: RecordScope): Promise<string> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const defs = await this.repo.propertyDefs(tx, ctx.orgId);
      const { columns, unknown } = exportColumns(query.columns, defs);
      if (unknown.length > 0 || columns.length === 0) {
        throw new AppError(
          ERROR_CODES.COMPANY_FILTER_INVALID,
          'The export names a column that does not exist.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          unknown.map((id) => ({ path: 'columns', message: id })),
        );
      }
      const args = await this.companies.listArgs(tx, ctx.orgId, query, scope);
      const rows = args
        ? await this.repo.list(tx, ctx.orgId, { ...args, limit: COMPANY_EXPORT_MAX })
        : [];
      if (rows.length > COMPANY_EXPORT_MAX) {
        throw new AppError(
          ERROR_CODES.COMPANY_EXPORT_TOO_LARGE,
          `An export holds at most ${COMPANY_EXPORT_MAX} companies: narrow the list with a filter first.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      let csv = UTF8_BOM + csvLine(columns.map((c) => c.header));
      for (const row of rows) {
        csv += csvLine(
          columns.map((c) => {
            const cell = this.cellOf(c.id, row);
            return c.text ? guardFormula(cell) : cell;
          }),
        );
      }
      await this.audit.record(tx, {
        module: 'company_exports',
        recordId: ctx.orgId,
        action: 'export',
        delta: {
          rows: { old: null, new: rows.length },
          columns: { old: null, new: columns.map((c) => c.id) },
        },
      });
      return csv;
    });
  }

  private cellOf(
    id: string,
    row: Awaited<ReturnType<CompaniesRepository['list']>>[number],
  ): string {
    switch (id) {
      case 'name':
        return row.name;
      case 'website':
        return row.website ?? '';
      case 'email':
        return row.email ?? '';
      case 'phone':
        return row.phone ?? '';
      case 'industry':
        return row.industry ?? '';
      case 'sizeRange':
        return row.sizeRange ?? '';
      case 'address':
        return row.address ?? '';
      case 'notes':
        return row.notes ?? '';
      case 'owner':
        return row.ownerName ?? '';
      case 'createdAt':
        return row.createdAt.toISOString();
      default:
        return propertyToCell(row.data[id.slice('property:'.length)]);
    }
  }

  /**
   * Reads a file of companies. `scope` is the caller's `record.companies.update` scope: an existing company is only filled in when it
   * is inside it (otherwise the row creates a new company, as the form would).
   */
  async import(input: ImportCompaniesInput): Promise<CompanyImportResult> {
    const ctx = RequestContextStore.require();
    const grants = ctx.grants;
    const create = grants ? this.rbac.can(grants, 'record.companies.create') : { allowed: true };
    if (!create.allowed) throw AppError.forbidden('record.companies.create');
    const update = grants ? this.rbac.can(grants, 'record.companies.update') : undefined;

    const parsed = parseCsv(input.csv);
    const [header, ...records] = parsed.records;
    if (!header) {
      throw new AppError(
        ERROR_CODES.COMPANY_IMPORT_INVALID,
        'The file has no header line.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (records.length > COMPANY_IMPORT_ROWS_MAX) {
      throw new AppError(
        ERROR_CODES.COMPANY_IMPORT_INVALID,
        `A file holds at most ${COMPANY_IMPORT_ROWS_MAX} companies: split it and import the parts.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.db.tx(async (tx) => {
      const defs = await this.repo.propertyDefs(tx, ctx.orgId);
      const map = mapHeaders(header.cells, defs);
      const hasIdentity = map.columns.some(
        (c) => c?.kind === 'builtin' && (c.field === 'name' || c.field === 'website'),
      );
      if (!hasIdentity) {
        throw new AppError(
          ERROR_CODES.COMPANY_IMPORT_INVALID,
          'The header needs a name column (or a website column).',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const matchScope =
        input.matchExisting && update?.allowed
          ? companyScopeCondition(ctx.orgId, update.scope, ctx.userId)
          : undefined;
      const canMatch = input.matchExisting && (update?.allowed ?? grants === undefined);

      const result: CompanyImportResult = {
        total: records.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        failed: [],
        ignoredColumns: map.ignored,
      };

      for (const record of records) {
        const fail = (field: string | null, message: string) =>
          result.failed.push({ line: record.line, field, message });
        try {
          await tx.transaction(async (rowTx) => {
            const builtin: Record<string, string> = {};
            const custom: Record<string, unknown> = {};
            map.columns.forEach((target, i) => {
              const cell = (record.cells[i] ?? '').trim();
              if (!target || cell === '') return;
              if (target.kind === 'builtin') builtin[target.field] = cell;
              else {
                const value = cellToPropertyValue(target.def, cell);
                if (value !== undefined) custom[target.def.key] = value;
              }
            });
            if (!builtin.name && !builtin.website) {
              throw new RowProblem(null, 'The row has neither a name nor a website.');
            }

            // The built-in fields go through the form's own schema: trimmed, within the limits, a valid email.
            const checked = createCompanySchema.safeParse({
              name: builtin.name ?? hostLabel(builtin.website!),
              website: builtin.website,
              email: builtin.email,
              phone: builtin.phone,
              industry: builtin.industry,
              sizeRange: builtin.sizeRange,
              address: builtin.address,
              notes: builtin.notes,
              customFields: custom,
            });
            if (!checked.success) {
              const issue = checked.error.issues[0];
              throw new RowProblem(
                String(issue?.path[0] ?? '') || null,
                issue?.message ?? 'The row is not valid.',
              );
            }

            if (canMatch) {
              const found = await this.repo.findByDomainOrName(
                rowTx,
                ctx.orgId,
                { host: normaliseCompanyDomain(builtin.website), name: builtin.name ?? null },
                matchScope,
              );
              if (found) {
                // The values must still fit their properties, exactly as a form save would require.
                const { next } = mergeProperties(defs, custom, {});
                const changed = await this.repo.fillBlanks(rowTx, ctx.orgId, found.id, {
                  domain: checked.data.website ?? null,
                  email: checked.data.email ?? null,
                  phone: checked.data.phone ?? null,
                  industry: checked.data.industry ?? null,
                  sizeRange: checked.data.sizeRange ?? null,
                  address: checked.data.address ?? null,
                  notes: checked.data.notes ?? null,
                  custom: next,
                });
                if (changed.length === 0) {
                  result.unchanged += 1;
                  return;
                }
                const after = (await this.repo.findById(rowTx, ctx.orgId, found.id))!;
                await this.audit.record(rowTx, {
                  module: COMPANY_MODULE,
                  recordId: found.id,
                  action: 'update',
                  delta: Object.fromEntries(
                    changed.map((k) => [k, { old: null, new: 'filled by an import' }]),
                  ),
                });
                await this.outbox.emit(rowTx, {
                  aggregateModule: COMPANY_MODULE,
                  aggregateId: found.id,
                  eventType: 'company.updated',
                  payload: { ...companyEventPayload(after), changed, via: 'import' },
                });
                result.updated += 1;
                return;
              }
            }

            // An owner column: an active member, by email or full name. Omitted means the importer.
            let ownerId: string | undefined;
            if (builtin.owner) {
              const people = await this.repo.activeUsersByLogin(rowTx, ctx.orgId, builtin.owner);
              if (people.length !== 1) {
                throw new RowProblem(
                  'owner',
                  people.length === 0
                    ? 'No active member has that email or name.'
                    : 'More than one active member has that name: use the email.',
                );
              }
              ownerId = people[0]!.uuid;
            }
            await this.createRow(rowTx, { ...checked.data, ...(ownerId ? { ownerId } : {}) }, defs);
            result.created += 1;
          });
        } catch (err) {
          if (err instanceof RowProblem) fail(err.field, err.message);
          else if (err instanceof AppError) {
            fail(err.details?.[0]?.path?.replace(/^customFields\./, '') ?? null, err.message);
          } else {
            this.logger.error({ err }, 'a company import row failed unexpectedly');
            fail(null, 'The row could not be imported.');
          }
        }
      }

      await this.audit.record(tx, {
        module: 'company_exports',
        recordId: ctx.orgId,
        action: 'insert',
        delta: {
          imported: {
            old: null,
            new: { created: result.created, updated: result.updated, failed: result.failed.length },
          },
        },
      });
      return result;
    });
  }

  private createRow(
    tx: Tx,
    input: Parameters<CompaniesService['createIn']>[1],
    defs: Parameters<CompaniesService['createIn']>[2],
  ) {
    return this.companies.createIn(tx, input, defs);
  }
}

/** A row-level problem with the cell it is about (the field), reported with the line of the file. */
class RowProblem extends Error {
  constructor(
    readonly field: string | null,
    message: string,
  ) {
    super(message);
  }
}
