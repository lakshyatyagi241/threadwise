import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type Subprocessor,
  type SubprocessorInput,
  type SubprocessorList,
  type UpdateSubprocessorInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ComplianceRepository, type SubRow } from './compliance.repository';

const MODULE_KEY = 'compliance_subprocessors';

const isUnique = (e: unknown): boolean => {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code === '23505' || x?.cause?.code === '23505';
};

const duplicate = (): AppError =>
  new AppError(
    ERROR_CODES.COMPLIANCE_SUBPROCESSOR_DUPLICATE,
    'This workspace already lists a sub-processor with that name.',
    HttpStatus.CONFLICT,
  );

const notFound = (): AppError =>
  new AppError(
    ERROR_CODES.COMPLIANCE_SUBPROCESSOR_NOT_FOUND,
    'That sub-processor does not exist in this workspace.',
    HttpStatus.NOT_FOUND,
  );

const toView = ({ internalId: _internalId, ...view }: SubRow): Subprocessor => view;

/**
 * The workspace's sub-processor list (BL-173): the vendors that process personal data for it, with the purpose, the data, the location
 * and the link to the agreement. Edited by people with `settings.compliance.manage`; shown on the public page only when the workspace
 * switched that on. Every change is audited and emitted.
 */
@Injectable()
export class SubprocessorsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ComplianceRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(): Promise<SubprocessorList> {
    const orgId = RequestContextStore.orgId();
    const rows = await this.db.tx((tx) => this.repo.listSubprocessors(tx, orgId));
    return { data: rows.map(toView) };
  }

  async create(input: SubprocessorInput): Promise<Subprocessor> {
    const orgId = RequestContextStore.orgId();
    try {
      return await this.db.tx(async (tx) => {
        const row = await this.repo.insertSubprocessor(tx, orgId, input);
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: row.internalId,
          action: 'insert',
          delta: { name: { old: null, new: row.name }, status: { old: null, new: row.status } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: row.internalId,
          eventType: 'compliance.subprocessor_added',
          payload: { name: row.name, status: row.status },
        });
        return toView(row);
      });
    } catch (e) {
      if (isUnique(e)) throw duplicate();
      throw e;
    }
  }

  async update(uuid: string, input: UpdateSubprocessorInput): Promise<Subprocessor> {
    const orgId = RequestContextStore.orgId();
    const { rowVersion, ...values } = input;
    try {
      return await this.db.tx(async (tx) => {
        const before = await this.repo.findSubprocessor(tx, orgId, uuid);
        if (!before) throw notFound();
        const row = await this.repo.updateSubprocessor(tx, orgId, uuid, values, rowVersion);
        if (!row) throw AppError.rowVersionConflict('Sub-processor');
        const delta: Record<string, { old: unknown; new: unknown }> = {};
        for (const k of [
          'name',
          'purpose',
          'dataCategories',
          'location',
          'websiteUrl',
          'dpaUrl',
          'status',
          'addedOn',
          'noticeSentOn',
        ] as const) {
          if (before[k] !== row[k]) delta[k] = { old: before[k], new: row[k] };
        }
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: row.internalId,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: row.internalId,
          eventType: 'compliance.subprocessor_changed',
          payload: { name: row.name, status: row.status },
        });
        return toView(row);
      });
    } catch (e) {
      if (isUnique(e)) throw duplicate();
      throw e;
    }
  }

  async remove(uuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    await this.db.tx(async (tx) => {
      const before = await this.repo.findSubprocessor(tx, orgId, uuid);
      if (!before || !(await this.repo.deleteSubprocessor(tx, orgId, uuid))) throw notFound();
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: before.internalId,
        action: 'delete',
        delta: { name: { old: before.name, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: before.internalId,
        eventType: 'compliance.subprocessor_removed',
        payload: { name: before.name },
      });
    });
  }
}
