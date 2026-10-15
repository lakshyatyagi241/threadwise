import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  FORM_EXPORT_MAX_ROWS,
  formDefinitionSchema,
  formFields,
  type ExportFormSubmissionsInput,
  type FormDefinition,
  type FormSubmissionDetail,
  type FormSubmissionList,
  type FormSubmissionSummary,
  type ListFormSubmissionsQuery,
  type RecordScope,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ContactsRepository } from '../crm';
import { buildCsv } from '../../common/csv';
import { asText, type StoredAnswer } from './form-rules';
import { FormPaymentsService, toAttempt } from './form-payments.service';
import { FormSubmitService } from './form-submit.service';
import { toSubmissionDetail, toSubmissionSummary } from './forms.mapper';
import { FormsRepository, type FormRow } from './forms.repository';
import {
  FormSubmissionsRepository,
  submissionScopeCondition,
  type ListFilter,
  type SubmissionRow,
} from './form-submissions.repository';

const SUBMISSION_MODULE = 'web_form_submissions';
const FORM_MODULE = 'web_forms';
const EVENT_MODULE = 'forms';

const notRetryable = (status: string): AppError =>
  new AppError(
    ERROR_CODES.FORMS_SUBMISSION_NOT_RETRYABLE,
    'Only a submission that needs review, failed, or was held as spam can be run again.',
    HttpStatus.CONFLICT,
    [{ path: 'status', message: status }],
  );

/**
 * Submissions, the staff side (docs/specs/forms-builder-app.md 7.1 and 9.5): list, open, retry, erase and export. A submission holds a
 * stranger's personal data, so the record scope applies to every row (a submission is visible to whoever may see its form or owns the
 * contact it made), opening one is audited, an export is audited, and an erase removes the answers and keeps a tombstone.
 */
