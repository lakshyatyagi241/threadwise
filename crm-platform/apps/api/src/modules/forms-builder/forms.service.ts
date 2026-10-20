import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  formDefinitionSchema,
  formLiveSettingsSchema,
  type CreateFormInput,
  type DuplicateFormInput,
  type FormActionInput,
  type FormDefinition,
  type FormDetail,
  type FormLiveSettings,
  type FormStatus,
  type FormSummary,
  type FormVersionList,
  type ListFormsQuery,
  type PageResponse,
  type RecordScope,
  type UpdateFormInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CaptchaService, HtmlSanitizerService } from '../auth';
import {
  WorkspaceGatewayResolver,
  supportsPaymentLinks,
} from '../checkout-orders-merchant-payments';
import { ContactsRepository } from '../crm';
import { publishProblems, type PublishContext } from './form-definition-rules';
import { newPublicKey } from './form-key';
import { FormsPlan } from './form-plan';
import { blankDefinition, formTemplate } from './form-templates';
import {
  readDefinition,
  toFormDetail,
  toFormSummary,
  toFormVersion,
  type ShareBases,
} from './forms.mapper';
import { FormsRepository, formScopeCondition, type FormRow } from './forms.repository';

export const FORM_MODULE = 'web_forms';
const EVENT_MODULE = 'forms';

const nameTaken = (): AppError =>
  new AppError(
    ERROR_CODES.FORMS_NAME_TAKEN,
    'A form with this name already exists.',
    HttpStatus.CONFLICT,
  );

const stateInvalid = (what: string, status: FormStatus): AppError =>
  new AppError(
    ERROR_CODES.FORMS_STATE_INVALID,
    `The form is ${status}: it cannot be ${what}.`,
    HttpStatus.CONFLICT,
    [{ path: 'status', message: status }],
  );

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Forms, the admin side (docs/specs/forms-builder-app.md 4 and 7.1). Every write is one transaction holding the change, its audit row and
 * its outbox event. A form is a DRAFT document plus live settings; Publish freezes the draft as a new immutable version, and only that
 * version is ever shown to the public or used to validate a submission.
 *
 * Rich text (the description, a paragraph block, the thank-you message) is sanitised when it is SAVED, and again when it is rendered.
 * The plan feature `form_builder` gates every route (the controllers carry `@RequirePlanFeature`); the plan's `forms` cap is enforced
 * here, where a form is made or comes back (create, duplicate, resume from archive).
 */
