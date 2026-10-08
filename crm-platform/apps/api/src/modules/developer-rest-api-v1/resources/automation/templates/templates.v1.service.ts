import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateTemplateInput,
  type PageInfo,
  type UpdateTemplateInput,
  type V1CreateTemplate,
  type V1SendTemplate,
  type V1Template,
  type V1TemplateSendResult,
  type V1UpdateTemplate,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { AppError } from '../../../../../common/errors/app-error';
import { encodeCursor } from '../../../../../common/pagination/cursor';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { UploadPolicyService } from '../../../../auth';
import {
  ChannelsFacade,
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../../chat-conversations';
import { ContactResolverService } from '../../../../crm';
import {
  TemplatesRepository,
  TemplatesService,
  tokensOf,
  type TemplateRow,
} from '../../../../message-templates';
import { WabaConnectionsRepository } from '../../../../whatsapp-cloud-api-waba';
import { v1Error, withV1NotFound } from '../automation-errors';
import { guardHeaderMedia, type UploadedHeader } from './header-upload.guard';
import {
  buttonsOfInput,
  metaCategoryOfInput,
  sourceOfDetail,
  sourceOfRow,
  toPublicTemplate,
} from './template-public.mapper';
import { bodyValuesOf, recipientDigits, renderBody, sendBlockOf } from './template-send.rules';

const NOT_FOUND = 'Template not found.';
/** How many raw rows one filtered page may look through before it answers short (a workspace of mostly unsendable templates). */
const MAX_SCAN_BATCHES = 10;

const unsupported = (field: string, why: string) =>
  AppError.validation(`${field} is not supported by this API yet.`, [
    { path: field, message: why },
  ]);

/**
 * The templates of `/api/v1` over the template domain's own services. Reads use the barrel-exported repository (the same read the team
 * inbox uses) because the public shape needs the stored columns the service's list summary leaves out; every write goes through
 * `TemplatesService`, so audit, outbox, the plan cap and the name rule are the dashboard's.
 */
@Injectable()
export class V1TemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TemplatesRepository,
    private readonly templates: TemplatesService,
    private readonly connections: WabaConnectionsRepository,
    private readonly channels: ChannelsFacade,
    private readonly contacts: ContactResolverService,
    private readonly uploads: UploadPolicyService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  // --- reads (TW-API-030, 033) ---------------------------------------------------------------------------------------------

  /**
   * Sendable templates only, newest first (Reference cannot list the others either). Sendable here: approved locally, a Meta template id
   * present, Meta says APPROVED, not paused, and the number it goes through is still connected (a template with no number is kept).
   */
  async list(q: {
    limit: number;
    cursor?: string;
  }): Promise<{ items: V1Template[]; page: PageInfo }> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const numbers = new Map(
        (await this.connections.list(tx, orgId)).map((c) => [c.uuid, c.status] as const),
      );
      const sendable = (r: TemplateRow): boolean => {
        if (!r.metaTemplateId || r.metaStatus !== 'APPROVED') return false;
        if (r.pausedUntil && r.pausedUntil.getTime() > Date.now()) return false;
        if (
          r.providerConfigId !== null &&
          (!r.connectionUuid || numbers.get(r.connectionUuid) !== 'connected')
        )
          return false;
        return true;
      };

      const kept: TemplateRow[] = [];
      let cursor = q.cursor;
      let exhausted = false;
      let last: TemplateRow | null = null;
      for (let i = 0; i < MAX_SCAN_BATCHES && kept.length <= q.limit && !exhausted; i++) {
        const batch = await this.repo.list(tx, orgId, {
          limit: q.limit,
          cursor,
          status: 'approved',
        });
        const rows = batch.slice(0, q.limit);
        exhausted = batch.length <= q.limit;
        for (const r of rows) {
          last = r;
          if (sendable(r)) kept.push(r);
          if (kept.length > q.limit) break;
        }
        if (rows.length === 0) break;
        const tail = rows[rows.length - 1]!;
        cursor = encodeCursor({
          createdAt: tail.createdAt,
          id: tail.id,
          createdAtIso: tail.createdAtIso,
        });
      }
      const page = kept.slice(0, q.limit);
      const hasMore = kept.length > q.limit || !exhausted;
      const edge = kept.length > q.limit ? page[page.length - 1]! : last;
      return {
        items: page.map((r) => toPublicTemplate(sourceOfRow(r))),
        page: {
          limit: q.limit,
          hasMore,
          nextCursor:
            hasMore && edge
              ? encodeCursor({
                  createdAt: edge.createdAt,
                  id: edge.id,
                  createdAtIso: edge.createdAtIso,
                })
              : null,
        },
      };
    });
  }

  async show(uuid: string): Promise<V1Template> {
    return toPublicTemplate(sourceOfRow(await this.row(uuid)));
  }

  // --- writes (TW-API-032, 034, 035) ---------------------------------------------------------------------------------------

  /**
   * Reference's create never talks to Meta, so this saves a draft (`submit: false`) on the workspace's primary WhatsApp number. The row stays
   * `draft`: our model approves a template only on Meta's word, so "locally approved without a Meta id" is not reproduced.
   */
  async create(v: V1CreateTemplate): Promise<V1Template> {
    this.refuseUnstorable(v);
    const connectionId = await this.defaultConnection();
    const input: CreateTemplateInput = {
      name: v.template_name,
      language: v.language ?? 'en_US',
      metaCategory: metaCategoryOfInput(v.category),
      templateType: this.typeOf(v.template_type),
      header: v.header ?? null,
      attachmentType: 'none',
      body: v.template_body ?? '',
      footer: v.footer ?? null,
      buttons: buttonsOfInput(v.buttons, v.quick_replies),
      codeExpirationMinutes: v.code_expiration_minutes ?? null,
      parameterFormat: 'POSITIONAL',
      connectionId,
      submit: false,
    };
    const res = await this.templates.create(input);
    return toPublicTemplate(sourceOfDetail(res.template));
  }

  /**
   * Reference's PUT is a replacement for the text fields: an omitted `header`, `footer` or `code_expiration_minutes` clears it, while
   * `language`, `template_type`, the buttons (unless `buttons` or `quick_replies` is sent) and the stored header file are kept.
   * The domain's optimistic lock is satisfied with the version read a moment before, so a client needs no `rowVersion`.
   */
  async update(uuid: string, v: V1UpdateTemplate): Promise<V1Template> {
    this.refuseUnstorable(v);
    const cur = await this.row(uuid);
    const attachment = (cur.attachmentType ?? 'none').toLowerCase();
    const input: UpdateTemplateInput = {
      name: v.template_name,
      language: v.language ?? cur.language,
      metaCategory: metaCategoryOfInput(v.category),
      templateType: this.typeOf(v.template_type ?? cur.templateType),
      header: v.header ?? null,
      attachmentType:
        (['image', 'video', 'document', 'location'] as const).find((a) => a === attachment) ??
        'none',
      body: v.template_body!,
      footer: v.footer ?? null,
      buttons:
        v.buttons !== undefined || v.quick_replies !== undefined
          ? buttonsOfInput(v.buttons, v.quick_replies)
          : Array.isArray(cur.buttons)
            ? (cur.buttons as UpdateTemplateInput['buttons'])
            : [],
      codeExpirationMinutes: v.code_expiration_minutes ?? null,
      parameterFormat: cur.parameterFormat === 'NAMED' ? 'NAMED' : 'POSITIONAL',
      rowVersion: cur.rowVersion,
      submit: false,
    };
    const res = await withV1NotFound(NOT_FOUND, () => this.templates.update(uuid, input));
    return toPublicTemplate(sourceOfDetail(res.template));
  }

  async remove(uuid: string): Promise<void> {
    await withV1NotFound(NOT_FOUND, () => this.templates.remove(uuid));
  }

  // --- send (TW-API-036, 037) ----------------------------------------------------------------------------------------------

  /**
   * One template to one number, through the same outbound pipeline as the inbox: stored `queued`, sent by the worker (which owns the
   * emergency halt, the plan's message cap and the wallet). The recipient becomes a contact only after the template has passed every
   * check, so a refused send leaves no contact behind.
   */
  async send(
    uuid: string,
    v: V1SendTemplate,
    file: UploadedHeader | undefined,
  ): Promise<V1TemplateSendResult> {
    // The file is checked before the template is looked up, as in Reference; unlike Reference nothing is stored, so a 404 leaves no orphan.
    if (file) guardHeaderMedia(this.uploads, file);

    const { orgId } = RequestContextStore.require();
    const t = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!t)
      throw v1Error(
        'template_not_found',
        'Template not found in this workspace.',
        HttpStatus.NOT_FOUND,
      );

    const refuse = (
      code: string,
      message: string,
      status = HttpStatus.UNPROCESSABLE_ENTITY,
    ): never => {
      throw v1Error(code, message, status, [{ path: 'template_id', message: uuid }]);
    };
    const block = sendBlockOf(
      {
        status: t.status,
        metaStatus: t.metaStatus,
        pausedUntil: t.pausedUntil,
        qualityScore: t.qualityScore,
        templateType: t.templateType,
        parameterFormat: t.parameterFormat,
        attachmentType: t.attachmentType,
      },
      new Date(),
    );
    if (block) refuse(block.code, block.message);

    if (file || v.header_media_url || v.header_filename)
      throw unsupported(
        file ? 'header_media' : v.header_media_url ? 'header_media_url' : 'header_filename',
        'Sending a header file through the outbound queue is not available yet.',
      );
    if (v.header_text) throw unsupported('header_text', 'Header variables are not available yet.');
    if (v.buttons && v.buttons.length > 0)
      throw unsupported('buttons', 'Dynamic button values are not available yet.');
    if ((t.attachmentType ?? 'none') !== 'none')
      refuse(
        'missing_header_media',
        'This template has a media header, which the API cannot send yet.',
      );

    const channel = await this.db.tx(async (tx) =>
      (await this.channels.list(tx, orgId)).find(
        (c) => c.wabaConfigId !== null && c.wabaConfigId === t.providerConfigId,
      ),
    );
    if (!channel || channel.status !== 'connected')
      refuse('no_provider', 'No connected WhatsApp number is available for this template.');

    const digits = recipientDigits(v.to);
    const values = bodyValuesOf(v.body);
    const tokens = tokensOf(t.templateBody);
    const variables = Object.fromEntries(
      tokens.map((_, i) => [String(i + 1), values[i] ?? '']),
    ) as Record<string, string>;

    const link = await this.db.tx((tx) =>
      this.contacts.findOrCreateByPhone(tx, orgId, { phone: `+${digits}`, source: 'api' }),
    );
    if (link.outcome === 'skipped') {
      if (link.reason === 'plan_limit_reached')
        throw new AppError(
          ERROR_CODES.PLAN_LIMIT_REACHED,
          'The contact limit of the plan is reached.',
          HttpStatus.PAYMENT_REQUIRED,
        );
      throw AppError.validation('The recipient number is not usable.', [
        { path: 'to', message: 'Enter a number with its country code.' },
      ]);
    }

    const thread = await this.conversations.openConversationFor(link.contactUuid, channel!.uuid);
    const sent = await this.conversations.enqueueOutbound({
      conversationId: thread.id,
      clientMessageId: randomUUID(),
      content: {
        kind: 'template',
        name: t.templateName,
        language: t.language,
        variables,
        body: renderBody(t.templateBody, tokens, values),
        templateId: t.id,
      },
      sender: { kind: 'bot' },
    });
    return {
      message_id: sent.message.id,
      wamid: null,
      status: 'queued',
      template_id: t.uuid,
      template_name: t.templateName,
      to: digits,
    };
  }

  // --- internals -----------------------------------------------------------------------------------------------------------

  private async row(uuid: string): Promise<TemplateRow> {
    const { orgId } = RequestContextStore.require();
    const r = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!r) throw this.notFound();
    return r;
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, NOT_FOUND, HttpStatus.NOT_FOUND);
  }

  private typeOf(raw: string | undefined): 'standard' | 'media' | 'auth' {
    return raw === 'media' || raw === 'auth' ? raw : 'standard';
  }

  /** What the template domain cannot hold yet (no column in its input): refused loudly rather than dropped. */
  private refuseUnstorable(v: V1CreateTemplate | V1UpdateTemplate): void {
    if (v.template_type === 'carousel')
      throw unsupported(
        'template_type',
        'Carousel templates cannot be created through the API yet.',
      );
    if (Array.isArray(v.carousel_data) && v.carousel_data.length > 0)
      throw unsupported('carousel_data', 'Carousel cards cannot be stored through the API yet.');
    if (v.latitude !== undefined || v.longitude !== undefined)
      throw unsupported('latitude', 'A location header cannot be stored through the API yet.');
  }

  /** The workspace's WhatsApp number a template is authored on: the primary one, else the newest. Reference's create names no number. */
  private async defaultConnection(): Promise<string> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.connections.list(tx, orgId));
    const pick = rows.find((r) => r.status === 'connected') ?? rows[0];
    if (!pick)
      throw new AppError(
        ERROR_CODES.TPL_NO_CONNECTION,
        'Connect a WhatsApp number before creating templates.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    return pick.uuid;
  }
}
