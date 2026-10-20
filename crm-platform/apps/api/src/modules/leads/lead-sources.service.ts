import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateLeadSourceInput,
  type CreateLeadSourceResponse,
  type LeadEventDetailResponse,
  type LeadEventListResponse,
  type LeadFieldMapping,
  type LeadMappingPreviewResponse,
  type LeadSourceDefaults,
  type LeadSourceListResponse,
  type LeadSourceResponse,
  type ListLeadEventsQuery,
  type PreviewLeadMappingInput,
  type SpeedToLeadOptionsQuery,
  type SpeedToLeadOptionsResponse,
  type RotateLeadSourceTokenResponse,
  type SendTestLeadInput,
  type SendTestLeadResponse,
  type UpdateLeadSourceInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { EmailTemplatesReader } from '../email-templates';
import { TemplatesRepository } from '../message-templates';
import { LeadEventsRepository, type LeadEventRow } from './lead-events.repository';
import { LeadFirstMessageLookups } from './lead-first-message.lookups';
import { factsOf } from './lead-first-message.templates';
import { templateProblem } from './lead-first-reply.rules';
import { LeadHookAddressService, hookUrlFor } from './lead-hook-address';
import { LeadIngestService } from './lead-ingest.service';
import { leadConsentFromBody } from './lead-consent';
import type { NormalisedLead } from './lead-ingest.port';
import {
  MAPPABLE_FIELD_TYPES,
  coerceCustomValue,
  deriveExternalId,
  flattenPayload,
  resolveLeadFields,
} from './lead-mapping';
import { normaliseLeadPhone } from './lead-phone';
import { LeadsPlan } from './lead-plan';
import { defaultsOf } from './lead-rules';
import { LeadSourcesRepository, type LeadSourceRow } from './lead-sources.repository';
import { generateLeadToken, hashLeadToken, leadTokenHint } from './lead-token';
import { hookPathFor, toLeadEventResponse, toLeadSourceResponse } from './leads.mapper';

const MODULE_KEY = 'lead_sources';
const EVENTS_MODULE = 'lead_events';

const nameTaken = (): AppError =>
  new AppError(
    ERROR_CODES.LEAD_SOURCE_NAME_TAKEN,
    'Another lead source already has this name.',
    HttpStatus.CONFLICT,
  );

/** A unique-key violation, whether the driver or drizzle's wrapper is what reaches us. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Lead sources: the management side (spec L-04, L-05, L-11, L-12). Every write is one transaction holding the change, its audit row and
 * its outbox event. Secrets never leave: the URL token is returned once (create, rotate) and is stored as a hash, the shared secret is
 * sealed with the credentials key and only ever compared inside the public door.
 */
