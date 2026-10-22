import { renderChatPage } from './chat-page';
import { buildEmbedScript, safeColour } from './embed-script';
import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  PLAN_UPGRADE_PATH,
  createWidgetSchema,
  flowWidgetSaveSchema,
  listWidgetsQuerySchema,
  updateWidgetSchema,
  type CreateWidgetInput,
  type FlowWidgetResponse,
  type WebBotItem,
  type WebBotsResponse,
  type FlowWidgetSaveInput,
  type ListWidgetsResponse,
  type RotateWidgetTokenResponse,
  type Widget,
  type WidgetAssistantsResponse,
  parseLauncher,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { isAssetSlot, isWindowSlot } from './asset-slots';
import { isSafeSvg } from '../../common/svg-safe';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { UploadPolicyService } from '../auth';
import { PlanEntitlementService, PlanUsageService } from '../plans-subscriptions-trials';
import {
  ASSISTANT_DIRECTORY,
  WIDGET_PLAN_GATE,
  type AssistantDirectory,
  type WidgetPlanGate,
} from './_shims/tokens';
import { copySlug, freshToken, slugBase, uniqueSlug } from './widget-rules';
import { WidgetsRepository, type WidgetRow, type WidgetWrite } from './widgets.repository';
import { toWidget, toWidgetListItem, widgetUrls } from './widgets.mapper';

const MODULE_KEY = 'chatbot_widgets';
export const PLAN_FEATURE = 'access_chatbot_widgets';

