import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  createTemplateInputSchema,
  type AdoptAppointmentTemplateInput,
  type AppointmentMessageKind,
  type AppointmentTemplate,
  type AppointmentTemplateResult,
  type AppointmentTemplatesResponse,
  type CreateAppointmentTemplateInput,
  type ListAppointmentTemplatesQuery,
  type PredefinedAppointmentTemplatesResponse,
  type TemplateDetail,
  type UpdateAppointmentTemplateInput,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { TemplateSyncService, TemplatesService } from '../message-templates';
import { AppointmentChannelsRepository, type LibraryRow } from './appointment-channels.repository';
import { toApiTemplate } from './appointment-template.mapper';
import {
  LIBRARY_PLACEHOLDERS,
  PREDEFINED_TEMPLATES,
  WHATSAPP_PLACEHOLDERS,
  findPredefined,
  libraryStatusOfWa,
  toWhatsappBody,
  unknownPlaceholders,
  variablesOf,
  waNameOf,
} from './appointment-template.rules';

const MODULE = 'appointment_message_templates';

const invalid = (
  message: string,
  path: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
): AppError =>
  new AppError(ERROR_CODES.APPT_TEMPLATE_INVALID, message, status, [{ path, message }]);

/**
 * The appointment message library (BL-351, BL-352). The owner adopts a built-in message with one click and edits it:
 *
 *  - an EMAIL message lives in this table and is usable at once;
 *  - a WHATSAPP message is created as a normal WhatsApp template (`TemplatesService`: the same lint, plan cap, Meta submission and sync
 *    as the template library) and this row links to it. Its status is read from that template every time, so the library cannot show
 *    "approved" for a template Meta has since paused, and only an approved one can be chosen by a booking type or sent.
 *
 * Nothing here talks to Meta itself; the submission goes through the existing machinery, which uses the sandbox/fake provider in tests.
 */