@Injectable()
export class FormsService {
  private readonly bases: ShareBases;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FormsRepository,
    private readonly plan: FormsPlan,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly sanitizer: HtmlSanitizerService,
    private readonly contacts: ContactsRepository,
    private readonly gateways: WorkspaceGatewayResolver,
    private readonly captcha: CaptchaService,
    config: ConfigService<Env, true>,
  ) {
    this.bases = {
      webUrl: config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, ''),
      apiUrl: config.get('APP_URL', { infer: true }).replace(/\/+$/, ''),
    };
  }

  // --- reads ---------------------------------------------------------------------------------------------------------------------------

  async list(query: ListFormsQuery, scope: RecordScope): Promise<PageResponse<FormSummary>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        status: query.status,
        includeArchived: query.includeArchived === true,
        q: query.q,
        scope: formScopeCondition(ctx.orgId, scope, ctx.userId),
        cursor: query.cursor,
        limit: query.limit,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toFormSummary), page };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, scope);
      return toFormDetail(row, this.bases);
    });
  }

  async versions(uuid: string, scope: RecordScope): Promise<FormVersionList> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid, scope);
      const versions = await this.repo.listVersions(tx, ctx.orgId, row.id);
      return { data: versions.map((v) => toFormVersion(v, row.publishedVersionId)) };
    });
  }

  // --- writes --------------------------------------------------------------------------------------------------------------------------

  async create(input: CreateFormInput): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.plan.lockForms(tx, ctx.orgId);
      await this.plan.assertCanAddForm(ctx.orgId, await this.repo.countActive(tx, ctx.orgId));
      if (await this.nameInUse(tx, ctx.orgId, input.name)) throw nameTaken();

      let definition: FormDefinition;
      if (input.templateKey) {
        const t = formTemplate(input.templateKey);
        if (!t) {
          throw new AppError(
            ERROR_CODES.FORMS_TEMPLATE_UNKNOWN,
            'There is no such template.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'templateKey', message: 'unknown_template' }],
          );
        }
        definition = t.definition;
      } else {
        definition = input.definition ?? blankDefinition(input.name);
      }
      const settings = formLiveSettingsSchema.parse(input.settings ?? {});
      await this.validateSettings(tx, ctx.orgId, settings);

      let id: number;
      try {
        id = await this.repo.insert(tx, ctx.orgId, {
          name: input.name,
          publicKey: newPublicKey(),
          definition: this.sanitizeDefinition(definition) as unknown as Record<string, unknown>,
          createdBy: ctx.userId,
          settings,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: id,
        action: 'insert',
        delta: { name: { old: null, new: row.name } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: EVENT_MODULE,
        aggregateId: id,
        eventType: 'form.created',
        payload: { uuid: row.uuid, name: row.name, template: input.templateKey ?? null },
      });
      return toFormDetail(row, this.bases);
    });
  }

  async update(uuid: string, input: UpdateFormInput, scope: RecordScope): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.mustFind(tx, ctx.orgId, uuid, scope, true);
      if (before.status === 'archived') throw stateInvalid('edited', before.status);
      if (before.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Form');
      if (input.name !== undefined && (await this.nameInUse(tx, ctx.orgId, input.name, before.id)))
        throw nameTaken();

      const merged = input.settings ? this.mergeSettings(before, input.settings) : undefined;
      if (merged) await this.validateSettings(tx, ctx.orgId, merged);
      const definition = input.definition
        ? (this.sanitizeDefinition(input.definition) as unknown as Record<string, unknown>)
        : undefined;

      let ok: boolean;
      try {
        ok = await this.repo.update(tx, ctx.orgId, before.id, input.rowVersion, {
          name: input.name,
          definition,
          ...(merged
            ? {
                allowedOrigins: merged.allowedOrigins,
                captchaMode: merged.captchaMode,
                honeypot: merged.honeypot,
                notify: merged.notify,
                retentionDays: merged.retentionDays,
                ownerRule: merged.ownerRule,
                rateLimits: merged.rateLimits,
              }
            : {}),
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }
      if (!ok) throw AppError.rowVersionConflict('Form');

      const after = (await this.repo.findById(tx, ctx.orgId, before.id))!;
      const delta = this.audit.diff(auditShape(before), auditShape(after));
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: FORM_MODULE,
          recordId: before.id,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: EVENT_MODULE,
          aggregateId: before.id,
          eventType: 'form.updated',
          payload: { uuid: after.uuid, name: after.name, changed: Object.keys(delta) },
        });
      }
      return toFormDetail(after, this.bases);
    });
  }

  /**
   * Freezes the draft as the next version and makes it live. Refused (422 FORMS_PUBLISH_INVALID, one `path: reason` per problem) when the
   * form cannot do its job: no way to reach the person, a required CRM property the form does not collect, a binding the registry does
   * not know. Publishing a form whose draft is already live changes nothing and returns it as it is.
   */
  async publish(uuid: string, input: FormActionInput, scope: RecordScope): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.mustFind(tx, ctx.orgId, uuid, scope, true);
      if (form.status === 'archived') throw stateInvalid('published', form.status);
      if (form.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Form');

      const def = readDefinition(form.draftDefinition);
      const problems = publishProblems(
        def,
        await this.publishContext(tx, ctx.orgId, def, form.captchaMode),
      );
      if (problems.length > 0) {
        throw new AppError(
          ERROR_CODES.FORMS_PUBLISH_INVALID,
          'The form cannot be published yet. Fix the listed problems and try again.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          problems.map((p) => ({ path: p.path, message: p.reason })),
        );
      }
      // The draft is what is live: there is nothing to freeze. A live form is returned as it is; a paused one is simply opened again.
      const unchanged = !form.hasUnpublishedChanges && form.publishedVersionId !== null;
      if (unchanged && form.status === 'published') return toFormDetail(form, this.bases);

      const version = unchanged
        ? form.publishedVersion!
        : await this.repo.nextVersion(tx, ctx.orgId, form.id);
      const versionId = unchanged
        ? form.publishedVersionId!
        : await this.repo.insertVersion(tx, ctx.orgId, {
            formId: form.id,
            version,
            definition: form.draftDefinition,
            publishedBy: ctx.userId,
          });
      const ok = await this.repo.update(tx, ctx.orgId, form.id, input.rowVersion, {
        status: 'published',
        publishedVersionId: versionId,
      });
      if (!ok) throw AppError.rowVersionConflict('Form');
      const after = (await this.repo.findById(tx, ctx.orgId, form.id))!;
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: form.id,
        action: 'update',
        delta: {
          status: { old: form.status, new: 'published' },
          version: { old: form.publishedVersion, new: version },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: EVENT_MODULE,
        aggregateId: form.id,
        eventType: 'form.published',
        payload: { uuid: after.uuid, name: after.name, version },
      });
      return toFormDetail(after, this.bases);
    });
  }

  async pause(uuid: string, input: FormActionInput, scope: RecordScope): Promise<FormDetail> {
    return this.transition(uuid, input, scope, 'form.paused', (f) => {
      if (f.status !== 'published') throw stateInvalid('paused', f.status);
      return 'paused';
    });
  }

  /** Back to the public: a paused form to published; an archived one to published when it has a live version, else to draft. */
  async resume(uuid: string, input: FormActionInput, scope: RecordScope): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.transition(
      uuid,
      input,
      scope,
      'form.resumed',
      (f) => {
        if (f.status === 'paused') return 'published';
        if (f.status === 'archived') return f.publishedVersionId !== null ? 'published' : 'draft';
        throw stateInvalid('resumed', f.status);
      },
      async (tx, f) => {
        // An archived form freed its place under the plan's cap; coming back takes one again.
        if (f.status === 'archived') {
          await this.plan.lockForms(tx, ctx.orgId);
          await this.plan.assertCanAddForm(ctx.orgId, await this.repo.countActive(tx, ctx.orgId));
        }
        if (f.status === 'archived' && (await this.nameInUse(tx, ctx.orgId, f.name, f.id)))
          throw nameTaken();
      },
    );
  }

  async archive(uuid: string, input: FormActionInput, scope: RecordScope): Promise<FormDetail> {
    return this.transition(uuid, input, scope, 'form.archived', (f) => {
      if (f.status === 'archived') throw stateInvalid('archived', f.status);
      return 'archived';
    });
  }

  async duplicate(
    uuid: string,
    input: DuplicateFormInput,
    scope: RecordScope,
  ): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const source = await this.mustFind(tx, ctx.orgId, uuid, scope);
      if (source.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Form');
      await this.plan.lockForms(tx, ctx.orgId);
      await this.plan.assertCanAddForm(ctx.orgId, await this.repo.countActive(tx, ctx.orgId));
      const name = await this.freeName(tx, ctx.orgId, input.name ?? `Copy of ${source.name}`);

      const settings = toDetailSettings(source);
      const id = await this.repo.insert(tx, ctx.orgId, {
        name,
        publicKey: newPublicKey(),
        definition: source.draftDefinition,
        createdBy: ctx.userId,
        settings,
      });
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: id,
        action: 'insert',
        delta: { name: { old: null, new: name }, duplicatedFrom: { old: null, new: source.uuid } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: EVENT_MODULE,
        aggregateId: id,
        eventType: 'form.created',
        payload: { uuid: row.uuid, name: row.name, duplicatedFrom: source.uuid },
      });
      return toFormDetail(row, this.bases);
    });
  }

  /** Copies a version into the draft: the form is not republished, and the version stays in its history. */
  async restoreVersion(
    uuid: string,
    version: number,
    input: FormActionInput,
    scope: RecordScope,
  ): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.mustFind(tx, ctx.orgId, uuid, scope, true);
      if (form.status === 'archived') throw stateInvalid('edited', form.status);
      if (form.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Form');
      const v = await this.repo.findVersion(tx, ctx.orgId, form.id, version);
      if (!v) {
        throw new AppError(
          ERROR_CODES.FORMS_VERSION_UNKNOWN,
          'There is no such version.',
          HttpStatus.NOT_FOUND,
        );
      }
      const ok = await this.repo.update(tx, ctx.orgId, form.id, input.rowVersion, {
        definition: v.definition,
      });
      if (!ok) throw AppError.rowVersionConflict('Form');
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: form.id,
        action: 'update',
        delta: { draftRestoredFromVersion: { old: null, new: version } },
      });
      return toFormDetail((await this.repo.findById(tx, ctx.orgId, form.id))!, this.bases);
    });
  }

  /** A new public key: the old URL, embed snippet and loader answer 404 at once. */
  async rotateKey(uuid: string, input: FormActionInput, scope: RecordScope): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.mustFind(tx, ctx.orgId, uuid, scope, true);
      if (form.status === 'archived') throw stateInvalid('changed', form.status);
      if (form.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Form');
      const ok = await this.repo.update(tx, ctx.orgId, form.id, input.rowVersion, {
        publicKey: newPublicKey(),
      });
      if (!ok) throw AppError.rowVersionConflict('Form');
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: form.id,
        action: 'update',
        delta: { publicKey: { old: 'rotated', new: 'rotated' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: EVENT_MODULE,
        aggregateId: form.id,
        eventType: 'form.key_rotated',
        payload: { uuid: form.uuid, name: form.name },
      });
      return toFormDetail((await this.repo.findById(tx, ctx.orgId, form.id))!, this.bases);
    });
  }

  /**
   * Deletes a form for good, with its versions, submissions and events (the contacts and companies its submissions made are ordinary
   * CRM records and stay). Only a form nobody can reach: a draft or an archived one. A live form is archived first.
   */
  async delete(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const form = await this.mustFind(tx, ctx.orgId, uuid, scope, true);
      if (form.status === 'published' || form.status === 'paused')
        throw stateInvalid('deleted', form.status);
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: form.id,
        action: 'delete',
        delta: {
          name: { old: form.name, new: null },
          submissions: { old: form.submissions, new: 0 },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: EVENT_MODULE,
        aggregateId: form.id,
        eventType: 'form.deleted',
        payload: { uuid: form.uuid, name: form.name },
      });
      await this.repo.deleteEvents(tx, ctx.orgId, form.id);
      await this.repo.deleteById(tx, ctx.orgId, form.id);
    });
  }

  // --- internals ------------------------------------------------------------------------------------------------------------------------

  private async transition(
    uuid: string,
    input: FormActionInput,
    scope: RecordScope,
    event: string,
    next: (f: FormRow) => FormStatus,
    guard?: (tx: Tx, f: FormRow) => Promise<void>,
  ): Promise<FormDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.mustFind(tx, ctx.orgId, uuid, scope, true);
      const status = next(form);
      if (form.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Form');
      if (guard) await guard(tx, form);
      const ok = await this.repo.update(tx, ctx.orgId, form.id, input.rowVersion, { status });
      if (!ok) throw AppError.rowVersionConflict('Form');
      await this.audit.record(tx, {
        module: FORM_MODULE,
        recordId: form.id,
        action: 'update',
        delta: { status: { old: form.status, new: status } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: EVENT_MODULE,
        aggregateId: form.id,
        eventType: event,
        payload: { uuid: form.uuid, name: form.name, status },
      });
      return toFormDetail((await this.repo.findById(tx, ctx.orgId, form.id))!, this.bases);
    });
  }

  /** The form, or 404: a form outside the caller's record scope does not exist for them. */
  private async mustFind(
    tx: Tx,
    orgId: number,
    uuid: string,
    scope: RecordScope,
    forUpdate = false,
  ): Promise<FormRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid, forUpdate);
    if (!row || !(await this.inScope(tx, orgId, row, scope))) throw AppError.notFound('Form', uuid);
    return row;
  }

  private async inScope(tx: Tx, orgId: number, row: FormRow, scope: RecordScope): Promise<boolean> {
    if (scope === 'all') return true;
    const actor = RequestContextStore.require().userId;
    if (!actor) return false;
    if (row.createdBy === actor) return true;
    if (scope === 'own' || row.createdBy === null) return false;
    return this.repo.isTeammate(tx, orgId, actor, row.createdBy);
  }

  private async nameInUse(
    tx: Tx,
    orgId: number,
    name: string,
    exceptId?: number,
  ): Promise<boolean> {
    return this.repo.nameTaken(tx, orgId, name, exceptId);
  }

  /** "Copy of X", then "Copy of X 2", "Copy of X 3": the first name nobody uses. */
  private async freeName(tx: Tx, orgId: number, wanted: string): Promise<string> {
    const base = wanted.slice(0, 116);
    if (!(await this.nameInUse(tx, orgId, base))) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base} ${i}`;
      if (!(await this.nameInUse(tx, orgId, candidate))) return candidate;
    }
    return `${base} ${Date.now()}`.slice(0, 120);
  }

  private mergeSettings(row: FormRow, patch: Partial<FormLiveSettings>): FormLiveSettings {
    return formLiveSettingsSchema.parse({ ...toDetailSettings(row), ...patch });
  }

  /** The users named in the owner rule and the notification list must be active members of THIS workspace. */
  private async validateSettings(tx: Tx, orgId: number, s: FormLiveSettings): Promise<void> {
    const check = async (path: string, uuids: string[]) => {
      const active = await this.repo.activeUsers(tx, orgId, uuids);
      const known = new Set(active.map((u) => u.uuid));
      const missing = uuids.filter((u) => !known.has(u));
      if (missing.length > 0) {
        throw AppError.validation(
          'A user in the settings is not an active member of this workspace.',
          [{ path, message: 'unknown_user' }],
        );
      }
    };
    await check('settings.ownerRule.userIds', s.ownerRule.userIds);
    await check('settings.notify.userIds', s.notify.userIds);
  }

  /** What Publish compares the draft with: the registry's properties and required rules, and the lifecycle stages. */
  private async publishContext(
    tx: Tx,
    orgId: number,
    def: FormDefinition,
    captchaMode: string,
  ): Promise<PublishContext> {
    const [contactProps, companyProps, rules] = await Promise.all([
      this.repo.registryProperties(tx, orgId, 'contacts'),
      this.repo.registryProperties(tx, orgId, 'companies'),
      this.contacts.requiredRules(tx, orgId),
    ]);
    const stage = def.after.lifecycleStage;
    const stageOk = stage ? await this.repo.stageUsable(tx, orgId, stage) : true;
    // Only asked when the form takes payment: a form without it never depends on the gateway.
    const gateway = def.payment.enabled ? await this.gateways.resolve(orgId, null, { tx }) : null;
    // "Always on" needs a provider; asked only then, so a form that does not rely on it never waits for the settings lookup.
    const captchaMissing =
      captchaMode === 'on' ? (await this.captcha.publicConfig()) === null : undefined;
    return {
      captchaMissing,
      paymentGatewayReady: def.payment.enabled
        ? gateway !== null && supportsPaymentLinks(gateway.slug)
        : undefined,
      contactProps: new Map(contactProps.map((p) => [p.key, { type: p.type, label: p.label }])),
      companyProps: new Map(companyProps.map((p) => [p.key, { type: p.type, label: p.label }])),
      // A rule that depends on another property's value is not required of every submission: only the unconditional ones are.
      contactRequired: rules
        .filter((r) => r.conditions.length === 0)
        .map((r) => ({ key: r.key, label: r.label })),
      stageUsable: (s) => (s === stage ? stageOk : false),
    };
  }

  /** Rich text a person typed is sanitised on the way in; the renderer sanitises it again on the way out. */
  private sanitizeDefinition(def: FormDefinition): FormDefinition {
    const clean = (html: string | undefined) =>
      html === undefined ? undefined : this.sanitizer.sanitize(html);
    return formDefinitionSchema.parse({
      ...def,
      description: clean(def.description),
      settings: { ...def.settings, successMessage: clean(def.settings.successMessage) ?? '' },
      steps: def.steps.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.type === 'paragraph' ? { ...b, html: clean(b.html) ?? '' } : b,
        ),
      })),
    });
  }
}

/** The settings of a form row as the live-settings schema reads them. */
function toDetailSettings(row: FormRow): FormLiveSettings {
  return formLiveSettingsSchema.parse({
    ownerRule: row.ownerRule,
    notify: row.notify,
    allowedOrigins: row.allowedOrigins,
    captchaMode: row.captchaMode,
    honeypot: row.honeypot,
    retentionDays: row.retentionDays,
    rateLimits: row.rateLimits,
  });
}

/** What the audit diff compares: the settings and the name, never the whole definition (a count of blocks stands for it). */
function auditShape(row: FormRow): Record<string, unknown> {
  const def = row.draftDefinition as { steps?: Array<{ blocks?: unknown[] }> };
  return {
    name: row.name,
    blocks: (def.steps ?? []).reduce((n, s) => n + (s.blocks?.length ?? 0), 0),
    definition: JSON.stringify(row.draftDefinition).length,
    ownerRule: row.ownerRule,
    notify: row.notify,
    allowedOrigins: row.allowedOrigins,
    captchaMode: row.captchaMode,
    honeypot: row.honeypot,
    retentionDays: row.retentionDays,
    rateLimits: row.rateLimits,
  };
}
