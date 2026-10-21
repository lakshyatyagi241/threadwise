import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateTemplateInput,
  type LintTemplateInput,
  type LintTemplateResult,
  type SubmitTemplateInput,
  type TemplateCounts,
  type TemplateCountsQuery,
  type ListTemplatesQuery,
  type ListTemplatesResponse,
  type TemplateDetail,
  type TemplateSubmitResult,
  type TplLintIssue,
  type UpdateTemplateInput,
  type UploadTemplateMediaResult,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WABA_TEMPLATES,
  type RemoteTemplate,
  type WabaTemplatePort,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-template.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { UploadPolicyService } from '../auth';
import { MediaStorageService } from '../platform-settings-branding-storage';
import { PlanUsageService } from '../plans-subscriptions-trials';
import {
  localStatusFor,
  WabaConnectService,
  type ResolvedWabaConnection,
} from '../whatsapp-cloud-api-waba';
import type { FlowTemplate } from './flow-template';
import { describeTemplateFailure, providerProblem } from './template-errors';
import {
  detailWithMedia,
  headerPreviewUrl,
  isTemplateMediaKey,
  MEDIA_PREVIEW_TTL_S,
  templateMediaFolder,
} from './template-media';
import {
  BUILDABLE_TYPES,
  lintPrepared,
  payloadOfPrepared,
  prepareTemplate,
  type PreparedTemplate,
} from './template-input';
import type { LintIssue } from './template-linter';
import { buildMetaTemplate, normalizeTemplateName } from './template-payload';
import { columnsOfState, sameLanguage, statePatchFrom, type CurrentState } from './template-remote';
import { draftOf, lintOf, statusOf, toDetail, toSummary } from './templates.mapper';
import {
  TemplatesRepository,
  encodeNameCursor,
  type TemplatePatch,
  type TemplateRow,
} from './templates.repository';

const MODULE = 'wa_templates';
/** Statuses a template can still be edited in (TW-TPL-018, and Geta's "locked once approved"). */
/** An approved or paused template is edited in place on Meta (Meta's own edit endpoint), as Reference does; the rest are replaced. */
const EDITABLE = new Set(['pending', 'rejected', 'draft', 'approved', 'paused']);
const IN_PLACE = new Set(['approved', 'paused']);

