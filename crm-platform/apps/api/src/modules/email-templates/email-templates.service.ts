import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  fillEmailTemplate,
  sampleEmailVariableLookup,
  templateVariablesIn,
  type CreateEmailTemplateInput,
  type EmailTemplate,
  type EmailTemplateListResponse,
  type EmailTemplatePurpose,
  type EmailTemplateRenderResponse,
  type ListEmailTemplatesQuery,
  type PreviewEmailTemplateInput,
  type UpdateEmailTemplateInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore, type RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { outboundText, sanitizeOutboundHtml } from '../../infra/providers/channel-email';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import type { MergeContact, MergeContext } from '../crm';
import {
  EmailTemplatesRepository,
  type EmailTemplateRow,
  type TemplateWrite,
} from './email-templates.repository';
import {
  EMAIL_TEMPLATE_MANAGE,
  buildLookup,
  canChange,
  isUniqueViolation,
  scopeOf,
  type TemplateCaller,
} from './email-templates.rules';

const MODULE_KEY = 'email_templates';

export const templateNotFound = (): AppError =>
  new AppError(
    ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND,
    'Email template not found',
    HttpStatus.NOT_FOUND,
  );
const nameTaken = (name: string): AppError =>
  new AppError(
    ERROR_CODES.EMAIL_TEMPLATE_NAME_TAKEN,
    `A template named "${name}" already exists. Choose a different name.`,
    HttpStatus.CONFLICT,
    [{ path: 'name', message: 'This name is already in use' }],
  );
const notEditable = (): AppError =>
  new AppError(
    ERROR_CODES.EMAIL_TEMPLATE_NOT_EDITABLE,
    'Only people who manage email templates can change a shared template.',
    HttpStatus.FORBIDDEN,
  );