@Injectable()
export class FormSubmissionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly forms: FormsRepository,
    private readonly subs: FormSubmissionsRepository,
    private readonly submit: FormSubmitService,
    private readonly payments: FormPaymentsService,
    private readonly contacts: ContactsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    formUuid: string,
    query: ListFormSubmissionsQuery,
    scope: RecordScope,
  ): Promise<FormSubmissionList> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.mustForm(tx, ctx.orgId, formUuid);
      const filter = await this.filterOf(tx, ctx.orgId, query, scope, ctx.userId);
      if (!filter)
        return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      const rows = await this.subs.list(tx, ctx.orgId, form.id, {
        ...filter,
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
      });
      const { items, page } = buildPage(rows, query.limit);
      const defs = await this.definitions(tx, ctx.orgId, items);
      return {
        data: items.map((r) => toSubmissionSummary(r, defs.get(r.versionId) ?? null)),
        page,
      };
    });
  }

  async get(formUuid: string, uuid: string, scope: RecordScope): Promise<FormSubmissionDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const { row } = await this.mustSubmission(tx, ctx.orgId, formUuid, uuid, scope);
      // Opening answers is a read of personal data: audited, so "who looked" has an answer.
      await this.audit.record(tx, {
        module: SUBMISSION_MODULE,
        recordId: row.id,
        action: 'read',
        delta: { answers: { old: null, new: 'opened' } },
      });
      const defs = await this.definitions(tx, ctx.orgId, [row]);
      const attempts = (await this.payments.attemptsFor(tx, ctx.orgId, [row.id])).get(row.id) ?? [];
      return toSubmissionDetail(
        row,
        defs.get(row.versionId) ?? null,
        attempts.map((a) => toAttempt(a)),
      );
    });
  }

  /**
   * A fresh payment link for a submission still awaiting payment (the first one failed or lapsed). Opens a new attempt (the amount is
   * worked out again from the version the visitor saw), expires the old pending one, and mints the link after commit.
   */
  async newPaymentLink(
    formUuid: string,
    uuid: string,
    scope: RecordScope,
  ): Promise<{ url: string | null }> {
    const ctx = RequestContextStore.require();
    const { form, row, payment } = await this.db.tx(async (tx) => {
      const found = await this.mustSubmission(tx, ctx.orgId, formUuid, uuid, scope, true);
      const created = await this.payments.newAttemptIn(tx, ctx.orgId, found.form, found.row);
      await this.audit.record(tx, {
        module: SUBMISSION_MODULE,
        recordId: found.row.id,
        action: 'update',
        delta: { paymentLink: { old: null, new: created.reference } },
      });
      return { ...found, payment: created };
    });
    const url = await this.payments.mintLink(
      ctx.orgId,
      payment.uuid,
      form.publicKey,
      row.receiptToken,
      { name: row.contactName, email: null, phone: null },
      form.name,
    );
    return { url };
  }

  /** "Mark as paid": money that arrived outside the gateway (a bank transfer, cash). Audited; the trail names the person. */
  async markPaid(
    formUuid: string,
    uuid: string,
    scope: RecordScope,
  ): Promise<FormSubmissionSummary> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const { form, row } = await this.mustSubmission(tx, ctx.orgId, formUuid, uuid, scope, true);
      await this.payments.markPaidManuallyIn(tx, ctx.orgId, form, row);
      const after = (await this.subs.findById(tx, ctx.orgId, row.id))!;
      const defs = await this.definitions(tx, ctx.orgId, [after]);
      return toSubmissionSummary(after, defs.get(after.versionId) ?? null);
    });
  }

  /**
   * Runs a submission again under the form's current mapping: one that needs review, one that failed, or one held as spam (the "not
   * spam" action). The answers are the stored ones, so a purged or erased submission has nothing to read.
   */
  async retry(formUuid: string, uuid: string, scope: RecordScope): Promise<FormSubmissionSummary> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const { form, row } = await this.mustSubmission(tx, ctx.orgId, formUuid, uuid, scope, true);
      if (row.status !== 'needs_review' && row.status !== 'failed' && row.status !== 'spam')
        throw notRetryable(row.status);
      if (row.erasedAt !== null || row.payloadPurgedAt !== null) {
        throw new AppError(
          ERROR_CODES.FORMS_SUBMISSION_PURGED,
          'The answers of this submission were removed, so there is nothing to run again.',
          HttpStatus.GONE,
        );
      }
      if (row.status === 'spam') await this.subs.markNotSpam(tx, ctx.orgId, row.id);
      const after = await this.submit.reprocess(tx, ctx.orgId, form, row);
      await this.audit.record(tx, {
        module: SUBMISSION_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { retried: { old: row.status, new: after.status } },
      });
      const defs = await this.definitions(tx, ctx.orgId, [after]);
      return toSubmissionSummary(after, defs.get(after.versionId) ?? null);
    });
  }

  /** Erase (GDPR): the answers and what identifies the visitor go; the row stays as a tombstone; the contact is never touched. */
  async erase(formUuid: string, uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const { form, row } = await this.mustSubmission(tx, ctx.orgId, formUuid, uuid, scope, true);
      await this.subs.erase(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: SUBMISSION_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { answers: { old: 'present', new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: EVENT_MODULE,
        aggregateId: row.id,
        eventType: 'form.submission_erased',
        payload: { formId: form.uuid, submissionId: row.uuid },
      });
    });
  }

  /**
   * The CSV of a form's submissions (newest first, at most FORM_EXPORT_MAX_ROWS): fixed columns, then one column per field of the
   * versions the rows were made against (newest version's order and labels first). Every cell is spreadsheet-formula safe (see
   * `csvCell`). Audited.
   */
  async export(
    formUuid: string,
    input: ExportFormSubmissionsInput,
    scope: RecordScope,
  ): Promise<{ csv: string; truncated: boolean; filename: string; rows: number }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.mustForm(tx, ctx.orgId, formUuid);
      const filter = await this.filterOf(
        tx,
        ctx.orgId,
        { ...input, tab: undefined },
        scope,
        ctx.userId,
      );
      const all = filter
        ? await this.subs.listForExport(tx, ctx.orgId, form.id, filter, FORM_EXPORT_MAX_ROWS)
        : [];
      const truncated = all.length > FORM_EXPORT_MAX_ROWS;
      const rows = truncated ? all.slice(0, FORM_EXPORT_MAX_ROWS) : all;
      const defs = await this.definitions(tx, ctx.orgId, rows);

      // Field columns: ids in the order of the newest version that has them, labels from that version.
      const byVersion = [...new Set(rows.map((r) => r.versionNumber))].sort((a, b) => b - a);
      const versionDef = (n: number): FormDefinition | null => {
        const r = rows.find((x) => x.versionNumber === n);
        return r ? (defs.get(r.versionId) ?? null) : null;
      };
      const columns: Array<{ id: string; label: string }> = [];
      for (const n of byVersion) {
        const d = versionDef(n);
        if (!d) continue;
        for (const f of formFields(d))
          if (!columns.some((c) => c.id === f.id)) columns.push({ id: f.id, label: f.label });
      }
      const header = [
        'Submission ID',
        'Submitted at',
        'Status',
        'Reason',
        'Form version',
        'Contact',
        'Company',
        'UTM source',
        'UTM medium',
        'UTM campaign',
        'Referrer',
        'Page URL',
        'Consent given',
        ...columns.map((c) => c.label),
      ];
      const body = rows.map((r) => [
        r.uuid,
        r.createdAt.toISOString(),
        r.status,
        r.reason ?? '',
        r.versionNumber,
        r.contactName ?? '',
        r.companyName ?? '',
        r.utm.utm_source ?? '',
        r.utm.utm_medium ?? '',
        r.utm.utm_campaign ?? '',
        r.referrer ?? '',
        r.pageUrl ?? '',
        r.consent ? (r.consent.given ? 'yes' : 'no') : '',
        ...columns.map((c) =>
          r.answers[c.id] === undefined ? '' : asText(r.answers[c.id] as StoredAnswer),
        ),
      ]);
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: form.id,
        action: 'export',
        delta: { submissions: { old: null, new: rows.length } },
      });
      const slug =
        form.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'form';
      return {
        csv: buildCsv(header, body),
        truncated,
        filename: `${slug}-submissions.csv`,
        rows: rows.length,
      };
    });
  }

  // --- internals ------------------------------------------------------------------------------------------------------------------------

  private async mustForm(tx: Tx, orgId: number, uuid: string): Promise<FormRow> {
    const form = await this.forms.findByUuid(tx, orgId, uuid);
    if (!form) throw AppError.notFound('Form', uuid);
    return form;
  }

  private async mustSubmission(
    tx: Tx,
    orgId: number,
    formUuid: string,
    uuid: string,
    scope: RecordScope,
    forUpdate = false,
  ): Promise<{ form: FormRow; row: SubmissionRow }> {
    const form = await this.mustForm(tx, orgId, formUuid);
    const row = await this.subs.findByUuid(tx, orgId, form.id, uuid, forUpdate);
    const actor = RequestContextStore.require().userId;
    if (
      !row ||
      !(await this.subs.visible(tx, orgId, row.id, submissionScopeCondition(orgId, scope, actor)))
    ) {
      throw AppError.notFound('Submission', uuid);
    }
    return { form, row };
  }

  /** A list filter with the contact and scope resolved; null when the filter names a contact that does not exist (so nothing matches). */
  private async filterOf(
    tx: Tx,
    orgId: number,
    q: {
      status?: ListFilter['status'];
      tab?: ListFilter['tab'];
      from?: string;
      to?: string;
      q?: string;
      contactId?: string;
    },
    scope: RecordScope,
    actor: number | null,
  ): Promise<ListFilter | null> {
    let contactId: number | undefined;
    if (q.contactId) {
      contactId = await this.contacts.resolveContactId(tx, orgId, q.contactId);
      if (contactId === undefined) return null;
    }
    return {
      status: q.status,
      tab: q.tab,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      q: q.q,
      contactId,
      scope: submissionScopeCondition(orgId, scope, actor),
    };
  }

  private async definitions(
    tx: Tx,
    orgId: number,
    rows: SubmissionRow[],
  ): Promise<Map<number, FormDefinition>> {
    const raw = await this.subs.versionDefinitions(
      tx,
      orgId,
      rows.map((r) => r.versionId),
    );
    const out = new Map<number, FormDefinition>();
    for (const [id, def] of raw) {
      const parsed = formDefinitionSchema.safeParse(def);
      if (parsed.success) out.set(id, parsed.data);
    }
    return out;
  }
}