/** Header example files Meta takes, and the size it allows for each (TW-TPL-009: 5 MB image, 16 MB video, 100 MB document). */
const MEDIA_TYPES: Record<string, { kind: 'image' | 'media' | 'document'; maxBytes: number }> = {
  jpg: { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  jpeg: { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  png: { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  mp4: { kind: 'media', maxBytes: 16 * 1024 * 1024 },
  '3gp': { kind: 'media', maxBytes: 16 * 1024 * 1024 },
  pdf: { kind: 'document', maxBytes: 100 * 1024 * 1024 },
};
export const MEDIA_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

const inPlace = (r: TemplateRow): boolean => Boolean(r.metaTemplateId) && IN_PLACE.has(statusOf(r));

const toIssue = (i: LintIssue): TplLintIssue => i;

/**
 * Authoring templates and sending them to Meta (TW-TPL-007, 017, 019, 020, 022, 023, 025).
 *
 * Every Meta call happens OUTSIDE a database transaction (a transaction held across a slow Graph call pins a connection); each
 * write is one short transaction with its audit row and outbox event. The row is saved before Meta is called, and a refusal never
 * removes it: the author fixes the form and submits again.
 */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TemplatesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly waba: WabaConnectService,
    private readonly uploads: UploadPolicyService,
    private readonly planUsage: PlanUsageService,
    private readonly storage: MediaStorageService,
    @Inject(WABA_TEMPLATES) private readonly remote: WabaTemplatePort,
  ) {}

  // --- reads -------------------------------------------------------------------------------------------------------

  async list(query: ListTemplatesQuery): Promise<ListTemplatesResponse> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) =>
      this.repo.list(tx, orgId, {
        limit: query.limit,
        cursor: query.cursor,
        status: query.status,
        statusGroup: query.statusGroup,
        sort: query.sort,
        category: query.category,
        connectionUuid: query.connectionId,
        q: query.q,
      }),
    );
    const { items, page } = buildPage(rows, query.limit);
    const byName = query.sort === 'name-asc' || query.sort === 'name-desc';
    const last = items[items.length - 1];
    return {
      data: items.map(toSummary),
      // The name sorts page on (name, id), not on the creation time buildPage reads.
      page:
        byName && last
          ? {
              ...page,
              nextCursor: page.hasMore ? encodeNameCursor(last.templateName, last.id) : null,
            }
          : page,
    };
  }

  /** The numbers on the library's tabs and "Showing N of M" (one read, no totals on the list itself). */
  async counts(query: TemplateCountsQuery): Promise<TemplateCounts> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx((tx) =>
      this.repo.counts(tx, orgId, {
        status: query.status,
        statusGroup: query.statusGroup,
        category: query.category,
        connectionUuid: query.connectionId,
        q: query.q,
      }),
    );
  }

  async get(uuid: string): Promise<TemplateDetail> {
    return detailWithMedia(this.storage, await this.require(uuid));
  }

  /**
   * Links the header files a team-inbox thread shows: the returned function links one template row. The storage destination is resolved
   * once for the whole read, on the first stored file asked for.
   */
  async previewLinker(): Promise<(row: TemplateRow) => Promise<string | null>> {
    const link = await this.storage.linker(MEDIA_PREVIEW_TTL_S);
    return (row) => headerPreviewUrl(link, row);
  }

  /**
   * The template a flow node sends (TW-FLR-026), by the row id the builder stamped or by name, within one workspace. Runs outside
   * a request (the flow worker), so the caller names the organization. Null when there is no such template here.
   */
  async findForFlow(
    orgId: number,
    ref: { id?: number | null; name?: string | null },
  ): Promise<FlowTemplate | null> {
    const row = await this.db.txAs({ orgId }, async (tx) => {
      if (ref.id && ref.id > 0) {
        const byId = await this.repo.findById(tx, orgId, ref.id);
        if (byId) return byId;
      }
      return ref.name?.trim() ? this.repo.findByName(tx, orgId, ref.name.trim()) : null;
    });
    if (!row) return null;
    const d = toDetail(row);
    return {
      id: row.id,
      uuid: row.uuid,
      name: row.templateName,
      language: row.language,
      status: statusOf(row),
      header: d.header,
      body: row.templateBody,
      footer: d.footer,
      buttons: d.buttons,
      variableMap: d.variableMap,
      parameterFormat: d.parameterFormat,
      templateType: row.templateType,
      attachmentType: row.attachmentType,
      headerMediaUrl: /^https?:\/\//i.test(row.headerSampleUrl ?? '') ? row.headerSampleUrl : null,
      headerLocation: row.headerLocation,
    };
  }

  /** Instant feedback for the form (TW-TPL-023): the same preparation and rules as a save, nothing stored, nothing sent. */
  lint(input: LintTemplateInput): LintTemplateResult {
    const prepared = prepareTemplate(input);
    const issues = lintPrepared(
      prepared,
      input.hasHeaderFile ?? Boolean(prepared.headerHandle),
      input.name,
    );
    return {
      issues: issues.map(toIssue),
      normalized: {
        header: prepared.header,
        body: prepared.body,
        variableMap: prepared.variableMap,
      },
      metaPayload: payloadOfPrepared(prepared) as unknown as Record<string, unknown>,
    };
  }

  // --- create and edit ---------------------------------------------------------------------------------------------

  async create(input: CreateTemplateInput): Promise<TemplateSubmitResult> {
    const ctx = RequestContextStore.require();
    const prepared = prepareTemplate(input);
    this.assertOwnMedia(ctx.orgId, prepared.headerMediaKey);
    const issues = lintPrepared(prepared, Boolean(prepared.headerHandle), input.name);
    if (input.submit) {
      this.requireSubmitRight();
      this.throwIfErrors(issues);
    }

    const target = await this.connection({ uuid: input.connectionId });
    if (input.submit) this.requireUsable(target);

    // Plan cap on templates (live count of wa_templates): refuse before anything is written, 422 PLAN_LIMIT_REACHED.
    const row = await this.db.tx(async (tx) => {
      await this.planUsage.assertCanAddIn(tx, ctx.orgId, 'templates');
      if (await this.repo.nameTaken(tx, ctx.orgId, target.id, prepared.name, prepared.language))
        throw this.nameTaken();
      const saved = await this.repo.insert(tx, ctx.orgId, {
        userId: ctx.userId,
        templateName: prepared.name,
        language: prepared.language,
        header: prepared.header,
        templateBody: prepared.body,
        footer: prepared.footer,
        codeExpirationMinutes: prepared.codeExpirationMinutes,
        buttons: prepared.buttons,
        variableMap: prepared.variableMap,
        category: prepared.category,
        metaCategory: prepared.metaCategory,
        templateType: prepared.templateType,
        attachmentType: prepared.attachmentType,
        attachmentFile: prepared.headerHandle,
        headerSampleUrl: prepared.headerSampleUrl,
        headerMediaKey: prepared.headerMediaKey,
        headerLocation: prepared.headerLocation,
        parameterFormat: prepared.parameterFormat,
        status: input.submit ? 'pending' : 'draft',
        providerConfigId: target.id,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: saved.id,
        action: 'insert',
        delta: { template_name: { old: null, new: saved.templateName } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: saved.id,
        eventType: 'template.created',
        payload: { templateId: saved.uuid, name: saved.templateName, language: saved.language },
      });
      return saved;
    });

    return this.finish(row, target, input.submit, false, issues);
  }

  /**
   * Edits a template that Meta has not approved (or refused). Saving alone never touches Meta. With `submit`, the Meta copy is
   * replaced: Meta has no in-place edit for a template under review, so it is deleted by name and created again, and the review
   * starts over. (Editing an approved template in place is Meta's own edit endpoint; Geta never built it and neither did we.)
   */
  async update(uuid: string, input: UpdateTemplateInput): Promise<TemplateSubmitResult> {
    const ctx = RequestContextStore.require();
    if (input.submit) this.requireSubmitRight();
    const prepared = prepareTemplate(input);
    this.assertOwnMedia(ctx.orgId, prepared.headerMediaKey);

    const { row, issues, edit, replacedKey } = await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!current) throw this.notFound();
      if (!EDITABLE.has(statusOf(current)) || !BUILDABLE_TYPES.has(current.templateType))
        throw new AppError(
          ERROR_CODES.TPL_NOT_EDITABLE,
          'Only a template that is a draft, in review, rejected, approved or paused can be edited. Copy it into a new template instead.',
          HttpStatus.CONFLICT,
        );
      if (current.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Template');
      if (current.providerConfigId === null)
        throw new AppError(
          ERROR_CODES.TPL_NO_CONNECTION,
          'This template has no WhatsApp number.',
          HttpStatus.CONFLICT,
        );
      // Meta keeps the name and language of a template it holds: an in-place edit cannot rename it.
      if (
        IN_PLACE.has(statusOf(current)) &&
        current.metaTemplateId &&
        (normalizeTemplateName(prepared.name) !== current.templateName.toLowerCase() ||
          prepared.language !== current.language)
      )
        throw AppError.validation('The name and the language of a live template cannot change', [
          { path: 'name', message: 'Create a new template to use another name or language.' },
        ]);

      // The same media type keeps the handle already stored unless a new one came with the form.
      const sameMedia = prepared.attachmentType === (current.attachmentType ?? null);
      const handle = prepared.headerHandle ?? (sameMedia ? current.attachmentFile : null);
      const mediaKey = prepared.headerMediaKey ?? (sameMedia ? current.headerMediaKey : null);
      const effective: PreparedTemplate = {
        ...prepared,
        headerHandle: prepared.attachmentType ? handle : null,
        headerMediaKey: prepared.attachmentType ? mediaKey : null,
        headerSampleUrl: prepared.headerSampleUrl ?? (sameMedia ? current.headerSampleUrl : null),
      };
      const found = lintPrepared(effective, Boolean(effective.headerHandle), input.name);
      if (input.submit) this.throwIfErrors(found);

      if (
        await this.repo.nameTaken(
          tx,
          ctx.orgId,
          current.providerConfigId,
          effective.name,
          effective.language,
          current.id,
        )
      )
        throw this.nameTaken();

      const saved = await this.repo.update(
        tx,
        ctx.orgId,
        current.id,
        {
          templateName: effective.name,
          language: effective.language,
          header: effective.header,
          templateBody: effective.body,
          footer: effective.footer,
          codeExpirationMinutes: effective.codeExpirationMinutes,
          buttons: effective.buttons,
          variableMap: effective.variableMap,
          category: effective.category,
          metaCategory: effective.metaCategory,
          templateType: effective.templateType,
          attachmentType: effective.attachmentType,
          attachmentFile: effective.headerHandle,
          headerSampleUrl: effective.headerSampleUrl,
          headerMediaKey: effective.headerMediaKey,
          headerLocation: effective.headerLocation,
          parameterFormat: effective.parameterFormat,
          // An in-place edit keeps its live status until Meta takes the edit.
          ...(input.submit && !inPlace(current) ? { status: 'pending' } : {}),
        },
        input.rowVersion,
      );
      if (!saved) throw AppError.rowVersionConflict('Template');
      await this.audit.record(tx, {
        module: MODULE,
        recordId: saved.id,
        action: 'update',
        delta: this.audit.diff(auditView(current), auditView(saved)),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: saved.id,
        eventType: 'template.updated',
        payload: { templateId: saved.uuid, name: saved.templateName },
      });
      const replaced =
        current.headerMediaKey && current.headerMediaKey !== saved.headerMediaKey
          ? current.headerMediaKey
          : null;
      return { row: saved, issues: found, edit: inPlace(current), replacedKey: replaced };
    });
    if (replacedKey) await this.releaseHeaderCopy(ctx.orgId, replacedKey);

    const target = input.submit ? await this.connection({ id: row.providerConfigId! }) : null;
    if (target) this.requireUsable(target);
    return this.finish(row, target, input.submit, true, issues, edit);
  }

  /** Sends a saved template to Meta, or sends it again after a refusal (TW-TPL-025). A template already on Meta is left as it is. */
  async submit(uuid: string, input: SubmitTemplateInput = {}): Promise<TemplateSubmitResult> {
    const { orgId } = RequestContextStore.require();
    const row = await this.require(uuid);
    if (row.metaTemplateId) return this.result(row, [], null);
    if (!BUILDABLE_TYPES.has(row.templateType))
      throw new AppError(
        ERROR_CODES.TPL_NOT_EDITABLE,
        'This template type cannot be sent from here.',
        HttpStatus.CONFLICT,
      );
    // Several numbers: the one the author picks (the media handle and the submit must come from the same account).
    const target = input.connectionId
      ? await this.connection({ uuid: input.connectionId })
      : row.providerConfigId === null
        ? null
        : await this.connection({ id: row.providerConfigId });
    if (!target) throw this.noConnection();
    this.requireUsable(target);
    const issues = lintOf(row, true);
    this.throwIfErrors(issues);
    await this.db.tx(async (tx) => {
      if (target.id !== row.providerConfigId) {
        // A template moves to another number only while Meta has never held it, and must not clash with a name already there.
        if (await this.repo.nameTaken(tx, orgId, target.id, row.templateName, row.language, row.id))
          throw this.nameTaken();
      }
      await this.repo.update(tx, orgId, row.id, {
        status: 'pending',
        providerConfigId: target.id,
      });
    });
    return this.finish(row, target, true, false, issues);
  }

  // --- delete ------------------------------------------------------------------------------------------------------

  /**
   * Deletes the local row, and the Meta copy first when there is one (TW-TPL-020). A Meta failure is logged and does not stop the
   * local delete (Geta's rule), but note the next sync would bring the template back while it still exists on Meta.
   * Refused while a processing or scheduled broadcast uses it; Reference did not check.
   */
  async remove(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    const row = await this.require(uuid);
    await this.assertNotInUse(orgId, row.id);

    if (row.metaTemplateId && row.providerConfigId !== null) {
      const target = await this.db.tx((tx) =>
        this.waba.resolveConnection(tx, orgId, { id: row.providerConfigId! }),
      );
      if (target?.conn) {
        try {
          // `hsm_id` narrows Meta's delete-by-name to this language, so a sibling language we also hold is not removed.
          await this.remote.deleteByName(target.conn, row.templateName, row.metaTemplateId);
        } catch (e) {
          this.logger.warn(
            { err: e, templateId: row.id },
            `[TPL] Meta delete failed: ${describeTemplateFailure(e).message}`,
          );
        }
      }
    }

    const storedHeader = await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, orgId, uuid, true);
      if (!current) return null;
      if ((await this.repo.activeBroadcasts(tx, orgId, current.id)) > 0) throw this.inUse();
      await this.repo.delete(tx, orgId, current.id);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: current.id,
        action: 'delete',
        delta: { template_name: { old: current.templateName, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: current.id,
        eventType: 'template.deleted',
        payload: { templateId: current.uuid, name: current.templateName },
      });
      return current.headerMediaKey;
    });
    if (storedHeader) await this.releaseHeaderCopy(orgId, storedHeader);
  }

  // --- header media ------------------------------------------------------------------------------------------------

  /** Uploads the header example to Meta and returns the handle the create payload needs (TW-TPL-009, 025). */
  async uploadMedia(
    connectionId: string,
    file: { originalname: string; buffer: Buffer } | undefined,
  ): Promise<UploadTemplateMediaResult> {
    this.requireSubmitRight();
    if (!file)
      throw AppError.validation('Choose a file to upload', [
        { path: 'file', message: 'Required.' },
      ]);
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    const rule = MEDIA_TYPES[ext];
    if (!rule)
      throw AppError.validation(
        'Meta takes a JPG or PNG image, an MP4 or 3GP video, or a PDF as the header example',
        [{ path: 'file', message: 'File type not supported.' }],
      );
    const checked = this.uploads.validate({
      filename: file.originalname,
      buffer: file.buffer,
      allow: [rule.kind],
      maxBytes: rule.maxBytes,
    });
    const target = await this.connection({ uuid: connectionId });
    this.requireUsable(target);
    // The stored copy is written first: a workspace without object storage is refused before Meta is asked for anything.
    const { orgId } = RequestContextStore.require();
    const key = `${templateMediaFolder(orgId)}${checked.storedName}`;
    const stored = await this.storage.put(key, file.buffer, checked.mime);
    if (!stored)
      throw AppError.validation(
        'Header files for templates need cloud object storage: ask the platform admin to turn it on',
        [{ path: 'file', message: 'Storage is local.' }],
      );
    let handle: string;
    try {
      handle = await this.remote.uploadHeaderMedia(target.conn!, {
        bytes: file.buffer,
        fileName: file.originalname,
        mimeType: checked.mime,
      });
    } catch (e) {
      await this.releaseHeaderCopy(orgId, key);
      throw providerProblem('Meta did not accept the file', e);
    }
    return {
      handle,
      fileName: file.originalname,
      mimeType: checked.mime,
      mediaKey: key,
      previewUrl: await this.storage.url(key, MEDIA_PREVIEW_TTL_S),
    };
  }

  // --- internals ---------------------------------------------------------------------------------------------------

  /**
   * A stored header the form names must be a file this workspace uploaded as a template header: its own folder, not any other
   * file of the workspace (exports, chat media). Anything else is refused before a write.
   */
  private assertOwnMedia(orgId: number, key: string | null): void {
    if (key && !isTemplateMediaKey(orgId, key))
      throw AppError.validation('The header file was not uploaded to this workspace', [
        { path: 'file', message: 'Upload the file again.' },
      ]);
  }

  /**
   * Deletes a stored header copy this workspace no longer uses (replaced, template deleted, Meta refused the upload). Never throws:
   * the row change or the refusal is already decided, and a file left behind is only storage.
   */
  private async releaseHeaderCopy(orgId: number, key: string): Promise<void> {
    if (!isTemplateMediaKey(orgId, key)) return;
    await this.storage
      .remove(key)
      .catch((err: unknown) =>
        this.logger.warn({ err: String(err) }, '[TPL] a stored header copy was not removed'),
      );
  }

  /**
   * Sends the saved row to Meta (when asked) and answers with the row as it then stands. The Meta call is outside any transaction.
   * Meta's refusal keeps the row (status `rejected`, Meta's words in `rejectionReason`); an outage keeps it as a draft.
   */
  private async finish(
    saved: TemplateRow,
    target: ResolvedWabaConnection | null,
    send: boolean,
    replace: boolean,
    issues: LintIssue[],
    inPlaceEdit = false,
  ): Promise<TemplateSubmitResult> {
    const warnings = issues.filter((i) => i.severity === 'warning').map(toIssue);
    if (!send || !target) return this.result(await this.reload(saved), warnings, null);
    if (inPlaceEdit && saved.metaTemplateId) return this.pushEdit(saved, target, warnings);
    return this.push(saved, target, replace, warnings);
  }

  private async push(
    row: TemplateRow,
    target: ResolvedWabaConnection,
    replace: boolean,
    warnings: TplLintIssue[],
  ): Promise<TemplateSubmitResult> {
    const { orgId } = RequestContextStore.require();
    const conn = target.conn!;
    const payload = buildMetaTemplate(draftOf(row));

    let removedOld = false;
    if (replace && row.metaTemplateId) {
      try {
        await this.remote.deleteByName(conn, payload.name, row.metaTemplateId);
        removedOld = true;
      } catch (e) {
        // Already gone on Meta, or Meta is not answering: the create below says which.
        this.logger.warn(
          { err: e, templateId: row.id },
          '[TPL] could not delete the old Meta copy',
        );
      }
    }

    let created: Awaited<ReturnType<WabaTemplatePort['create']>>;
    try {
      created = await this.remote.create(conn, {
        name: payload.name,
        language: payload.language,
        category: payload.category,
        components: payload.components,
        allowCategoryChange: payload.allow_category_change,
        parameterFormat: payload.parameter_format,
        ...(payload.message_send_ttl_seconds
          ? { messageSendTtlSeconds: payload.message_send_ttl_seconds }
          : {}),
      });
    } catch (e) {
      const failure = describeTemplateFailure(e);
      const next = await this.db.tx(async (tx) => {
        const patch: TemplatePatch = failure.retryable
          ? { status: 'draft' }
          : { status: 'rejected', rejectionReason: failure.message, rejectionReasonCode: null };
        const cleared: TemplatePatch = removedOld
          ? { metaTemplateId: null, metaStatus: null, approvedAt: null }
          : {};
        const updated =
          (await this.repo.update(tx, orgId, row.id, { ...patch, ...cleared })) ?? row;
        await this.audit.record(tx, {
          module: MODULE,
          recordId: row.id,
          action: 'update',
          delta: this.audit.diff({ status: row.status }, { status: updated.status }),
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE,
          aggregateId: row.id,
          eventType: 'template.submit_failed',
          payload: { templateId: row.uuid, reason: failure.message, retryable: failure.retryable },
        });
        return updated;
      });
      return this.result(next, warnings, failure.message);
    }

    // Meta may have recategorised or already decided; take its canonical reading (best effort).
    const canonical = await this.canonical(conn, row, created.id);
    const now = new Date();
    const state = statePatchFrom(
      canonical ?? {
        status: created.status,
        category: created.category,
        qualityScore: null,
        rejectedReason: null,
        correctCategory: null,
      },
      { ...currentOf(row), status: 'pending' },
      now,
      localStatusFor,
    );
    const next = await this.db.tx(async (tx) => {
      const updated =
        (await this.repo.update(tx, orgId, row.id, {
          ...columnsOfState(state),
          metaTemplateId: created.id,
          providerConfigId: target.id,
          submittedAt: now,
          rejectionReason: null,
        })) ?? row;
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: this.audit.diff(
          { status: row.status, meta_template_id: row.metaTemplateId },
          { status: updated.status, meta_template_id: updated.metaTemplateId },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'template.submitted',
        payload: {
          templateId: row.uuid,
          metaTemplateId: created.id,
          status: updated.status,
          metaStatus: updated.metaStatus,
        },
      });
      return updated;
    });
    return this.result(next, warnings, null);
  }

  /**
   * Sends an edit of an approved or paused template to Meta's edit endpoint (Reference `editOnMeta`). The edit is saved first; if
   * Meta refuses it the template keeps its live status and the reason comes back as `metaError` ("saved here, Meta said no").
   * Meta takes it back into review, so a success reads as pending.
   */
  private async pushEdit(
    row: TemplateRow,
    target: ResolvedWabaConnection,
    warnings: TplLintIssue[],
  ): Promise<TemplateSubmitResult> {
    const { orgId } = RequestContextStore.require();
    const payload = buildMetaTemplate(draftOf(row));
    try {
      await this.remote.edit(target.conn!, row.metaTemplateId!, {
        category: payload.category,
        components: payload.components,
      });
    } catch (e) {
      const failure = describeTemplateFailure(e);
      this.logger.warn({ err: e, templateId: row.id }, '[TPL] Meta refused the edit');
      return this.result(await this.reload(row), warnings, failure.message);
    }
    const now = new Date();
    const next = await this.db.tx(async (tx) => {
      const updated =
        (await this.repo.update(tx, orgId, row.id, {
          status: 'pending',
          metaStatus: 'PENDING',
          submittedAt: now,
          lastSyncedAt: now,
          rejectionReason: null,
        })) ?? row;
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: this.audit.diff({ status: row.status }, { status: updated.status }),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'template.submitted',
        payload: {
          templateId: row.uuid,
          metaTemplateId: row.metaTemplateId,
          status: updated.status,
          metaStatus: updated.metaStatus,
        },
      });
      return updated;
    });
    return this.result(next, warnings, null);
  }

  private async canonical(
    conn: NonNullable<ResolvedWabaConnection['conn']>,
    row: TemplateRow,
    metaId: string,
  ): Promise<RemoteTemplate | null> {
    try {
      const page = await this.remote.list(conn, { name: row.templateName, limit: 50 });
      return (
        page.items.find((t) => t.id === metaId) ??
        page.items.find(
          (t) =>
            t.name.toLowerCase() === row.templateName.toLowerCase() &&
            sameLanguage(t.language, row.language),
        ) ??
        null
      );
    } catch (e) {
      this.logger.warn({ err: e, templateId: row.id }, '[TPL] could not reconcile with Meta');
      return null;
    }
  }

  private async result(
    row: TemplateRow,
    warnings: TplLintIssue[],
    metaError: string | null,
  ): Promise<TemplateSubmitResult> {
    return { template: await detailWithMedia(this.storage, row), warnings, metaError };
  }

  private async reload(row: TemplateRow): Promise<TemplateRow> {
    const { orgId } = RequestContextStore.require();
    return (await this.db.tx((tx) => this.repo.findById(tx, orgId, row.id))) ?? row;
  }

  private async require(uuid: string): Promise<TemplateRow> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw this.notFound();
    return row;
  }

  /** The number a template is sent through; another organization's number is simply not found. */
  private async connection(
    ref: { uuid: string } | { id: number },
  ): Promise<ResolvedWabaConnection> {
    const { orgId } = RequestContextStore.require();
    const found = await this.db.tx((tx: Tx) => this.waba.resolveConnection(tx, orgId, ref));
    if (!found) throw AppError.notFound('WhatsApp number', 'uuid' in ref ? ref.uuid : undefined);
    return found;
  }

  private requireUsable(target: ResolvedWabaConnection): void {
    if (!target.conn || target.status !== 'connected') throw this.noConnection();
  }

  private requireSubmitRight(): void {
    const ctx = RequestContextStore.require();
    if (!ctx.grants || !this.rbac.can(ctx.grants, 'tpl.templates.sync').allowed)
      throw AppError.forbidden('tpl.templates.sync');
  }

  private throwIfErrors(issues: LintIssue[]): void {
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length === 0) return;
    throw new AppError(
      ERROR_CODES.TPL_LINT_FAILED,
      `Meta would reject this template: ${errors.map((e) => e.message).join(' ')}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      errors.map((e) => ({ path: e.field, message: e.message })),
    );
  }

  private async assertNotInUse(orgId: number, templateId: number): Promise<void> {
    const n = await this.db.tx((tx) => this.repo.activeBroadcasts(tx, orgId, templateId));
    if (n > 0) throw this.inUse();
  }

  private inUse(): AppError {
    return new AppError(
      ERROR_CODES.TPL_IN_USE,
      'A running or scheduled broadcast uses this template. Wait for it to finish or cancel it first.',
      HttpStatus.CONFLICT,
    );
  }

  private nameTaken(): AppError {
    return new AppError(
      ERROR_CODES.TPL_NAME_TAKEN,
      'A template with this name and language already exists on this WhatsApp number.',
      HttpStatus.CONFLICT,
      [{ path: 'name', message: 'Already used on this number for this language.' }],
    );
  }

  private noConnection(): AppError {
    return new AppError(
      ERROR_CODES.TPL_NO_CONNECTION,
      'This template has no connected WhatsApp number to send through. Connect or reconnect the number first.',
      HttpStatus.CONFLICT,
    );
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.TPL_NOT_FOUND, 'Template not found', HttpStatus.NOT_FOUND);
  }
}

const currentOf = (row: TemplateRow): CurrentState => ({
  status: row.status,
  metaCategory: row.metaCategory,
  qualityScore: row.qualityScore,
  approvedAt: row.approvedAt,
  pausedUntil: row.pausedUntil,
});

/** The fields worth an audit line (the body can be long, so only its presence of change shows). */
function auditView(r: TemplateRow): Record<string, unknown> {
  return {
    template_name: r.templateName,
    language: r.language,
    meta_category: r.metaCategory,
    header: r.header,
    template_body: r.templateBody,
    footer: r.footer,
    buttons: r.buttons,
    status: r.status,
  };
}
