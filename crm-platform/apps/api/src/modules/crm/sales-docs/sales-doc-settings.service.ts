import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateSalesDocTemplateInput,
  type ListSalesDocTemplatesQuery,
  type SalesDocSettings,
  type SalesDocTemplate,
  type UpdateSalesDocSettingsInput,
  type UpdateSalesDocTemplateInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { pgError } from '../pipelines/pipelines.service';
import { SalesDocsRepository, type SalesDocTemplateRow } from './sales-docs.repository';

const SETTINGS_MODULE = 'sales_doc_settings';
const TEMPLATE_MODULE = 'sales_doc_templates';

const nameTaken = (name: string) =>
  new AppError(
    ERROR_CODES.SALESDOC_TEMPLATE_NAME_TAKEN,
    'A template with this name already exists for this kind.',
    HttpStatus.CONFLICT,
    [{ path: 'name', message: name }],
  );

const toTemplateResponse = (r: SalesDocTemplateRow): SalesDocTemplate => ({
  id: r.uuid,
  kind: r.kind,
  name: r.name,
  terms: r.terms,
  notes: r.notes,
  validDays: r.validDays,
  isDefault: r.isDefault,
  rowVersion: r.rowVersion,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * Numbering, defaults and templates of proposals and estimates (TW-PROP-008 / D-06; templates of default terms and notes). The
 * numbering settings only shape the NEXT number: a number already issued never changes, and the counter is never lowered.
 */
@Injectable()
export class SalesDocSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SalesDocsRepository,
    private readonly audit: AuditService,
  ) {}

  async getSettings(): Promise<SalesDocSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.read(tx, ctx.orgId));
  }

  async updateSettings(input: UpdateSalesDocSettingsInput): Promise<SalesDocSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const cur = await this.repo.settings(tx, ctx.orgId);
      // The first save has no version; once the row exists every save must carry the one it read.
      if (
        cur.rowVersion === null
          ? input.rowVersion !== undefined
          : input.rowVersion !== cur.rowVersion
      ) {
        throw AppError.rowVersionConflict('Settings');
      }
      const next = {
        ...cur,
        ...(input.proposalPrefix !== undefined ? { proposalPrefix: input.proposalPrefix } : {}),
        ...(input.estimatePrefix !== undefined ? { estimatePrefix: input.estimatePrefix } : {}),
        ...(input.numberPadding !== undefined ? { numberPadding: input.numberPadding } : {}),
        ...(input.proposalStart !== undefined ? { proposalStart: input.proposalStart } : {}),
        ...(input.estimateStart !== undefined ? { estimateStart: input.estimateStart } : {}),
        ...(input.defaultValidDays !== undefined
          ? { defaultValidDays: input.defaultValidDays }
          : {}),
        ...(input.linkTtlDays !== undefined ? { linkTtlDays: input.linkTtlDays } : {}),
      };
      const ok = await this.repo.upsertSettings(tx, ctx.orgId, input.rowVersion, next);
      if (!ok) throw AppError.rowVersionConflict('Settings');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const k of Object.keys(next) as Array<keyof typeof next>) {
        if (k !== 'rowVersion' && next[k] !== cur[k]) delta[k] = { old: cur[k], new: next[k] };
      }
      await this.audit.record(tx, {
        module: SETTINGS_MODULE,
        recordId: ctx.orgId,
        action: 'update',
        delta,
      });
      return this.read(tx, ctx.orgId);
    });
  }

  private async read(
    tx: Parameters<Parameters<DatabaseService['tx']>[0]>[0],
    orgId: number,
  ): Promise<SalesDocSettings> {
    const s = await this.repo.settings(tx, orgId);
    const last = await this.repo.counters(tx, orgId);
    return {
      proposalPrefix: s.proposalPrefix,
      estimatePrefix: s.estimatePrefix,
      numberPadding: s.numberPadding,
      proposalStart: s.proposalStart,
      estimateStart: s.estimateStart,
      defaultValidDays: s.defaultValidDays,
      linkTtlDays: s.linkTtlDays,
      proposalLast: last.proposal,
      estimateLast: last.estimate,
      rowVersion: s.rowVersion,
    };
  }

  // --- templates ---------------------------------------------------------------------------------------------------------

  async listTemplates(query: ListSalesDocTemplatesQuery): Promise<SalesDocTemplate[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) =>
      (await this.repo.templates(tx, ctx.orgId, query.kind)).map(toTemplateResponse),
    );
  }

  async createTemplate(input: CreateSalesDocTemplateInput): Promise<SalesDocTemplate> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      if (input.isDefault) await this.repo.clearDefaultTemplate(tx, ctx.orgId, input.kind);
      let uuid: string;
      try {
        uuid = await tx.transaction((sp) =>
          this.repo.insertTemplate(sp, ctx.orgId, {
            kind: input.kind,
            name: input.name,
            terms: input.terms || null,
            notes: input.notes || null,
            validDays: input.validDays ?? null,
            isDefault: input.isDefault ?? false,
            createdBy: ctx.userId,
          }),
        );
      } catch (err) {
        if (pgError(err).code === '23505') throw nameTaken(input.name);
        throw err;
      }
      const row = (await this.repo.templateByUuid(tx, ctx.orgId, uuid))!;
      await this.audit.record(tx, {
        module: TEMPLATE_MODULE,
        recordId: row.id,
        action: 'insert',
        delta: { name: { old: null, new: row.name }, kind: { old: null, new: row.kind } },
      });
      return toTemplateResponse(row);
    });
  }

  async updateTemplate(
    uuid: string,
    input: UpdateSalesDocTemplateInput,
  ): Promise<SalesDocTemplate> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.templateByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Template', uuid);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Template');
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.terms !== undefined) patch.terms = input.terms || null;
      if (input.notes !== undefined) patch.notes = input.notes || null;
      if (input.validDays !== undefined) patch.valid_days = input.validDays;
      if (input.isDefault !== undefined) {
        if (input.isDefault) await this.repo.clearDefaultTemplate(tx, ctx.orgId, row.kind);
        patch.is_default = input.isDefault;
      }
      try {
        const ok = await tx.transaction((sp) =>
          this.repo.updateTemplate(sp, ctx.orgId, row.id, input.rowVersion, patch),
        );
        if (!ok) throw AppError.rowVersionConflict('Template');
      } catch (err) {
        if (pgError(err).code === '23505') throw nameTaken(input.name ?? row.name);
        throw err;
      }
      await this.audit.record(tx, {
        module: TEMPLATE_MODULE,
        recordId: row.id,
        action: 'update',
        delta: Object.fromEntries(Object.keys(patch).map((k) => [k, { old: true, new: true }])),
      });
      return toTemplateResponse((await this.repo.templateByUuid(tx, ctx.orgId, uuid))!);
    });
  }

  async deleteTemplate(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.templateByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Template', uuid);
      await this.audit.record(tx, {
        module: TEMPLATE_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { name: { old: row.name, new: null } },
      });
      await this.repo.deleteTemplate(tx, ctx.orgId, row.id);
    });
  }
}