@Injectable()
export class LeadSourcesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeadSourcesRepository,
    private readonly events: LeadEventsRepository,
    private readonly ingest: LeadIngestService,
    private readonly plan: LeadsPlan,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly hookAddress: LeadHookAddressService,
    private readonly firstMessage: LeadFirstMessageLookups,
    private readonly templates: TemplatesRepository,
    private readonly emailTemplates: EmailTemplatesReader,
  ) {}

  /** What create and rotate hand back once: the token, its path, and the complete public address (or why there is none). */
  private secretsFor(token: string) {
    const base = this.hookAddress.current();
    return {
      token,
      hookPath: hookPathFor(token),
      hookUrl: hookUrlFor(base, token),
      hookUrlProblem: base.problem,
    };
  }

  // --- reads -----------------------------------------------------------------------------------------------------------------

  async list(): Promise<LeadSourceListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      data: (await this.repo.list(tx, ctx.orgId)).map(toLeadSourceResponse),
      hookAddress: this.hookAddress.current(),
    }));
  }

  async get(uuid: string): Promise<LeadSourceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => toLeadSourceResponse(await this.mustFind(tx, ctx.orgId, uuid)));
  }

  /**
   * What the speed-to-lead pickers offer for a channel. WhatsApp: approved templates a lead can fill from the contact alone (no media
   * or variable in the header, no dynamic button). SMS: approved SMS templates and the connected numbers. Email: shared templates
   * and the connected shared mailboxes. Names and a line of text; nothing of a contact.
   */
  async speedToLeadOptions(query: SpeedToLeadOptionsQuery): Promise<SpeedToLeadOptionsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const line = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (query.channel === 'email') {
        const [templates, boxes] = await Promise.all([
          this.firstMessage.sharedEmailTemplates(tx, ctx.orgId, 100),
          this.firstMessage.sharedMailboxes(tx, ctx.orgId),
        ]);
        return {
          templates: templates.map((t) => ({ id: t.uuid, name: t.name, preview: line(t.subject) })),
          senders: boxes.map((b) => ({ id: b.uuid, label: b.label })),
        };
      }
      const uuids = await this.firstMessage.approvedTemplateUuids(
        tx,
        ctx.orgId,
        query.channel,
        100,
      );
      const rows = await this.templates.findManyByUuids(tx, ctx.orgId, uuids);
      const sendable = rows.filter(
        (r) => query.channel === 'sms' || templateProblem(factsOf(r), new Date()) === null,
      );
      const senders =
        query.channel === 'sms' ? await this.firstMessage.smsSenders(tx, ctx.orgId) : [];
      return {
        templates: sendable.map((r) => ({
          id: r.uuid,
          name: r.templateName,
          preview: line(r.templateBody),
        })),
        senders: senders.map((x) => ({ id: x.uuid, label: x.label })),
      };
    });
  }

  // --- create / update / delete -------------------------------------------------------------------------------------------------

  async create(input: CreateLeadSourceInput): Promise<CreateLeadSourceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.plan.lockSources(tx, ctx.orgId);
      await this.plan.assertCanAddSource(ctx.orgId, await this.repo.count(tx, ctx.orgId));
      if (await this.repo.nameTaken(tx, ctx.orgId, input.name)) throw nameTaken();
      await this.validateMapping(tx, ctx.orgId, input.mapping);
      await this.validateDefaults(tx, ctx.orgId, input.defaults);

      const token = generateLeadToken();
      let id: number;
      try {
        id = await this.repo.insert(tx, ctx.orgId, {
          kind: input.kind,
          providerKey: input.providerKey ?? null,
          externalRef: null,
          name: input.name,
          tokenHash: hashLeadToken(token),
          tokenHint: leadTokenHint(token),
          secretEnc: input.secret ? this.crypto.encrypt(input.secret) : null,
          externalIdPath: input.externalIdPath ?? null,
          mapping: input.mapping,
          defaults: input.defaults,
          rawRetentionDays: input.rawRetentionDays,
          createdBy: ctx.userId,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'lead_source.created',
        payload: { uuid: row.uuid, name: row.name, kind: row.kind },
      });
      return { ...toLeadSourceResponse(row), ...this.secretsFor(token) };
    });
  }

  async update(uuid: string, input: UpdateLeadSourceInput): Promise<LeadSourceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.mustFind(tx, ctx.orgId, uuid);
      if (before.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Lead source');

      if (
        input.name !== undefined &&
        (await this.repo.nameTaken(tx, ctx.orgId, input.name, before.id))
      ) {
        throw nameTaken();
      }
      if (input.mapping) await this.validateMapping(tx, ctx.orgId, input.mapping);
      if (input.defaults) await this.validateDefaults(tx, ctx.orgId, input.defaults);

      let ok: boolean;
      try {
        ok = await this.repo.update(tx, ctx.orgId, before.id, input.rowVersion, {
          name: input.name,
          status: input.status,
          providerKey: input.providerKey,
          secretEnc:
            input.secret === undefined
              ? undefined
              : input.secret === null
                ? null
                : this.crypto.encrypt(input.secret),
          externalIdPath: input.externalIdPath,
          mapping: input.mapping,
          defaults: input.defaults,
          rawRetentionDays: input.rawRetentionDays,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }
      if (!ok) throw AppError.rowVersionConflict('Lead source');

      const after = (await this.repo.findById(tx, ctx.orgId, before.id))!;
      const delta = this.audit.diff(
        toLeadSourceResponse(before) as unknown as Record<string, unknown>,
        toLeadSourceResponse(after) as unknown as Record<string, unknown>,
      );
      delete delta.rowVersion;
      delete delta.updatedAt;
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: before.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: before.id,
        eventType: 'lead_source.updated',
        payload: { uuid, name: after.name, status: after.status, changed: Object.keys(delta) },
      });
      return toLeadSourceResponse(after);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid);
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'lead_source.deleted',
        payload: { uuid, name: row.name, kind: row.kind },
      });
    });
  }

  /** A new URL token at once; the old URL stops working with this commit. Shown once, like at creation. */
  async rotateToken(uuid: string): Promise<RotateLeadSourceTokenResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, ctx.orgId, uuid);
      if (row.kind !== 'webhook') {
        throw AppError.validation('Only a webhook source has a URL token.', [
          { path: 'kind', message: 'not_a_webhook' },
        ]);
      }
      const token = generateLeadToken();
      await this.repo.rotateToken(
        tx,
        ctx.orgId,
        row.id,
        hashLeadToken(token),
        leadTokenHint(token),
      );
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        // The hint, never the token or its hash.
        delta: { tokenHint: { old: row.tokenHint, new: leadTokenHint(token) } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'lead_source.token_rotated',
        payload: { uuid, name: row.name },
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      return { ...toLeadSourceResponse(after), ...this.secretsFor(token) };
    });
  }

  // --- mapping preview and test ------------------------------------------------------------------------------------------------

  /**
   * What the mapping would make of a payload, without writing anything. The payload is the one posted, a stored event's, or the newest
   * real one the source still holds. Opening a stored payload shows personal data, so the preview needs the manage permission and writes
   * an audit row when it reads one.
   */
  async previewMapping(
    uuid: string,
    input: PreviewLeadMappingInput,
  ): Promise<LeadMappingPreviewResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const source = await this.mustFind(tx, ctx.orgId, uuid);
      const mapping: LeadFieldMapping = input.mapping ?? (source.mapping as LeadFieldMapping);
      const defaults: LeadSourceDefaults = input.defaults ?? defaultsOf(source);
      const externalIdPath =
        input.externalIdPath !== undefined ? input.externalIdPath : source.externalIdPath;
      if (input.mapping) await this.validateMapping(tx, ctx.orgId, mapping);

      let basedOn: LeadMappingPreviewResponse['basedOn'] = 'none';
      let event: LeadEventRow | undefined;
      let lead: NormalisedLead | null = null;
      if (input.payload) {
        basedOn = 'payload';
        lead = { externalId: '', fields: flattenPayload(input.payload), raw: input.payload };
      } else {
        event = input.eventId
          ? await this.events.findByUuid(tx, ctx.orgId, source.id, input.eventId)
          : await this.events.latestWithPayload(tx, ctx.orgId, source.id);
        if (input.eventId && !event) throw AppError.notFound('Lead event', input.eventId);
        if (event?.payload) {
          basedOn = 'event';
          lead = event.payload as unknown as NormalisedLead;
          await this.audit.record(tx, {
            module: EVENTS_MODULE,
            recordId: event.id,
            action: 'export',
            delta: { payload: { old: null, new: 'previewed' } },
          });
        }
      }
      if (!lead) {
        return {
          basedOn: 'none',
          eventId: null,
          externalId: null,
          contact: {
            name: null,
            firstName: null,
            lastName: null,
            email: null,
            phoneRaw: null,
            phone: null,
          },
          customFields: {},
          attribution: { platform: null, campaign: null, adset: null, ad: null, form: null },
          availablePaths: [],
          usable: false,
          reasons: ['no_payload'],
        };
      }

      const fields = { ...flattenPayload(lead.raw), ...lead.fields };
      const resolved = resolveLeadFields(
        { fields, raw: lead.raw, attribution: lead.attribution },
        mapping,
      );
      const phone = normaliseLeadPhone(resolved.phoneRaw, defaults.countryCode);
      const types = await this.repo.contactFieldTypes(tx, ctx.orgId, Object.keys(resolved.custom));
      const custom: Record<string, unknown> = {};
      for (const [key, text] of Object.entries(resolved.custom)) {
        const type = types.get(key);
        const value = type ? coerceCustomValue(type, text) : undefined;
        if (value !== undefined) custom[key] = value;
      }
      const reasons = [...resolved.notes];
      if (!phone && !resolved.email)
        reasons.push(resolved.phoneRaw ? 'invalid_phone' : 'no_contact_point');
      if (resolved.phoneRaw && !phone && resolved.email) reasons.push('phone_unreadable');
      const externalId =
        basedOn === 'event' && event
          ? event.externalId
          : deriveExternalId({ fields, raw: lead.raw }, lead.raw ?? input.payload, externalIdPath)
              .externalId;
      return {
        basedOn,
        eventId: event?.uuid ?? null,
        externalId,
        contact: {
          name: resolved.name,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
          email: resolved.email,
          phoneRaw: resolved.phoneRaw,
          phone: phone?.e164 ?? null,
        },
        customFields: custom,
        attribution: resolved.attribution,
        availablePaths: Object.keys(fields).slice(0, 300),
        usable: Boolean(phone ?? resolved.email),
        reasons,
      };
    });
  }

  /** A sample lead through the real pipeline: stored, mapped, deduplicated, assigned, flagged as a test, and never notified. */
  async sendTest(uuid: string, input: SendTestLeadInput): Promise<SendTestLeadResponse> {
    const ctx = RequestContextStore.require();
    const source = await this.db.tx((tx) => this.mustFind(tx, ctx.orgId, uuid));
    if (source.status !== 'active') throw sourcePaused();
    const body = input.payload ?? sampleBody(source);
    // The test reads the same `consent` the real door reads, so it shows the lead exactly as it will arrive; a test lead never grants.
    const consent = leadConsentFromBody(body);
    const lead: NormalisedLead = {
      externalId: `test-${randomUUID()}`,
      receivedAt: new Date().toISOString(),
      fields: flattenPayload(body),
      ...(consent ? { consent } : {}),
      raw: body,
    };
    const outcome = await this.ingest.process(ctx.orgId, source.id, lead, { isTest: true });
    return this.db.tx(async (tx) => {
      const event = outcome.eventId
        ? await this.events.findById(tx, ctx.orgId, outcome.eventId)
        : undefined;
      if (!event) throw AppError.notFound('Lead event');
      return { event: toLeadEventResponse(event) };
    });
  }

  // --- events ---------------------------------------------------------------------------------------------------------------------

  async listEvents(uuid: string, query: ListLeadEventsQuery): Promise<LeadEventListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const source = await this.mustFind(tx, ctx.orgId, uuid);
      const rows = await this.events.list(tx, ctx.orgId, source.id, {
        status: query.status,
        isTest: query.isTest,
        limit: query.limit,
        cursor: query.cursor,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toLeadEventResponse), page };
    });
  }

  /** One event with its stored payload. The payload is personal data: opening it is audited (action `export`). */
  async getEvent(uuid: string, eventUuid: string): Promise<LeadEventDetailResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const source = await this.mustFind(tx, ctx.orgId, uuid);
      const event = await this.events.findByUuid(tx, ctx.orgId, source.id, eventUuid);
      if (!event) throw AppError.notFound('Lead event', eventUuid);
      if (event.payload !== null) {
        await this.audit.record(tx, {
          module: EVENTS_MODULE,
          recordId: event.id,
          action: 'export',
          delta: { payload: { old: null, new: 'viewed' } },
        });
      }
      return { ...toLeadEventResponse(event), payload: event.payload };
    });
  }

  /**
   * Re-runs a `needs_review` or `failed` lead after the admin fixed the mapping, the default country code or the plan: from the stored
   * payload, under the source's CURRENT settings. A lead that cannot be retried is a 409 with the reason, never a silent no-op.
   */
  async retryEvent(uuid: string, eventUuid: string): Promise<SendTestLeadResponse> {
    const ctx = RequestContextStore.require();
    const prepared = await this.db.tx(async (tx) => {
      const source = await this.mustFind(tx, ctx.orgId, uuid);
      const event = await this.events.findByUuid(tx, ctx.orgId, source.id, eventUuid, true);
      if (!event) throw AppError.notFound('Lead event', eventUuid);
      if (source.status !== 'active') throw sourcePaused();
      if (event.status !== 'needs_review' && event.status !== 'failed') {
        throw new AppError(
          ERROR_CODES.LEAD_EVENT_NOT_RETRYABLE,
          'Only a lead that needs review or failed can be retried.',
          HttpStatus.CONFLICT,
        );
      }
      if (event.payload === null) {
        throw new AppError(
          ERROR_CODES.LEAD_PAYLOAD_PURGED,
          "This lead's payload was purged after its retention period, so there is nothing to retry.",
          HttpStatus.CONFLICT,
        );
      }
      await this.events.markRetry(tx, ctx.orgId, event.id);
      await this.audit.record(tx, {
        module: EVENTS_MODULE,
        recordId: event.id,
        action: 'update',
        delta: {
          status: { old: event.status, new: 'received' },
          attempts: { old: event.attempts, new: event.attempts + 1 },
        },
      });
      return {
        source,
        event: (await this.events.findById(tx, ctx.orgId, event.id))!,
        payload: event.payload,
      };
    });
    await this.ingest.run(
      ctx.orgId,
      prepared.source,
      prepared.event,
      prepared.payload as unknown as NormalisedLead,
      {},
    );
    return this.db.tx(async (tx) => ({
      event: toLeadEventResponse((await this.events.findById(tx, ctx.orgId, prepared.event.id))!),
    }));
  }

  // --- validation -----------------------------------------------------------------------------------------------------------------

  private async mustFind(tx: Tx, orgId: number, uuid: string): Promise<LeadSourceRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Lead source', uuid);
    return row;
  }

  /** A mapped custom field must be an active contact property a lead can write into. */
  private async validateMapping(tx: Tx, orgId: number, mapping: LeadFieldMapping): Promise<void> {
    const keys = Object.keys(mapping.customFields ?? {});
    if (keys.length === 0) return;
    const types = await this.repo.contactFieldTypes(tx, orgId, keys);
    const bad = keys.flatMap((k) => {
      const type = types.get(k);
      if (!type) return [{ path: `mapping.customFields.${k}`, message: 'unknown_property' }];
      if (!MAPPABLE_FIELD_TYPES.has(type))
        return [{ path: `mapping.customFields.${k}`, message: 'not_mappable' }];
      return [];
    });
    if (bad.length > 0) {
      throw new AppError(
        ERROR_CODES.LEAD_MAPPING_INVALID,
        'The mapping names contact properties that do not exist or cannot be filled from a lead.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        bad,
      );
    }
  }

  /**
   * The first message of a new lead (BL-014): a source that switches it on must name a template this channel can actually send, and,
   * when it names a sender, one that is connected. Nothing is checked while it is off, so a half-made setting can be saved as a draft.
   */
  private async checkSpeedToLead(
    tx: Tx,
    orgId: number,
    s: LeadSourceDefaults['speedToLead'],
    bad: Array<{ path: string; message: string }>,
  ): Promise<void> {
    if (!s.enabled) return;
    const at = 'defaults.speedToLead';
    if (!s.templateId) {
      bad.push({ path: `${at}.templateId`, message: 'template_required' });
      return;
    }
    if (s.channel === 'email') {
      try {
        await this.emailTemplates.purposeForReply(tx, orgId, -1, s.templateId);
      } catch {
        bad.push({ path: `${at}.templateId`, message: 'template_not_found' });
      }
    } else {
      const tpl = await this.templates.findByUuid(tx, orgId, s.templateId);
      const channel = tpl ? await this.firstMessage.templateChannel(tx, orgId, s.templateId) : null;
      if (!tpl || channel !== (s.channel === 'sms' ? 'sms' : 'whatsapp')) {
        bad.push({ path: `${at}.templateId`, message: 'template_not_found' });
      } else if (
        s.channel === 'sms'
          ? tpl.status !== 'approved' && tpl.status !== 'public'
          : templateProblem(factsOf(tpl), new Date()) !== null
      ) {
        bad.push({ path: `${at}.templateId`, message: 'template_not_sendable' });
      }
    }
    if (s.senderId && s.channel !== 'whatsapp') {
      const sender =
        s.channel === 'sms'
          ? await this.firstMessage.smsSender(tx, orgId, s.senderId)
          : await this.firstMessage.mailbox(tx, orgId, s.senderId);
      if (!sender) bad.push({ path: `${at}.senderId`, message: 'sender_not_found' });
    }
  }

  /** Every user, pipeline, stage and lifecycle stage a source points at must belong to this workspace (and the users be active). */
  private async validateDefaults(tx: Tx, orgId: number, d: LeadSourceDefaults): Promise<void> {
    const bad: Array<{ path: string; message: string }> = [];
    const checkUsers = async (path: string, uuids: string[]) => {
      const unique = [...new Set(uuids)];
      const found = await this.repo.activeUsers(tx, orgId, unique);
      const have = new Set(found.map((u) => u.uuid));
      for (const u of unique)
        if (!have.has(u)) bad.push({ path, message: `unknown_or_inactive_user:${u}` });
    };
    await checkUsers('defaults.owner.userIds', d.owner.userIds);
    await checkUsers('defaults.notify.userIds', d.notify.userIds);

    if (d.deal.stageId && !d.deal.pipelineId) {
      bad.push({ path: 'defaults.deal.stageId', message: 'pipeline_required' });
    }
    if (
      d.deal.pipelineId &&
      (await this.repo.pipelineExists(tx, orgId, d.deal.pipelineId)) === undefined
    ) {
      bad.push({ path: 'defaults.deal.pipelineId', message: 'unknown_pipeline' });
    }
    if (d.deal.stageId) {
      const stage = await this.repo.stageOfPipeline(tx, orgId, d.deal.stageId);
      const pipeline = d.deal.pipelineId
        ? await this.repo.pipelineExists(tx, orgId, d.deal.pipelineId)
        : undefined;
      if (!stage) bad.push({ path: 'defaults.deal.stageId', message: 'unknown_stage' });
      else if (pipeline !== undefined && stage.pipelineId !== pipeline) {
        bad.push({ path: 'defaults.deal.stageId', message: 'stage_not_in_pipeline' });
      }
    }
    if (d.flowId && !(await this.repo.flowExists(tx, orgId, d.flowId))) {
      bad.push({ path: 'defaults.flowId', message: 'unknown_flow' });
    }
    if (d.lifecycleStage && !(await this.repo.stageUsable(tx, orgId, d.lifecycleStage))) {
      bad.push({ path: 'defaults.lifecycleStage', message: 'unknown_or_lost_stage' });
    }
    await this.checkSpeedToLead(tx, orgId, d.speedToLead, bad);
    if (bad.length > 0) {
      throw new AppError(
        ERROR_CODES.LEAD_DEFAULTS_INVALID,
        "The source's defaults point at something that is not in this workspace.",
        HttpStatus.UNPROCESSABLE_ENTITY,
        bad,
      );
    }
  }
}