const parse = <T>(
  schema: {
    safeParse(v: unknown):
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: Array<{ path: Array<string | number>; message: string }> };
        };
  },
  body: unknown,
): T => {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw AppError.validation(
    'Request payload failed validation',
    parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
};

/**
 * The admin side of the chatbot widget: list, builder save, duplicate, rotate, pause and delete (TW-WGT-001, 006, 023-026).
 *
 * Every write is one transaction that also writes its audit row and its outbox event. Reference wrote neither; the port does
 * because both are repository rules and a token rotation in particular is something an owner must be able to trace.
 */
/** The pictures a widget can carry (a WhatsApp button's logo and popup; a website bot's logo, avatar, background and callout), and what is accepted. */
const FLOW_ASSET_MAX_BYTES = 1_048_576;
const FLOW_ASSET_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

/** The Web channel list shows the newest bots; `total` says when there are more. */
const WEB_BOTS_LIMIT = 200;

@Injectable()
export class WidgetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WidgetsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    @Inject(ASSISTANT_DIRECTORY) private readonly assistants: AssistantDirectory,
    @Inject(WIDGET_PLAN_GATE) private readonly planGate: WidgetPlanGate,
    private readonly planUsage: PlanUsageService,
    private readonly entitlements: PlanEntitlementService,
    private readonly uploads: UploadPolicyService,
  ) {}

  /** The origin the snippet points at: the widget script and chat page are served by the API host, not the web app. */
  get publicBase(): string {
    const base =
      this.config.get<string>('WIDGET_PUBLIC_BASE_URL') ??
      this.config.get<string>('APP_URL') ??
      'http://localhost:3000';
    return base.replace(/\/+$/, '');
  }

  /** Reference let a page load through a plan lock (with a paywall over it) but refused every change. */
  private async assertPlan(orgId: number): Promise<void> {
    if (await this.planGate.isEnabled(orgId)) return;
    throw new AppError(
      ERROR_CODES.PLAN_FEATURE_LOCKED,
      "Your plan doesn't include chatbot widgets. Upgrade to unlock this feature.",
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'feature', message: PLAN_FEATURE },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  async list(rawQuery: unknown): Promise<ListWidgetsResponse> {
    const query = parse(listWidgetsQuerySchema, rawQuery);
    const orgId = RequestContextStore.orgId();
    const planLocked = !(await this.planGate.isEnabled(orgId));
    const afterId = query.cursor ? decodeCursor(query.cursor).id : null;
    const { rows, stats } = await this.db.tx(async (tx) => ({
      rows: await this.repo.list(tx, orgId, {
        limit: query.limit,
        afterId,
      }),
      stats: await this.repo.stats(tx, orgId),
    }));
    const { items, page } = buildPage(rows, query.limit);
    return {
      data: items.map((r) => toWidgetListItem(r, this.publicBase)),
      page,
      stats,
      planLocked,
    };
  }

  async assistantPicker(): Promise<WidgetAssistantsResponse> {
    const orgId = RequestContextStore.orgId();
    const planLocked = !(await this.planGate.isEnabled(orgId));
    const data = await this.db.tx((tx) => this.assistants.listActive(tx, orgId));
    return { data: data.map((a) => ({ id: a.uuid, name: a.name })), planLocked };
  }

  async get(uuid: string): Promise<Widget> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Widget', uuid);
    return toWidget(row, this.publicBase);
  }

  /** Mode `ai` or `both` needs a smart agent of this workspace; its status is not checked (TW-WGT-003 rule 3). */
  private async resolveAssistant(
    tx: Tx,
    orgId: number,
    input: Pick<CreateWidgetInput, 'mode' | 'assistantId'>,
  ): Promise<number | null> {
    const needs = input.mode === 'ai' || input.mode === 'both';
    // AI mode attaches an assistant: the plan's `ai_assistants` flag (422 PLAN_FEATURE_LOCKED), before any write.
    if (needs) await this.entitlements.assertFeature(orgId, 'ai_assistants');
    if (needs && !input.assistantId) {
      throw new AppError(
        ERROR_CODES.WGT_ASSISTANT_REQUIRED,
        'AI mode needs an assistant. Pick one or create one in AI Training.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!input.assistantId) return null;
    const found = await this.assistants.findByUuid(tx, orgId, input.assistantId);
    if (!found) {
      // Reference only looked an assistant up for the modes that need one; a stray id in `whatsapp` mode was stored as sent.
      // A foreign id cannot be stored here (composite foreign key), so it is refused in every mode.
      throw new AppError(
        ERROR_CODES.WGT_ASSISTANT_NOT_IN_WORKSPACE,
        'Assistant not in this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return found.id;
  }

  private toWrite(input: CreateWidgetInput, assistantId: number | null): WidgetWrite {
    return {
      name: input.name,
      mode: input.mode,
      assistantId,
      targetWhatsappCc: input.targetWhatsappCc,
      targetWhatsappNumber: input.targetWhatsappNumber,
      prefilledMessage: input.prefilledMessage,
      position: input.position,
      buttonColor: input.buttonColor,
      buttonImageUrl: input.buttonImageUrl,
      headerTitle: input.headerTitle,
      headerBg: input.headerBg,
      headerTextColor: input.headerTextColor,
      welcomeMessage: input.welcomeMessage,
      messageBubbleColor: input.messageBubbleColor,
      messageTextColor: input.messageTextColor,
      bodyBgKind: input.bodyBgKind,
      bodyBgColor: input.bodyBgColor,
      bodyBgImageUrl: input.bodyBgImageUrl,
      autoOpen: input.autoOpen,
      buttonLabel: input.buttonLabel,
      actionButtonBg: input.actionButtonBg,
      actionButtonTextColor: input.actionButtonTextColor,
      collectName: input.collectName,
      collectEmail: input.collectEmail,
      collectPhone: input.collectPhone,
      ageGate: input.ageGate,
      allowedDomains: input.allowedDomains,
      launcher: input.launcher,
    };
  }

  async create(body: unknown): Promise<Widget> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    await this.assertPlan(orgId);
    const input = parse(createWidgetSchema, body);

    const row = await this.db.tx((tx) => this.createIn(tx, orgId, ctx.userId, input));
    return toWidget(row, this.publicBase);
  }

  private async createIn(
    tx: Tx,
    orgId: number,
    userId: number | null,
    input: CreateWidgetInput,
  ): Promise<WidgetRow> {
    // The plan's `chatbot_widgets` cap: every path that adds a widget (create, and the update-with-a-stale-id quirk) passes here.
    await this.planUsage.assertCanAddIn(tx, orgId, 'chatbot_widgets');
    const assistantId = await this.resolveAssistant(tx, orgId, input);
    const base = slugBase(input.name);
    await this.repo.lockSlugs(tx, orgId);
    const slug = uniqueSlug(base, await this.repo.slugsLike(tx, orgId, base, null));
    const id = await this.repo.insert(
      tx,
      orgId,
      userId,
      slug,
      freshToken(),
      this.toWrite(input, assistantId),
    );
    const created = (await this.repo.findById(tx, orgId, id))!;
    await this.record(tx, created, 'insert', 'widget.created');
    return created;
  }

  async update(uuid: string, body: unknown): Promise<Widget> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    await this.assertPlan(orgId);
    const input = parse(updateWidgetSchema, body);

    const row = await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, orgId, uuid);
      // DELIBERATE DEVIATION from Reference (TW-WGT-006 rule 4; authorisation finding AZ-019): Reference silently CREATED a new
      // widget when the id was not one of the workspace's. An id that is not this workspace's widget (another workspace's,
      // a deleted one, one that never existed) is now a 404, identical for all three, and nothing is created.
      if (!current) throw AppError.notFound('Widget', uuid);
      const assistantId = await this.resolveAssistant(tx, orgId, input);
      // A renamed widget keeps its slug (Reference): the address people may have shared does not move.
      const ok = await this.repo.update(
        tx,
        orgId,
        current.id,
        current.slug,
        this.toWrite(input, assistantId),
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Widget');
      const saved = (await this.repo.findById(tx, orgId, current.id))!;
      await this.record(tx, saved, 'update', 'widget.updated', diff(current, saved));
      return saved;
    });
    return toWidget(row, this.publicBase);
  }

  /** A copy with a fresh token and a "(copy)" name; visitors and threads are not copied. */
  async duplicate(uuid: string): Promise<Widget> {
    const orgId = RequestContextStore.orgId();
    await this.assertPlan(orgId);
    const row = await this.db.tx(async (tx) => {
      const src = await this.repo.findByUuid(tx, orgId, uuid);
      if (!src) throw AppError.notFound('Widget', uuid);
      await this.planUsage.assertCanAddIn(tx, orgId, 'chatbot_widgets');
      // Reference replicated the row: the copy keeps the ORIGINAL author (`user_id`), and a name at the 120-character limit
      // grows past it (the column here is unbounded text; Reference answered a database error).
      const id = await this.repo.insert(
        tx,
        orgId,
        src.userId,
        copySlug(src.slug),
        freshToken(),
        {
          name: `${src.name} (copy)`,
          mode: src.mode,
          assistantId: src.assistantId,
          targetWhatsappCc: src.targetWhatsappCc,
          targetWhatsappNumber: src.targetWhatsappNumber,
          prefilledMessage: src.prefilledMessage,
          position: src.position,
          buttonColor: src.buttonColor,
          buttonImageUrl: src.buttonImageUrl,
          headerTitle: src.headerTitle,
          headerBg: src.headerBg,
          headerTextColor: src.headerTextColor,
          welcomeMessage: src.welcomeMessage,
          messageBubbleColor: src.messageBubbleColor,
          messageTextColor: src.messageTextColor,
          bodyBgKind: src.bodyBgKind,
          bodyBgColor: src.bodyBgColor,
          bodyBgImageUrl: src.bodyBgImageUrl,
          autoOpen: src.autoOpen,
          buttonLabel: src.buttonLabel,
          actionButtonBg: src.actionButtonBg,
          actionButtonTextColor: src.actionButtonTextColor,
          collectName: src.collectName,
          collectEmail: src.collectEmail,
          collectPhone: src.collectPhone,
          ageGate: src.ageGate,
          allowedDomains: src.allowedDomains,
          launcher: src.launcher,
        },
        // A paused widget is copied as paused (Reference copied every column).
        src.status,
      );
      const created = (await this.repo.findById(tx, orgId, id))!;
      await this.record(tx, created, 'insert', 'widget.created', undefined, {
        duplicatedFrom: src.uuid,
      });
      return created;
    });
    return toWidget(row, this.publicBase);
  }

  /** Replaces the secret: the old snippet stops working at once, stored conversations are untouched. */
  async rotateToken(uuid: string): Promise<RotateWidgetTokenResponse> {
    const orgId = RequestContextStore.orgId();
    await this.assertPlan(orgId);
    const row = await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, orgId, uuid);
      if (!current) throw AppError.notFound('Widget', uuid);
      await this.repo.setToken(tx, orgId, current.id, freshToken());
      const saved = (await this.repo.findById(tx, orgId, current.id))!;
      // The old token is never written down, only the fact that it changed.
      await this.record(tx, saved, 'update', 'widget.token_rotated', {
        embedToken: { old: '[rotated]', new: '[rotated]' },
      });
      return saved;
    });
    return {
      embedToken: row.embedToken,
      ...widgetUrls(this.publicBase, row.embedToken),
      rowVersion: row.rowVersion,
    };
  }

  async remove(uuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    await this.assertPlan(orgId);
    await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, orgId, uuid);
      if (!current) throw AppError.notFound('Widget', uuid);
      await this.repo.delete(tx, orgId, current.id);
      await this.record(tx, current, 'delete', 'widget.deleted');
    });
  }

  /** The flow a widget belongs to: it must exist in this workspace and be a website chat or a WhatsApp bot. */
  /**
   * The chat window the Customize tab previews: the real page in preview mode, so what the author sees is what a visitor gets. Only a
   * website chat bot has one (the same check as reading its widget).
   */
  async previewPage(flowUuid: string, locale: string): Promise<{ html: string }> {
    await this.getForFlow(flowUuid);
    return {
      html: renderChatPage({
        uuid: 'preview',
        token: 'preview',
        name: 'Preview',
        flow: true,
        preview: true,
        locale,
      }),
    };
  }

  /**
   * The closed launcher the Customize tab previews: the real loader (the callout, the animation, the unread dot) on a stand-in page,
   * drawn from the settings being edited. Only the launcher, the colour and the side are read from `body`; nothing is stored.
   */
  async previewEmbed(flowUuid: string, body: unknown): Promise<{ html: string }> {
    await this.getForFlow(flowUuid);
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const script = buildEmbedScript(
      {
        uuid: 'preview',
        mode: 'ai',
        name: 'Preview',
        launcher: parseLauncher(raw.launcher),
        whatsappUrl: null,
        position: raw.position === 'bottom_left' ? 'bottom_left' : 'bottom_right',
        buttonColor: safeColour(
          typeof raw.buttonColor === 'string' ? raw.buttonColor : null,
          '#5B4DDB',
        ),
        buttonImageUrl: typeof raw.buttonImageUrl === 'string' ? raw.buttonImageUrl : null,
        autoOpen: false,
        flow: true,
      },
      'about:blank',
    );
    const cell = '<i style="display:block;height:92px;border-radius:12px;background:#eceef6"></i>';
    return {
      html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#fff;font-family:system-ui,sans-serif}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:18px}.h{height:12px;width:90px;border-radius:6px;background:#dfe2ee;margin:18px 18px 0}</style></head><body><div class="h"></div><div class="g">${cell.repeat(8)}</div><script>${script.replace(/<\/(script)/gi, '<\\/$1')}</script></body></html>`,
    };
  }

  private async requireWidgetFlow(tx: Tx, orgId: number, flowUuid: string) {
    const flow = await this.repo.findFlow(tx, orgId, flowUuid);
    if (!flow) throw AppError.notFound('Flow', flowUuid);
    if (flow.flowType !== 'web' && flow.flowType !== 'chat')
      throw AppError.validation('Only a website chat or WhatsApp bot has a widget.', [
        { path: 'flowId', message: 'This bot is not built for website chat or WhatsApp.' },
      ]);
    return flow;
  }

  /**
   * What a flow bot's Customize tab saves. A website chat bot sends the look only (the flow answers, so no assistant and no WhatsApp
   * target). A WhatsApp bot's widget is the website button that opens WhatsApp: mode `whatsapp`, the bot's number and the message it
   * prefills; the number must be a real one, as the Chat widget screen requires.
   */
  private flowWrite(flowType: string, name: string, input: FlowWidgetSaveInput): WidgetWrite {
    if (flowType === 'chat') {
      const digits = `${input.targetWhatsappCc ?? ''}${input.targetWhatsappNumber ?? ''}`.replace(
        /\D+/g,
        '',
      );
      if (digits.length < 8)
        throw AppError.validation('Enter the WhatsApp number the button should open.', [
          {
            path: 'targetWhatsappNumber',
            message: 'Enter a WhatsApp number with its country code.',
          },
        ]);
      return this.toWrite({ ...input, name, mode: 'whatsapp', assistantId: null }, null);
    }
    return this.toWrite(
      {
        ...input,
        name,
        mode: 'ai',
        assistantId: null,
        targetWhatsappCc: null,
        targetWhatsappNumber: null,
      },
      null,
    );
  }

  /** The workspace's website chat bots for Settings > Channels > Web, each with its widget and one state word. */
  async webBots(): Promise<WebBotsResponse> {
    const orgId = RequestContextStore.orgId();
    const { rows, total } = await this.db.tx((tx) => this.repo.webBots(tx, orgId, WEB_BOTS_LIMIT));
    return {
      total,
      data: rows.map((r): WebBotItem => {
        const widget =
          r.widgetUuid && r.widgetStatus
            ? {
                id: r.widgetUuid,
                headerTitle: r.headerTitle ?? '',
                status: r.widgetStatus as 'active' | 'paused',
                customizedAt: r.customizedAt ? r.customizedAt.toISOString() : null,
              }
            : null;
        const state: WebBotItem['state'] = !widget?.customizedAt
          ? 'needs_customizing'
          : !r.isPublished
            ? 'draft'
            : widget.status === 'paused' || !r.isActive
              ? 'paused'
              : 'live';
        return {
          flowId: r.flowUuid,
          name: r.name,
          state,
          isPublished: r.isPublished,
          widget,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    };
  }

  /**
   * A picture for a widget (`logo`, `popup`, and for a website bot `avatar` and `background`), stored here and served from a public
   * address so the widget can show it on any site. PNG, JPEG, WebP or GIF up to 1 MB, or an SVG that passes `isSafeSvg` (the shared
   * upload policy refuses SVG because it can carry script, so the SVG is checked here, by what it contains).
   * Returns the address to put in the button's settings; the `v` part changes with the picture so a replaced image is never stale.
   */
  async uploadAsset(
    flowUuid: string,
    slot: string,
    file: { originalname: string; buffer: Buffer } | undefined,
  ): Promise<{ slot: string; url: string }> {
    if (!isAssetSlot(slot)) throw AppError.notFound('Image slot', slot);
    if (!file)
      throw AppError.validation('Choose an image to upload.', [
        { path: 'file', message: 'required' },
      ]);
    const ctx = RequestContextStore.require();
    const isSvg = /\.svg$/i.test(file.originalname);
    let mime: string;
    if (isSvg) {
      if (!isSafeSvg(file.buffer))
        throw AppError.validation('This SVG cannot be used.', [
          {
            path: 'file',
            message: 'Use a plain SVG picture without scripts, links or embedded pages.',
          },
        ]);
      mime = 'image/svg+xml';
    } else {
      const checked = await this.uploads.validateScanned({
        filename: file.originalname,
        buffer: file.buffer,
        allow: ['image'],
        maxBytes: FLOW_ASSET_MAX_BYTES,
      });
      if (!FLOW_ASSET_MIMES.includes(checked.mime))
        throw AppError.validation('Use a PNG, JPG, WebP, GIF or SVG image.', [
          { path: 'file', message: 'Not a supported image.' },
        ]);
      mime = checked.mime;
    }
    const etag = createHash('sha1').update(file.buffer).digest('hex').slice(0, 16);
    await this.db.tx(async (tx) => {
      const flow = await this.requireWidgetFlow(tx, ctx.orgId, flowUuid);
      if (flow.flowType === 'chat' && isWindowSlot(slot))
        throw AppError.validation('A WhatsApp bot has no chat window to put this picture in.', [
          { path: 'flowId', message: 'This bot is built for WhatsApp.' },
        ]);
      await this.repo.upsertAsset(tx, ctx.orgId, flow.id, slot, mime, file.buffer, etag);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: flow.id,
        action: 'update',
        delta: { [`widgetImage.${slot}`]: { old: null, new: etag } },
      });
    });
    return { slot, url: `${this.publicBase}/widget-assets/${flowUuid}/${slot}?v=${etag}` };
  }

  async removeAsset(flowUuid: string, slot: string): Promise<void> {
    if (!isAssetSlot(slot)) throw AppError.notFound('Image slot', slot);
    const orgId = RequestContextStore.orgId();
    await this.db.tx(async (tx) => {
      const flow = await this.requireWidgetFlow(tx, orgId, flowUuid);
      await this.repo.deleteAsset(tx, orgId, flow.id, slot);
    });
  }

  /** The widget of a flow bot; `widget` is null until its owner has saved Customize once. */
  async getForFlow(flowUuid: string): Promise<FlowWidgetResponse> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx(async (tx) => {
      const flow = await this.requireWidgetFlow(tx, orgId, flowUuid);
      return this.repo.findByFlowId(tx, orgId, flow.id);
    });
    return { widget: row ? toWidget(row, this.publicBase) : null };
  }

  /**
   * Saves the Customize tab. The first save creates the widget (named after the bot, with a fresh embed token) and counts as
   * the first customization; later saves must carry the row version they were read at.
   */
  async saveForFlow(flowUuid: string, body: unknown): Promise<Widget> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    await this.assertPlan(orgId);
    const input = parse(flowWidgetSaveSchema, body);
    const row = await this.db.tx(async (tx) => {
      const flow = await this.requireWidgetFlow(tx, orgId, flowUuid);
      const current = await this.repo.findByFlowId(tx, orgId, flow.id);
      if (!current) {
        await this.planUsage.assertCanAddIn(tx, orgId, 'chatbot_widgets');
        const base = slugBase(flow.name);
        await this.repo.lockSlugs(tx, orgId);
        const slug = uniqueSlug(base, await this.repo.slugsLike(tx, orgId, base, null));
        const id = await this.repo.insert(
          tx,
          orgId,
          ctx.userId,
          slug,
          freshToken(),
          this.flowWrite(flow.flowType, flow.name, input),
          'active',
          flow.id,
        );
        const created = (await this.repo.findById(tx, orgId, id))!;
        // A website chat bot answers through this channel, so it exists before the first visitor. A WhatsApp bot's button opens WhatsApp.
        if (flow.flowType === 'web')
          await this.repo.ensureWebchatChannel(tx, orgId, created.uuid, flow.name, ctx.userId);
        await this.record(tx, created, 'insert', 'widget.created', undefined, {
          flowId: flowUuid,
        });
        return created;
      }
      if (input.rowVersion === undefined) throw AppError.rowVersionConflict('Widget');
      const ok = await this.repo.update(
        tx,
        orgId,
        current.id,
        current.slug,
        this.flowWrite(flow.flowType, current.name, input),
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Widget');
      const saved = (await this.repo.findById(tx, orgId, current.id))!;
      await this.record(tx, saved, 'update', 'widget.updated', diff(current, saved), {
        flowId: flowUuid,
      });
      return saved;
    });
    return toWidget(row, this.publicBase);
  }

  private async record(
    tx: Tx,
    row: WidgetRow,
    action: 'insert' | 'update' | 'delete',
    eventType: string,
    delta?: Record<string, { old: unknown; new: unknown }>,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action, delta });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: row.id,
      eventType,
      payload: { uuid: row.uuid, name: row.name, status: row.status, mode: row.mode, ...extra },
    });
  }
}

const AUDITED: ReadonlyArray<keyof WidgetRow> = [
  'name',
  'mode',
  'assistantUuid',
  'position',
  'status',
  'autoOpen',
  'collectName',
  'collectEmail',
  'collectPhone',
  'targetWhatsappCc',
  'targetWhatsappNumber',
];

/** Field-level delta of the settings that change how the widget behaves; styling noise stays out of the trail. */
function diff(
  a: WidgetRow,
  b: WidgetRow,
): Record<string, { old: unknown; new: unknown }> | undefined {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of AUDITED) if (a[k] !== b[k]) out[k] = { old: a[k], new: b[k] };
  if (JSON.stringify(a.launcher) !== JSON.stringify(b.launcher)) {
    out.launcher = { old: a.launcher, new: b.launcher };
  }
  if (JSON.stringify(a.ageGate) !== JSON.stringify(b.ageGate)) {
    out.ageGate = { old: a.ageGate, new: b.ageGate };
  }
  if (JSON.stringify(a.allowedDomains) !== JSON.stringify(b.allowedDomains)) {
    out.allowedDomains = { old: a.allowedDomains, new: b.allowedDomains };
  }
  return Object.keys(out).length ? out : undefined;
}