@Injectable()
export class AppointmentTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AppointmentChannelsRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly templates: TemplatesService,
    private readonly sync: TemplateSyncService,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------------------------------

  async predefined(): Promise<PredefinedAppointmentTemplatesResponse> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.listLibrary(tx, orgId));
    return {
      data: PREDEFINED_TEMPLATES.map((p) => {
        const wa = p.channel === 'whatsapp' ? toWhatsappBody(p.body) : null;
        return {
          key: p.key,
          kind: p.kind,
          channel: p.channel,
          language: p.language,
          name: p.name,
          subject: p.subject,
          body: p.body,
          variables: variablesOf(p.subject, p.body),
          metaCategory: wa ? p.metaCategory : null,
          adoptedId:
            rows.find(
              (r) =>
                r.predefinedKey === p.key && r.channel === p.channel && r.language === p.language,
            )?.uuid ?? null,
        };
      }),
      placeholders: [...LIBRARY_PLACEHOLDERS],
      whatsappPlaceholders: [...WHATSAPP_PLACEHOLDERS],
    };
  }

  async list(query: ListAppointmentTemplatesQuery): Promise<AppointmentTemplatesResponse> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) =>
      this.repo.listLibrary(tx, orgId, { kind: query.kind, channel: query.channel }),
    );
    const data = rows.map((r) => toApiTemplate(r));
    return {
      data: query.usable === undefined ? data : data.filter((t) => t.usable === query.usable),
    };
  }

  async get(uuid: string): Promise<AppointmentTemplate> {
    const { orgId } = RequestContextStore.require();
    return toApiTemplate(await this.require(orgId, uuid));
  }

  // --- adopt and create ---------------------------------------------------------------------------------------------------------

  async adopt(input: AdoptAppointmentTemplateInput): Promise<AppointmentTemplateResult> {
    const ctx = RequestContextStore.require();
    const built = findPredefined(input.key, input.channel, input.language);
    if (!built) {
      throw invalid(
        'There is no built-in message for that kind, channel and language yet. Create your own instead.',
        'key',
      );
    }
    if (input.channel === 'email') {
      const uuid = await this.db.tx(async (tx) => {
        await this.assertFree(tx, ctx.orgId, built.key, built.channel, built.language);
        const id = await this.repo.insertLibrary(tx, ctx.orgId, {
          kind: built.kind,
          channel: 'email',
          language: built.language,
          name: built.name,
          subject: built.subject,
          body: built.body,
          variables: variablesOf(built.subject, built.body),
          waTemplateId: null,
          predefinedKey: built.key,
          userId: ctx.userId,
        });
        await this.audit.record(tx, {
          module: MODULE,
          recordId: id,
          action: 'insert',
          delta: { name: { old: null, new: built.name } },
        });
        return (await this.repo.findLibraryById(tx, ctx.orgId, id))!.uuid;
      });
      return { template: await this.get(uuid), metaError: null };
    }

    // WhatsApp: a template in the WhatsApp library first, then the link.
    this.requireWhatsappRights(input.submit);
    const wa = toWhatsappBody(built.body);
    if (!wa.ok) throw invalid(wa.problem, 'body');
    const connectionId = await this.connectionFor(input.connectionId);
    await this.db.tx((tx) =>
      this.assertFree(tx, ctx.orgId, built.key, built.channel, built.language),
    );

    const created = await this.templates.create(
      createTemplateInputSchema.parse({
        name: waNameOf(built.kind, built.language),
        language: built.language,
        metaCategory: built.metaCategory ?? 'UTILITY',
        templateType: 'standard',
        body: wa.body,
        variableMap: wa.variableMap,
        parameterFormat: 'POSITIONAL',
        connectionId,
        submit: input.submit,
      }),
    );
    const uuid = await this.linkNew(created.template, {
      kind: built.kind,
      language: built.language,
      name: built.name,
      body: built.body,
      predefinedKey: built.key,
    });
    return { template: await this.get(uuid), metaError: created.metaError };
  }

  /** The owner's own email message. */
  async create(input: CreateAppointmentTemplateInput): Promise<AppointmentTemplateResult> {
    const ctx = RequestContextStore.require();
    const stray = unknownPlaceholders(`${input.subject ?? ''} ${input.body}`);
    if (stray.length > 0) {
      throw invalid(`Unknown placeholder ${stray.map((s) => `{{${s}}}`).join(', ')}.`, 'body');
    }
    const uuid = await this.db.tx(async (tx) => {
      if (await this.repo.nameTaken(tx, ctx.orgId, { ...input, channel: 'email' }))
        throw this.nameTaken();
      const id = await this.repo.insertLibrary(tx, ctx.orgId, {
        kind: input.kind,
        channel: 'email',
        language: input.language,
        name: input.name,
        subject: input.subject && input.subject !== '' ? input.subject : null,
        body: input.body,
        variables: variablesOf(input.subject, input.body),
        waTemplateId: null,
        predefinedKey: null,
        userId: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'insert',
        delta: { name: { old: null, new: input.name } },
      });
      return (await this.repo.findLibraryById(tx, ctx.orgId, id))!.uuid;
    });
    return { template: await this.get(uuid), metaError: null };
  }

  // --- edit, submit, refresh, delete ----------------------------------------------------------------------------------------------

  async update(
    uuid: string,
    input: UpdateAppointmentTemplateInput,
  ): Promise<AppointmentTemplateResult> {
    const ctx = RequestContextStore.require();
    const row = await this.require(ctx.orgId, uuid);
    if (row.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Message');
    const stray = unknownPlaceholders(`${input.subject ?? ''} ${input.body ?? ''}`);
    if (stray.length > 0) {
      throw invalid(`Unknown placeholder ${stray.map((s) => `{{${s}}}`).join(', ')}.`, 'body');
    }

    if (row.channel === 'email') {
      await this.db.tx(async (tx) => {
        const name = input.name ?? row.name;
        if (
          name !== row.name &&
          (await this.repo.nameTaken(tx, ctx.orgId, { ...row, name }, row.id))
        )
          throw this.nameTaken();
        const body = input.body ?? row.body;
        const subject = input.subject === undefined ? row.subject : input.subject || null;
        await this.repo.updateLibrary(tx, ctx.orgId, row.id, {
          name,
          subject,
          body,
          variables: variablesOf(subject, body),
          isActive: input.isActive,
        });
        await this.audit.record(tx, {
          module: MODULE,
          recordId: row.id,
          action: 'update',
          delta: {
            ...(name !== row.name ? { name: { old: row.name, new: name } } : {}),
            ...(body !== row.body ? { body: { old: '(changed)', new: '(changed)' } } : {}),
            ...(input.isActive !== undefined && input.isActive !== row.isActive
              ? { is_active: { old: row.isActive, new: input.isActive } }
              : {}),
          },
        });
      });
      return { template: await this.get(uuid), metaError: null };
    }

    // WhatsApp: the text is the WhatsApp template's; only a draft or a rejected one can change, and it can go back to Meta.
    const current = toApiTemplate(row);
    let metaError: string | null = null;
    if (input.body !== undefined && input.body !== row.body) {
      if (current.status !== 'draft' && current.status !== 'rejected') {
        throw invalid(
          'A template that Meta is reviewing or has approved cannot be edited here. Create a new message from the built-in one, or edit it in the WhatsApp templates screen.',
          'body',
          HttpStatus.CONFLICT,
        );
      }
    }
    if (input.submit || input.body !== undefined) this.requireWhatsappRights(input.submit);
    if (!row.waUuid)
      throw invalid(
        'This message has no WhatsApp template behind it.',
        'waTemplateId',
        HttpStatus.CONFLICT,
      );
    const wa = toWhatsappBody(input.body ?? row.body);
    if (!wa.ok) throw invalid(wa.problem, 'body');

    if (input.body !== undefined && input.body !== row.body) {
      const detail = await this.templates.get(row.waUuid);
      const result = await this.templates.update(
        row.waUuid,
        this.waUpdateOf(detail, wa, input.submit),
      );
      metaError = result.metaError;
    } else if (input.submit) {
      const result = await this.templates.submit(row.waUuid);
      metaError = result.metaError;
    }
    await this.db.tx(async (tx) => {
      const name = input.name ?? row.name;
      if (name !== row.name && (await this.repo.nameTaken(tx, ctx.orgId, { ...row, name }, row.id)))
        throw this.nameTaken();
      await this.repo.updateLibrary(tx, ctx.orgId, row.id, {
        name,
        body: input.body ?? row.body,
        variables: wa.variables,
        isActive: input.isActive,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: {
          ...(input.body !== undefined ? { body: { old: '(changed)', new: '(changed)' } } : {}),
        },
      });
    });
    return { template: await this.get(uuid), metaError };
  }

  /** Sends a WhatsApp message to Meta for review (a draft, or one Meta refused). */
  async submit(uuid: string): Promise<AppointmentTemplateResult> {
    const ctx = RequestContextStore.require();
    const row = await this.require(ctx.orgId, uuid);
    if (row.channel !== 'whatsapp' || !row.waUuid) {
      throw invalid('Only a WhatsApp message is sent to Meta.', 'channel', HttpStatus.CONFLICT);
    }
    this.requireWhatsappRights(true);
    const result = await this.templates.submit(row.waUuid);
    return { template: await this.get(uuid), metaError: result.metaError };
  }

  /** Reads the status from Meta again (the library shows the template's own status, so this is all a refresh has to do). */
  async refresh(uuid: string): Promise<AppointmentTemplate> {
    const ctx = RequestContextStore.require();
    const row = await this.require(ctx.orgId, uuid);
    if (row.channel === 'whatsapp' && row.waUuid) {
      this.requireWhatsappRights(true);
      await this.sync.refresh(row.waUuid);
    }
    return this.get(uuid);
  }

  /** Removes the message from the library. A WhatsApp template stays in the WhatsApp template library (delete it there). */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findLibrary(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Message', uuid);
      if (row.usedByTypes > 0) {
        throw new AppError(
          ERROR_CODES.APPT_TEMPLATE_IN_USE,
          `${row.usedByTypes} booking type(s) use this message. Choose another one there first.`,
          HttpStatus.CONFLICT,
        );
      }
      await this.repo.deleteLibrary(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { name: { old: row.name, new: null } },
      });
    });
  }

  // --- reminder packs (BL-424) --------------------------------------------------------------------------------------------------

  /** Whether a Cloud API WhatsApp number is connected, so a template can be created and sent to Meta. */
  async hasWhatsappConnection(): Promise<boolean> {
    const { orgId } = RequestContextStore.require();
    const dir = await this.db.tx((tx) => this.repo.senders(tx, orgId));
    return dir.whatsapp.length > 0;
  }

  /** The library status of a WhatsApp template by its Meta name and language, read live; null when this workspace has none. */
  async waStatusByName(
    name: string,
    language: string,
  ): Promise<AppointmentTemplate['status'] | null> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.findWaByName(tx, orgId, name, language));
    if (!row) return null;
    return libraryStatusOfWa({
      status: row.status,
      metaStatus: row.metaStatus,
      pausedUntil: row.pausedUntil,
      rejectionReason: row.rejectionReason,
    }).status;
  }

  /**
   * The email message of a pack step: made once per workspace (the key is `pack:<pack>:<step>`), active at once. A second booking type
   * that adopts the same pack reuses it, and an owner's edit of it is never overwritten.
   */
  async ensurePackEmail(v: {
    key: string;
    kind: AppointmentMessageKind;
    language: string;
    name: string;
    subject: string;
    body: string;
  }): Promise<{ uuid: string; created: boolean }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await this.findPackRow(tx, ctx.orgId, v.key, 'email', v.language);
      if (found) return { uuid: found.uuid, created: false };
      const id = await this.repo.insertLibrary(tx, ctx.orgId, {
        kind: v.kind,
        channel: 'email',
        language: v.language,
        name: v.name,
        subject: v.subject,
        body: v.body,
        variables: variablesOf(v.subject, v.body),
        waTemplateId: null,
        predefinedKey: v.key,
        userId: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'insert',
        delta: { name: { old: null, new: v.name } },
      });
      return { uuid: (await this.repo.findLibraryById(tx, ctx.orgId, id))!.uuid, created: true };
    });
  }

  /**
   * The WhatsApp message of a pack step: a WhatsApp template named `appt_<pack>_<step>_<lang>` created ONCE per workspace as a draft
   * and sent to Meta unless `submit` is false, plus the library row that links it. Created again by nobody: a second booking type finds
   * the first one's template by its name. `metaError` is Meta's own sentence when the submission was refused (the template stays a
   * draft). Needs the template permissions, like the library's own WhatsApp adoption.
   */
  async ensurePackWhatsapp(v: {
    key: string;
    kind: AppointmentMessageKind;
    language: string;
    name: string;
    templateName: string;
    body: string;
    category: 'UTILITY' | 'MARKETING';
    buttons: string[];
    submit: boolean;
  }): Promise<{ uuid: string; waUuid: string; created: boolean; metaError: string | null }> {
    const ctx = RequestContextStore.require();
    const have = await this.db.tx(async (tx) => {
      const lib = await this.findPackRow(tx, ctx.orgId, v.key, 'whatsapp', v.language);
      if (lib?.waUuid) return { uuid: lib.uuid, waUuid: lib.waUuid };
      return null;
    });
    if (have) return { ...have, created: false, metaError: null };

    this.requireWhatsappRights(v.submit);
    const wa = toWhatsappBody(v.body);
    if (!wa.ok) throw invalid(wa.problem, 'body');
    // The template may already exist under that name (made by an earlier adoption whose library row was removed): link it.
    const existing = await this.db.tx((tx) =>
      this.findWaByName(tx, ctx.orgId, v.templateName, v.language),
    );
    let waUuid: string;
    let metaError: string | null = null;
    let waId: number;
    if (existing) {
      waUuid = existing.uuid;
      waId = existing.id;
    } else {
      const connectionId = await this.connectionFor(undefined);
      const created = await this.templates.create(
        createTemplateInputSchema.parse({
          name: v.templateName,
          language: v.language,
          metaCategory: v.category,
          templateType: 'standard',
          body: wa.body,
          variableMap: wa.variableMap,
          parameterFormat: 'POSITIONAL',
          buttons: v.buttons.map((text) => ({ type: 'QUICK_REPLY', text })),
          connectionId,
          submit: v.submit,
        }),
      );
      waUuid = created.template.id;
      metaError = created.metaError;
      const found = await this.db.tx((tx) =>
        this.findWaByName(tx, ctx.orgId, v.templateName, v.language),
      );
      waId = found!.id;
    }
    const uuid = await this.db.tx(async (tx) => {
      const id = await this.repo.insertLibrary(tx, ctx.orgId, {
        kind: v.kind,
        channel: 'whatsapp',
        language: v.language,
        name: v.name,
        subject: null,
        body: v.body,
        variables: variablesOf(v.body),
        waTemplateId: waId,
        predefinedKey: v.key,
        userId: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'insert',
        delta: { name: { old: null, new: v.name } },
      });
      return (await this.repo.findLibraryById(tx, ctx.orgId, id))!.uuid;
    });
    return { uuid, waUuid, created: !existing, metaError };
  }

  private async findPackRow(
    tx: Tx,
    orgId: number,
    key: string,
    channel: 'email' | 'whatsapp',
    language: string,
  ): Promise<LibraryRow | undefined> {
    const res = await tx.execute(sql`
      SELECT uuid FROM appointment_message_templates
      WHERE org_id = ${orgId} AND predefined_key = ${key} AND channel = ${channel} AND language = ${language} LIMIT 1`);
    const uuid = (res.rows as Array<Record<string, unknown>>)[0]?.uuid as string | undefined;
    return uuid ? this.repo.findLibrary(tx, orgId, uuid) : undefined;
  }

  private async findWaByName(
    tx: Tx,
    orgId: number,
    name: string,
    language: string,
  ): Promise<
    | {
        id: number;
        uuid: string;
        status: string;
        metaStatus: string | null;
        pausedUntil: Date | null;
        rejectionReason: string | null;
      }
    | undefined
  > {
    const res = await tx.execute(sql`
      SELECT id, uuid, status, meta_status, paused_until, rejection_reason FROM wa_templates
      WHERE org_id = ${orgId} AND template_name = ${name} AND language = ${language} ORDER BY id LIMIT 1`);
    const r = (res.rows as Array<Record<string, unknown>>)[0];
    return r
      ? {
          id: Number(r.id),
          uuid: r.uuid as string,
          status: r.status as string,
          metaStatus: (r.meta_status as string | null) ?? null,
          pausedUntil: r.paused_until ? new Date(r.paused_until as string) : null,
          rejectionReason: (r.rejection_reason as string | null) ?? null,
        }
      : undefined;
  }

  // --- helpers ------------------------------------------------------------------------------------------------------------------

  private async require(orgId: number, uuid: string): Promise<LibraryRow> {
    const row = await this.db.tx((tx) => this.repo.findLibrary(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Message', uuid);
    return row;
  }

  private nameTaken(): AppError {
    return new AppError(
      ERROR_CODES.CONFLICT,
      'A message with that name already exists for this kind, channel and language.',
      HttpStatus.CONFLICT,
    );
  }

  private async assertFree(
    tx: Tx,
    orgId: number,
    key: string,
    channel: string,
    language: string,
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT 1 FROM appointment_message_templates
      WHERE org_id = ${orgId} AND predefined_key = ${key} AND channel = ${channel} AND language = ${language} LIMIT 1`);
    if (res.rows.length > 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'That built-in message is already in your library. Edit it there.',
        HttpStatus.CONFLICT,
      );
    }
  }

  /** Submitting a template to Meta also needs the template permissions (the same keys as the WhatsApp templates screen). */
  private requireWhatsappRights(submit: boolean): void {
    const ctx = RequestContextStore.require();
    const need = submit ? ['tpl.templates.create', 'tpl.templates.sync'] : ['tpl.templates.create'];
    for (const key of need) {
      if (!ctx.grants || !this.rbac.can(ctx.grants, key).allowed) throw AppError.forbidden(key);
    }
  }

  /** The WhatsApp number to submit through: the one asked for, else the owner's default, else the first connected Cloud API number. */
  private async connectionFor(requested: string | undefined): Promise<string> {
    const { orgId } = RequestContextStore.require();
    const { dir, gate } = await this.db.tx(async (tx) => ({
      dir: await this.repo.senders(tx, orgId),
      gate: await this.repo.gate(tx, orgId, 'whatsapp'),
    }));
    if (requested) {
      if (!dir.whatsapp.some((s) => s.uuid === requested)) {
        throw new AppError(
          ERROR_CODES.APPT_CHANNEL_SENDER_INVALID,
          'That WhatsApp number is not connected through the Cloud API in this workspace.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'connectionId', message: requested }],
        );
      }
      return requested;
    }
    const chosen = dir.whatsapp.find((s) => s.id === gate.defaultSenderId) ?? dir.whatsapp[0];
    if (!chosen) {
      throw new AppError(
        ERROR_CODES.TPL_NO_CONNECTION,
        'Connect a WhatsApp Cloud API number in Settings first: a template is submitted through one.',
        HttpStatus.CONFLICT,
      );
    }
    return chosen.uuid;
  }

  /** Links the WhatsApp template that was just created to a new library row. */
  private async linkNew(
    template: TemplateDetail,
    v: {
      kind: LibraryRow['kind'];
      language: string;
      name: string;
      body: string;
      predefinedKey: string;
    },
  ): Promise<string> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT id FROM wa_templates WHERE org_id = ${ctx.orgId} AND uuid = ${template.id}::uuid`,
      );
      const waId = Number((found.rows as Array<Record<string, unknown>>)[0]?.id);
      const id = await this.repo.insertLibrary(tx, ctx.orgId, {
        kind: v.kind,
        channel: 'whatsapp',
        language: v.language,
        name: v.name,
        subject: null,
        body: v.body,
        variables: variablesOf(v.body),
        waTemplateId: waId,
        predefinedKey: v.predefinedKey,
        userId: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'insert',
        delta: { name: { old: null, new: v.name } },
      });
      return (await this.repo.findLibraryById(tx, ctx.orgId, id))!.uuid;
    });
  }

  /** The WhatsApp template as an edit with a new text (everything else the template has stays). */
  private waUpdateOf(
    detail: TemplateDetail,
    wa: Extract<ReturnType<typeof toWhatsappBody>, { ok: true }>,
    submit: boolean,
  ): UpdateTemplateInput {
    return {
      name: detail.name,
      language: detail.language,
      metaCategory: (detail.metaCategory ?? 'UTILITY') as UpdateTemplateInput['metaCategory'],
      templateType: detail.templateType as UpdateTemplateInput['templateType'],
      header: detail.header,
      attachmentType: detail.attachmentType,
      headerLocation: detail.headerLocation,
      body: wa.body,
      footer: detail.footer,
      buttons: detail.buttons,
      variableMap: { ...detail.variableMap, body: wa.variableMap.body },
      parameterFormat: detail.parameterFormat,
      rowVersion: detail.rowVersion,
      submit,
    };
  }
}
