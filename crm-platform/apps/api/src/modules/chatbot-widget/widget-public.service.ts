import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  widgetMessageRequestSchema,
  type WidgetHistoryResponse,
  type WidgetMessageResponse,
  type WidgetPublicConfig,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ASSISTANT_DIRECTORY,
  INBOX_GATEWAY,
  type AssistantDirectory,
  type AssistantProfile,
  type InboxGateway,
  type InboxLine,
  type KnowledgeSource,
  type VisitorForInbox,
  type WidgetForInbox,
} from './_shims/tokens';
import { HISTORY_TURNS } from './ai-prompt';
import { buildEmbedScript, NOT_FOUND_SCRIPT } from './embed-script';
import { renderChatPage } from './chat-page';
import {
  historyFrom,
  isTokenShape,
  originAllowed,
  toTranscriptEntry,
  usesAi,
  whatsappUrl,
} from './widget-rules';
import { WidgetAiReplyService } from './widget-ai-reply.service';
import { WidgetThrottleService, type ThrottledRoute } from './widget-throttle.service';
import { WidgetVisitorsRepository, type VisitorRow } from './widget-visitors.repository';
import { WidgetsRepository, type WidgetRow } from './widgets.repository';

/** A public-route failure in the shape the widget script reads (not problem+json: embedded pages already depend on it). */
export class WidgetPublicError extends HttpException {
  constructor(
    status: number,
    readonly payload: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(payload, status);
  }
}

const notFound = () => new WidgetPublicError(404, { ok: false, error: 'widget_not_found' });

/** What the controller hands over about the HTTP request, so the service never touches Express. */
export interface PublicRequest {
  ip: string;
  referer: string;
  userAgent: string;
  cookies: string | undefined;
  /** `?visitor_uuid=` or the JSON body key. */
  inputUuid: string;
  headerUuid: string;
  secure: boolean;
}

interface Located {
  orgId: number;
  widget: WidgetRow;
}

export type OriginCheck =
  | { kind: 'skip' }
  | { kind: 'not_found' }
  | { kind: 'denied'; message: string }
  | { kind: 'allowed'; origin: string };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSCRIPT_LIMIT = 200;

/**
 * Everything a visitor's browser can ask of a widget (WD-WGT-008 to 020): the loader script, the chat page, the config,
 * the message and the history poll. The token is the only credential. Because it arrives before any tenant is known, the
 * organization is found through a narrow SECURITY DEFINER lookup and every later read and write runs in that
 * organization's tenant transaction.
 */
@Injectable()
export class WidgetPublicService {
  private readonly logger = new Logger(WidgetPublicService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly widgets: WidgetsRepository,
    private readonly visitors: WidgetVisitorsRepository,
    private readonly throttle: WidgetThrottleService,
    private readonly aiReply: WidgetAiReplyService,
    @Inject(INBOX_GATEWAY) private readonly inbox: InboxGateway,
    @Inject(ASSISTANT_DIRECTORY) private readonly assistants: AssistantDirectory,
  ) {}

  /** The widget behind a token, whatever its status; undefined for a malformed, unknown or rotated token. */
  private async locate(token: string): Promise<Located | undefined> {
    if (!isTokenShape(token)) return undefined;
    const hit = await this.db.primary.execute(sql`SELECT * FROM wgt_widget_lookup(${token})`);
    const row = hit.rows[0] as
      { widget_id: number | string; widget_org_id: number | string } | undefined;
    if (!row) return undefined;
    const orgId = Number(row.widget_org_id);
    const widget = await this.db.txAs({ orgId }, (tx) =>
      this.widgets.findById(tx, orgId, Number(row.widget_id)),
    );
    return widget ? { orgId, widget } : undefined;
  }

  private async locateActive(token: string): Promise<Located> {
    const found = await this.locate(token);
    if (!found || found.widget.status !== 'active') throw notFound();
    return found;
  }

  // --- script and page ------------------------------------------------------------------------------------------------

  /** The loader script, or null for a paused, deleted or rotated widget (the route answers 404 with a comment). */
  async embedScript(token: string, base: string): Promise<string | null> {
    const found = await this.locate(token);
    if (!found || found.widget.status !== 'active') return null;
    const w = found.widget;
    return buildEmbedScript(w, `${base}/widget/${w.embedToken}/chat`);
  }

  async chatPage(token: string): Promise<string | null> {
    const found = await this.locate(token);
    if (!found || found.widget.status !== 'active') return null;
    const w = found.widget;
    return renderChatPage({ uuid: w.uuid, token: w.embedToken, name: w.name });
  }

  // --- guards ---------------------------------------------------------------------------------------------------------