const archived = (): AppError =>
  new AppError(
    ERROR_CODES.EMAIL_TEMPLATE_ARCHIVED,
    'This template is archived. Restore it to use it.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/** What a conversation contributes when a template is rendered for it. */
export interface ConversationFacts {
  contact: MergeContact | undefined;
  base: Omit<MergeContext, 'contact'>;
  peerName: string | null;
}

const ownership = (row: EmailTemplateRow) => ({
  userId: row.user_id === null ? null : Number(row.user_id),
});

function toTemplate(row: EmailTemplateRow, caller: TemplateCaller): EmailTemplate {
  const subject = row.subject as string;
  const bodyHtml = row.body_html as string;
  return {
    id: row.uuid as string,
    name: row.name as string,
    subject,
    bodyHtml,
    bodyText: row.body_text as string,
    category: (row.category as string | null) ?? null,
    purpose: row.purpose as EmailTemplatePurpose,
    scope: scopeOf(ownership(row)),
    status: row.status as 'active' | 'archived',
    variables: templateVariablesIn(subject, bodyHtml),
    usedCount: Number(row.used_count),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : null,
    createdByName: (row.created_by_name as string | null) ?? null,
    canEdit: canChange(ownership(row), caller),
    rowVersion: Number(row.row_version),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/**
 * Email templates (BL-004 / E-14): the workspace library behind the email composer's "Templates" picker and the Email templates screen.
 *
 * Who may do what: `mail.templates.read` sees the shared templates and one's own personal ones, inserts them and keeps personal templates;
 * a SHARED template is created, changed, archived or deleted only with `mail.templates.manage`. A colleague's personal template does not
 * exist for you (404). The HTML is sanitised on write with the same allow-list as signatures and outbound mail; the text twin is derived
 * when not given. Every write is one transaction holding the change, its audit row and its outbox event.
 *
 * Rendering fills the variables from the conversation's contact, the sending agent and the workspace: values are HTML-escaped in the body and
 * flattened to one line in the subject, so a contact cannot inject markup or a header. A template never sends anything: it fills the
 * composer, and the reply goes through the normal send path (ConsentGate, unsubscribe link for a marketing template, signature).
 */
@Injectable()
export class EmailTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: EmailTemplatesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
  ) {}

  async list(query: ListEmailTemplatesQuery): Promise<EmailTemplateListResponse> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    return this.db.tx(async (tx) => {
      const page = await this.repo.list(tx, ctx.orgId, caller.userId, query);
      return {
        data: page.rows.map((r) => toTemplate(r, caller)),
        page: {
          nextCursor: page.nextCursor,
          hasMore: page.nextCursor !== null,
          limit: query.limit,
        },
        categories: await this.repo.categories(tx, ctx.orgId, caller.userId),
      };
    });
  }

  async get(uuid: string): Promise<EmailTemplate> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid);
      if (!row) throw templateNotFound();
      return toTemplate(row, caller);
    });
  }

  async create(input: CreateEmailTemplateInput): Promise<EmailTemplate> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    if (input.scope === 'shared' && !caller.canManage) throw notEditable();
    const ownerId = input.scope === 'mine' ? caller.userId : null;
    const write = this.writeOf(input);
    return this.db.tx(async (tx) => {
      if (await this.repo.nameTaken(tx, ctx.orgId, ownerId, write.name)) {
        throw nameTaken(write.name);
      }
      let created: { id: number; uuid: string };
      try {
        created = await this.repo.insert(tx, ctx.orgId, {
          ...write,
          ownerId,
          createdBy: caller.userId,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken(write.name);
        throw err;
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: created.id,
        action: 'insert',
        delta: {
          name: { old: null, new: write.name },
          scope: { old: null, new: ownerId === null ? 'shared' : 'mine' },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'mail.email_template.created',
        payload: {
          templateId: created.uuid,
          name: write.name,
          purpose: write.purpose,
          scope: ownerId === null ? 'shared' : 'mine',
        },
      });
      return toTemplate(
        (await this.repo.byUuid(tx, ctx.orgId, caller.userId, created.uuid))!,
        caller,
      );
    });
  }

  async update(uuid: string, input: UpdateEmailTemplateInput): Promise<EmailTemplate> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid, true);
      if (!row) throw templateNotFound();
      if (!canChange(ownership(row), caller)) throw notEditable();
      if (Number(row.row_version) !== input.rowVersion) {
        throw AppError.rowVersionConflict('Email template');
      }
      const id = Number(row.id);
      const patch: Partial<TemplateWrite> & { status?: 'active' | 'archived' } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.subject !== undefined) patch.subject = input.subject;
      if (input.bodyHtml !== undefined) {
        patch.bodyHtml = sanitizeOutboundHtml(input.bodyHtml);
        patch.bodyText =
          input.bodyText !== undefined && input.bodyText.trim() !== ''
            ? input.bodyText
            : outboundText(patch.bodyHtml);
      } else if (input.bodyText !== undefined) {
        patch.bodyText = input.bodyText;
      }
      if (input.category !== undefined) patch.category = input.category;
      if (input.purpose !== undefined) patch.purpose = input.purpose;
      if (input.status !== undefined) patch.status = input.status;

      if (
        patch.name !== undefined &&
        patch.name.toLowerCase() !== (row.name as string).toLowerCase() &&
        (await this.repo.nameTaken(tx, ctx.orgId, ownership(row).userId, patch.name, id))
      ) {
        throw nameTaken(patch.name);
      }
      let ok: boolean;
      try {
        ok = await this.repo.update(tx, ctx.orgId, id, input.rowVersion, patch);
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken(patch.name ?? (row.name as string));
        throw err;
      }
      if (!ok) throw AppError.rowVersionConflict('Email template');

      const before = toTemplate(row, caller);
      const after = toTemplate(
        (await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid))!,
        caller,
      );
      const pick = (t: EmailTemplate) => ({
        name: t.name,
        subject: t.subject,
        bodyHtml: t.bodyHtml === before.bodyHtml ? '(same)' : '(changed)',
        category: t.category,
        purpose: t.purpose,
        status: t.status,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: id,
        action: 'update',
        delta: this.audit.diff(pick(before), pick(after)),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'mail.email_template.updated',
        payload: {
          templateId: uuid,
          name: after.name,
          purpose: after.purpose,
          status: after.status,
        },
      });
      return after;
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    await this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid, true);
      if (!row) throw templateNotFound();
      if (!canChange(ownership(row), caller)) throw notEditable();
      const id = Number(row.id);
      await this.repo.remove(tx, ctx.orgId, id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: id,
        action: 'delete',
        delta: { name: { old: row.name as string, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'mail.email_template.deleted',
        payload: { templateId: uuid, name: row.name as string },
      });
    });
  }

  /** Renders unsaved text with the sample data (the editor's live preview). The HTML is sanitised first, so the preview is what would be saved. */
  preview(input: PreviewEmailTemplateInput): EmailTemplateRenderResponse {
    const cleaned = sanitizeOutboundHtml(input.bodyHtml);
    return this.fill(
      input.subject,
      cleaned,
      outboundText(cleaned),
      sampleEmailVariableLookup,
      'sample',
    );
  }

  /**
   * The template for one conversation: variables filled from its contact, the sending agent and the workspace. Counts nothing and sends
   * nothing. The caller has already checked the right to reply on that conversation; an archived template is refused (422).
   */
  async renderFor(
    tx: Tx,
    ctx: RequestContext,
    uuid: string,
    facts: ConversationFacts,
  ): Promise<EmailTemplateRenderResponse> {
    const caller = this.caller(ctx);
    const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid);
    if (!row) throw templateNotFound();
    if (row.status === 'archived') throw archived();
    const lookup = buildLookup({
      ...facts,
      agentName: await this.repo.agentName(tx, ctx.orgId, caller.userId),
    });
    const html = row.body_html as string;
    const text =
      (row.body_text as string).trim() !== '' ? (row.body_text as string) : outboundText(html);
    return this.fill(row.subject as string, html, text, lookup, 'conversation');
  }

  // --- pieces -----------------------------------------------------------------------------------------------------------------

  private fill(
    subject: string,
    html: string,
    text: string,
    lookup: Parameters<typeof fillEmailTemplate>[2],
    source: 'conversation' | 'sample',
  ): EmailTemplateRenderResponse {
    const s = fillEmailTemplate(subject, 'subject', lookup);
    const h = fillEmailTemplate(html, 'html', lookup);
    const t = fillEmailTemplate(text, 'text', lookup);
    const issues = [...s.issues, ...h.issues, ...t.issues].filter(
      (issue, i, all) => all.findIndex((x) => x.token === issue.token) === i,
    );
    return { subject: s.text, html: h.text, text: t.text, issues, source };
  }

  private writeOf(input: CreateEmailTemplateInput): TemplateWrite {
    const bodyHtml = sanitizeOutboundHtml(input.bodyHtml);
    return {
      name: input.name,
      subject: input.subject,
      bodyHtml,
      bodyText: input.bodyText.trim() !== '' ? input.bodyText : outboundText(bodyHtml),
      category: input.category ?? null,
      purpose: input.purpose,
    };
  }

  caller(ctx: RequestContext): TemplateCaller {
    return {
      userId: ctx.userId!,
      canManage: this.rbac.can(ctx.grants ?? new Map(), EMAIL_TEMPLATE_MANAGE).allowed,
    };
  }
}