const sourcePaused = (): AppError =>
  new AppError(
    ERROR_CODES.LEAD_SOURCE_PAUSED,
    'This source is paused. Resume it to test or retry a lead.',
    HttpStatus.CONFLICT,
  );

/** Sets `a.b.c` on an object, creating the levels; a path with an index is kept as a flat key (a sample need not be nested to map). */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (/\[\d+\]/.test(path)) {
    obj[path] = value;
    return;
  }
  const parts = path.split('.');
  let cur = obj;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      cur[part] = value;
      return;
    }
    const next = cur[part];
    cur[part] = typeof next === 'object' && next !== null ? next : {};
    cur = cur[part] as Record<string, unknown>;
  });
}

/** A recognisable sample lead built from the source's mapping: every mapped field filled, fictional contact details (555-01xx numbers). */
export function sampleBody(
  source: Pick<LeadSourceRow, 'mapping' | 'name'>,
): Record<string, unknown> {
  const m = (source.mapping ?? {}) as LeadFieldMapping;
  const tag = Math.floor(Math.random() * 90_000 + 10_000);
  const body: Record<string, unknown> = {};
  setPath(body, m.name ?? 'name', 'Test Lead');
  setPath(body, m.email ?? 'email', `test.lead.${tag}@example.test`);
  // 202-555-01xx: the numbers set aside for fiction, so a test lead can never be somebody's real number.
  setPath(body, m.phone ?? 'phone', `+120255501${String(tag % 100).padStart(2, '0')}`);
  for (const [, path] of Object.entries(m.customFields ?? {})) setPath(body, path, 'Test value');
  const a = m.attribution ?? {};
  setPath(body, a.campaign ?? 'campaign', 'Test campaign');
  setPath(body, a.adset ?? 'adset', 'Test ad set');
  setPath(body, a.ad ?? 'ad', 'Test ad');
  setPath(body, a.form ?? 'form', 'Test form');
  return body;
}