  /**
   * The allow-list check of the three `api/*` routes (WD-WGT-020). No `Origin` header means a same-origin or non-browser
   * caller and the check is skipped. The widget's own host is always allowed: the chat page is served from it, so its own
   * requests carry that origin, and WaDesk's list would have blocked them.
   */
  async checkOrigin(
    token: string,
    origin: string | undefined,
    ownHost: string,
  ): Promise<OriginCheck> {
    if (!origin) return { kind: 'skip' };
    const found = await this.locate(token);
    if (!found) return { kind: 'not_found' };
    let host = '';
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      host = '';
    }
    if (host !== '' && host === ownHost.toLowerCase()) return { kind: 'allowed', origin };
    if (originAllowed(origin, found.widget.allowedDomains)) return { kind: 'allowed', origin };
    return {
      kind: 'denied',
      message: `This widget isn't allowed to load from ${origin}. Add the domain to the widget's allow-list.`,
    };
  }

  async enforceThrottle(route: ThrottledRoute, ip: string, token: string): Promise<void> {
    if (await this.throttle.allow(route, ip, token)) return;
    throw new WidgetPublicError(429, { message: 'Too Many Attempts.' }, { 'Retry-After': '60' });
  }

  // --- visitor --------------------------------------------------------------------------------------------------------

  /**
   * The visitor named by the cookie, the header or the input (in that order), scoped to this widget. An unknown uuid is
   * never adopted: when `create` is true a fresh row with a server-made uuid replaces it.
   */
  private async resolveVisitor(
    tx: Parameters<WidgetVisitorsRepository['find']>[0],
    orgId: number,
    widget: WidgetRow,
    req: PublicRequest,
    create: boolean,
  ): Promise<{ visitor: VisitorRow; isNew: boolean } | undefined> {
    const candidates = [cookieUuid(req.cookies, widget.uuid), req.headerUuid, req.inputUuid];
    const uuid = candidates.find((c) => c !== '') ?? '';
    const existing =
      uuid !== '' && UUID_SHAPE.test(uuid)
        ? await this.visitors.find(tx, orgId, widget.id, uuid)
        : undefined;
    if (existing) return { visitor: existing, isNew: false };
    if (!create) return undefined;
    const visitor = await this.visitors.create(tx, orgId, widget.id, {
      referrer: req.referer.slice(0, 1024),
      userAgent: req.userAgent.slice(0, 512),
      ip: req.ip,
    });
    return { visitor, isNew: true };
  }

  // --- config ---------------------------------------------------------------------------------------------------------

  async config(
    token: string,
    req: PublicRequest,
  ): Promise<{ body: WidgetPublicConfig; newVisitorUuid: string | null; widgetUuid: string }> {
    const { orgId, widget } = await this.locateActive(token);
    return this.db.txAs({ orgId }, async (tx) => {
      const { visitor, isNew } = (await this.resolveVisitor(tx, orgId, widget, req, true))!;
      await this.visitors.touch(tx, orgId, visitor.id);
      const lines: InboxLine[] =
        visitor.conversationId === null
          ? []
          : await this.inbox.recent(tx, orgId, visitor.conversationId, TRANSCRIPT_LIMIT);
      return {
        newVisitorUuid: isNew ? visitor.visitorUuid : null,
        widgetUuid: widget.uuid,
        body: {
          ok: true as const,
          widget: {
            name: widget.name,
            mode: widget.mode as 'ai' | 'whatsapp' | 'both',
            header_title: widget.headerTitle,
            header_bg: widget.headerBg,
            header_text: widget.headerTextColor,
            welcome_message: widget.welcomeMessage,
            bubble_color: widget.messageBubbleColor,
            bubble_text: widget.messageTextColor,
            body_bg_kind: widget.bodyBgKind as 'color' | 'image',
            body_bg_color: widget.bodyBgColor,
            body_bg_image_url: widget.bodyBgImageUrl,
            button_label: widget.buttonLabel,
            button_bg: widget.actionButtonBg,
            button_text: widget.actionButtonTextColor,
            collect_name: widget.collectName,
            collect_email: widget.collectEmail,
            collect_phone: widget.collectPhone,
            whatsapp_url: whatsappUrl(widget),
          },
          visitor: {
            uuid: visitor.visitorUuid,
            name: visitor.name,
            email: visitor.email,
            phone: visitor.phone,
          },
          transcript: lines.map((m) => toTranscriptEntry(m)),
        },
      };
    });
  }

  // --- message --------------------------------------------------------------------------------------------------------

  async message(
    token: string,
    req: PublicRequest,
    rawBody: unknown,
  ): Promise<WidgetMessageResponse> {
    const { orgId, widget } = await this.locateActive(token);

    const parsed = widgetMessageRequestSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'body');
        (errors[key] ??= []).push(validationText(key, issue));
      }
      const first = Object.values(errors)[0]?.[0] ?? 'The given data was invalid.';
      throw new WidgetPublicError(422, { message: first, errors });
    }
    const data = parsed.data;

    const forInbox: WidgetForInbox = {
      id: widget.id,
      uuid: widget.uuid,
      userId: widget.userId,
      name: widget.name,
      welcomeMessage: widget.welcomeMessage,
      assistantUuid: widget.assistantUuid,
    };

    // 1. Everything that must commit together: the visitor, the thread, the visitor's line. History is read before the
    //    line is written, so the message is answered once, not also quoted as past conversation.
    const stored = await this.db.txAs({ orgId }, async (tx) => {
      const { visitor } = (await this.resolveVisitor(tx, orgId, widget, req, true))!;
      await this.visitors.touch(tx, orgId, visitor.id);
      await this.visitors.updateProfile(tx, orgId, visitor.id, data);
      const fresh: VisitorForInbox = {
        id: visitor.id,
        visitorUuid: visitor.visitorUuid,
        name: data.name || visitor.name,
        email: data.email || visitor.email,
        phone: data.phone || visitor.phone,
        conversationId: visitor.conversationId,
      };
      const conversation = await this.inbox.ensureConversation(tx, orgId, forInbox, fresh);
      const history = await this.inbox.recent(tx, orgId, conversation.id, HISTORY_TURNS);
      const inbound = await this.inbox.insertInbound(
        tx,
        orgId,
        conversation,
        forInbox,
        visitor.visitorUuid,
        data.body,
      );
      const humanTookOver = await this.inbox.humanHasTakenOver(tx, orgId, conversation.id);
      let assistant: AssistantProfile | undefined;
      let knowledge: KnowledgeSource[] = [];
      if (!humanTookOver && usesAi(widget) && widget.assistantId !== null) {
        assistant = await this.assistants.profile(tx, orgId, widget.assistantId);
        if (assistant) knowledge = await this.assistants.knowledge(tx, orgId, widget.assistantId);
      }
      if (humanTookOver) {
        this.logger.log(
          { widget: widget.uuid, conversationId: conversation.id },
          '[WGT] bot silenced: a person has taken over',
        );
      }
      return { visitor, conversation, history, inbound, assistant, knowledge };
    });

    // 2. The vendor call, with no transaction open.
    let replyText: string | null = null;
    if (stored.assistant) {
      replyText = await this.aiReply.reply({
        orgId,
        assistant: stored.assistant,
        knowledge: stored.knowledge,
        history: stored.history,
        visitorMessage: data.body,
      });
    }

    // 3. The reply joins the thread.
    const reply =
      replyText === null
        ? null
        : await this.db.txAs({ orgId }, async (tx) => {
            const out = await this.inbox.insertAssistantReply(
              tx,
              orgId,
              stored.conversation,
              forInbox,
              widget.assistantUuid,
              replyText!,
            );
            return { id: out.id, body: replyText!, at: out.sentAt.toISOString() };
          });

    return { ok: true, inbound: { id: stored.inbound.id }, reply };
  }

  // --- history --------------------------------------------------------------------------------------------------------

  /**
   * Business lines newer than `since`, so a person's reply from the team inbox reaches the open widget. A paused widget
   * stops here too (WaDesk's history route ignored the status). An unknown visitor gets an empty list and no new row.
   */
  async history(token: string, req: PublicRequest, since: number): Promise<WidgetHistoryResponse> {
    const { orgId, widget } = await this.locateActive(token);
    return this.db.txAs({ orgId }, async (tx) => {
      const resolved = await this.resolveVisitor(tx, orgId, widget, req, false);
      if (!resolved || resolved.visitor.conversationId === null)
        return { ok: true as const, messages: [] };
      await this.visitors.touch(tx, orgId, resolved.visitor.id, 60);
      const lines = await this.inbox.outboundSince(
        tx,
        orgId,
        resolved.visitor.conversationId,
        since,
      );
      return {
        ok: true as const,
        messages: lines.map((m) => ({
          id: m.id,
          body: m.body,
          at: m.sentAt ? m.sentAt.toISOString() : null,
          from: historyFrom(m.agentId),
        })),
      };
    });
  }
}

/** The sentences Laravel's validator used, so a page that shows them keeps reading the same words. */
function validationText(
  key: string,
  issue: {
    code: string;
    message: string;
    received?: unknown;
    maximum?: number | bigint;
    validation?: unknown;
  },
): string {
  if (
    issue.code === 'too_small' ||
    (issue.code === 'invalid_type' && issue.received === 'undefined')
  ) {
    return `The ${key} field is required.`;
  }
  if (issue.code === 'too_big') {
    return `The ${key} field must not be greater than ${String(issue.maximum)} characters.`;
  }
  if (issue.code === 'invalid_string' && issue.validation === 'email') {
    return `The ${key} field must be a valid email address.`;
  }
  return `The ${key} field is invalid.`;
}

function cookieUuid(header: string | undefined, widgetUuid: string): string {
  if (!header) return '';
  const name = `wgt_vid_${widgetUuid}`;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

export { NOT_FOUND_SCRIPT };
