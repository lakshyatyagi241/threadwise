import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  PLAN_UPGRADE_PATH,
  createWidgetSchema,
  listWidgetsQuerySchema,
  updateWidgetSchema,
  type CreateWidgetInput,
  type ListWidgetsResponse,
  type RotateWidgetTokenResponse,
  type Widget,
  type WidgetAssistantsResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
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
      // QUIRK: reproduced deliberately (TW-WGT-006 rule 4). Saving with an id that is not in this workspace (another
      // workspace's widget, a deleted one, one that never existed) silently creates a NEW widget instead of failing, and the
      // widget that id pointed at is untouched.
      if (!current) return this.createIn(tx, orgId, ctx.userId, input);
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
  if (JSON.stringify(a.allowedDomains) !== JSON.stringify(b.allowedDomains)) {
    out.allowedDomains = { old: a.allowedDomains, new: b.allowedDomains };
  }
  return Object.keys(out).length ? out : undefined;
}
