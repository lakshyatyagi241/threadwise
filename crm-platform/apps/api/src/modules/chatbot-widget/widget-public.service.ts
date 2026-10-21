import { pickChatLocale } from './chat-page-text';
import { chatWindowLocale } from './chat-window-locale';
import { isAssetSlot } from './asset-slots';
import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { HandoffService } from '../team-inbox-routing-sla';
import { readHandoff } from './ai-prompt';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  judgeAgeAnswer,
  toPublicLauncher,
  widgetFeedbackRequestSchema,
  widgetMessageRequestSchema,
  type AgeVerdict,
  type WidgetHistoryResponse,
  type WidgetMessageRequest,
  type WidgetMessageResponse,
  type WidgetPublicConfig,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { noticeGrantChannels, type ConsentChannel } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { ChannelIngestPublisher } from '../chat-conversations';
import { KbRetrievalService } from '../knowledge-base';
import {
  ConsentIntakeService,
  ConsentNoticeService,
  ContactPrivacyService,
  MinorDetectionService,
} from '../contact-consent';
import {
  ASSISTANT_DIRECTORY,
  INBOX_GATEWAY,
  type AssistantDirectory,
  type AssistantProfile,
  type InboxGateway,
  type InboxLine,
  type VisitorForInbox,
  type WidgetForInbox,
} from './_shims/tokens';
import { HISTORY_TURNS } from './ai-prompt';
import { buildEmbedScript, NOT_FOUND_SCRIPT } from './embed-script';
import { renderChatPage } from './chat-page';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import {
  historyFrom,
  isTokenShape,
  originAllowed,
  phoneDigits,
  toTranscriptEntry,
  usesAi,
  whatsappUrl,
  widgetMediaOf,
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
  /** The browser sent the Global Privacy Control signal (`Sec-GPC: 1`). */
  gpc?: boolean;
}

interface Located {
  orgId: number;
  widget: WidgetRow;
}

/** What the age gate decided for one message, to apply once the visitor and the thread exist. */
interface AgeCheck {
  verdict: Exclude<AgeVerdict, { kind: 'invalid' }>;
}

export type OriginCheck =
  | { kind: 'skip' }
  | { kind: 'not_found' }
  | { kind: 'denied'; message: string }
  | { kind: 'allowed'; origin: string };

/** The bot id of an old embed: letters, digits, underscore and dash, the same shape the table accepts. */
const LEGACY_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSCRIPT_LIMIT = 200;

/**
 * Everything a visitor's browser can ask of a widget (TW-WGT-008 to 020): the loader script, the chat page, the config,
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
    private readonly media: ChatMediaStore,
    @Inject(INBOX_GATEWAY) private readonly inbox: InboxGateway,
    @Inject(ASSISTANT_DIRECTORY) private readonly assistants: AssistantDirectory,
    private readonly kb: KbRetrievalService,
    private readonly ingest: ChannelIngestPublisher,
    private readonly notices: ConsentNoticeService,
    private readonly consentIntake: ConsentIntakeService,
    private readonly privacy: ContactPrivacyService,
    private readonly minors: MinorDetectionService,
    @Optional() private readonly handoff?: HandoffService,
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

  /** One uploaded picture of a flow bot's button for the public route: a narrow definer lookup, then the bytes. */
  async asset(
    flowUuid: string,
    slot: string,
  ): Promise<{ mime: string; bytes: Buffer; etag: string } | null> {
    if (!UUID_SHAPE.test(flowUuid) || !isAssetSlot(slot)) return null;
    const res = await this.db.primary.execute(
      sql`SELECT asset_mime, asset_bytes, asset_etag FROM wgt_asset_lookup(${flowUuid}::uuid, ${slot})`,
    );
    const r = res.rows[0] as
      { asset_mime: string; asset_bytes: Buffer; asset_etag: string } | undefined;
    return r ? { mime: r.asset_mime, bytes: r.asset_bytes, etag: r.asset_etag } : null;
  }

  // --- script and page ------------------------------------------------------------------------------------------------

  /** The loader script, or null for a paused, deleted or rotated widget (the route answers 404 with a comment). */
  async embedScript(token: string, base: string): Promise<string | null> {
    const found = await this.locate(token);
    if (!found || found.widget.status !== 'active') return null;
    const w = found.widget;
    return buildEmbedScript(
      { ...w, whatsappUrl: whatsappUrl(w), flow: w.flowId !== null },
      `${base}/widget/${w.embedToken}/chat`,
    );
  }

  /** The loader for an old embed: the bot id of the old snippet resolves (narrow definer lookup) to the widget's own token. */
  async legacyEmbedScript(legacyId: string, base: string): Promise<string | null> {
    if (!LEGACY_ID_SHAPE.test(legacyId)) return null;
    const hit = await this.db.primary.execute(
      sql`SELECT widget_token FROM wgt_legacy_lookup(${legacyId})`,
    );
    const row = hit.rows[0] as { widget_token: string } | undefined;
    return row ? this.embedScript(row.widget_token, base) : null;
  }

  async chatPage(token: string, locale?: string): Promise<string | null> {
    const found = await this.locate(token);
    if (!found || found.widget.status !== 'active') return null;
    const w = found.widget;
    const spoken = chatWindowLocale(w.launcher.chat.languages, locale);
    return renderChatPage({
      uuid: w.uuid,
      token: w.embedToken,
      name: w.name,
      flow: w.flowId !== null,
      ...(spoken ? { locale: pickChatLocale(undefined, spoken) } : {}),
    });
  }

  // --- guards ---------------------------------------------------------------------------------------------------------

  /**
   * The allow-list check of the three `api/*` routes (TW-WGT-020). No `Origin` header means a same-origin GET or a non-browser
   * caller and the check is skipped.
   *
   * QUIRK: reproduced deliberately (TW-WGT-020 rule 7). The chat page is served from the widget's own host, so its own POSTs
   * carry that host as their Origin and a non-empty list that names only customer sites blocks them with `cors_origin_denied`.
   * Nothing allows the widget's own host implicitly.
   */
  async checkOrigin(token: string, origin: string | undefined): Promise<OriginCheck> {
    if (!origin) return { kind: 'skip' };
    const found = await this.locate(token);
    if (!found) return { kind: 'not_found' };
    if (originAllowed(origin, found.widget.allowedDomains)) return { kind: 'allowed', origin };
    return {
      kind: 'denied',
      message: `This widget isn't allowed to load from ${origin}. Add the domain to the widget's allow-list.`,
    };
  }

  async enforceThrottle(route: ThrottledRoute, ip: string): Promise<void> {
    if (await this.throttle.allow(route, ip)) return;
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
      const flowUuid =
        widget.flowId === null
          ? null
          : ((
              (await tx.execute(
                sql`SELECT uuid FROM flows WHERE org_id = ${orgId} AND id = ${widget.flowId}`,
              )) as unknown as { rows: Array<{ uuid: string }> }
            ).rows[0]?.uuid ?? null);
      // The consent line is offered only where there is something to be reached on: a phone or an email asked for on the form.
      const notice =
        widget.collectEmail || widget.collectPhone
          ? await this.notices.publicCurrent(tx, orgId, 'widget', widget.uuid)
          : null;
      const consent = notice
        ? { text: notice.text, version: notice.version, url: notice.url }
        : null;
      const gate = widget.ageGate;
      const ageGate = gate.enabled
        ? {
            mode: gate.mode,
            // Only the box names the age (its sentence must); a date of birth or an age question never says which answer passes.
            declaration_age:
              gate.mode === 'declaration'
                ? (gate.minAge ?? (await this.privacy.minorAge(tx, orgId)))
                : null,
            pending: visitor.ageCheckedAt === null,
          }
        : null;
      const lines: InboxLine[] =
        visitor.conversationId === null
          ? []
          : await this.inbox.oldest(tx, orgId, visitor.conversationId, TRANSCRIPT_LIMIT);
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
            age_gate: ageGate,
            whatsapp_url: whatsappUrl(widget),
            launcher: toPublicLauncher(widget.launcher),
            ...(flowUuid ? { flow_uuid: flowUuid } : {}),
            ...(consent ? { consent } : {}),
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

    // The age gate (BL-218) is judged BEFORE anything of the visitor is stored: a refused visitor leaves no row, no profile, no age.
    const age = await this.ageCheck(orgId, widget, req, data);

    const forInbox: WidgetForInbox = {
      id: widget.id,
      uuid: widget.uuid,
      userId: widget.userId,
      name: widget.name,
      welcomeMessage: widget.welcomeMessage,
      assistantUuid: widget.assistantUuid,
    };

    // A flow bot's widget: the flow runtime answers, so the visitor's line goes through the inbox's own pipeline.
    if (widget.flowId !== null) return this.flowMessage(orgId, widget, req, data, forInbox, age);

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
      await this.recordConsent(tx, orgId, widget.uuid, conversation.id, fresh, data);
      await this.recordGpc(tx, orgId, widget.uuid, conversation.id, fresh, req);
      await this.applyAge(tx, orgId, widget.uuid, visitor.id, conversation.id, fresh, age);
      const inbound = await this.inbox.insertInbound(
        tx,
        orgId,
        conversation,
        forInbox,
        visitor.visitorUuid,
        data.body,
      );
      // The history is read AFTER the visitor's line is stored, so the message appears both in the history and as
      // "Visitor just said" (TW-WGT-016 rule 4: reproduced deliberately).
      const history = await this.inbox.recent(tx, orgId, conversation.id, HISTORY_TURNS);
      const humanTookOver = await this.inbox.humanHasTakenOver(tx, orgId, conversation.id);
      let assistant: AssistantProfile | undefined;
      if (!humanTookOver && usesAi(widget) && widget.assistantId !== null) {
        assistant = await this.assistants.profile(tx, orgId, widget.assistantId);
      }
      if (humanTookOver) {
        this.logger.log(
          { widget: widget.uuid, conversationId: conversation.id },
          '[WGT] bot silenced: a person has taken over',
        );
      }
      return { visitor, conversation, history, inbound, assistant };
    });

    // 2. The vendor call, with no transaction open.
    let replyText: string | null = null;
    if (stored.assistant) {
      // What the agent knows about THIS message: the few best passages of its own knowledge base (it reads the whole base only when
      // the search cannot run). Read here, with no transaction open: the search may call the embedding vendor.
      const found = await this.kb.retrieve(orgId, stored.assistant.id, data.body);
      replyText = await this.aiReply.reply({
        orgId,
        assistant: stored.assistant,
        knowledge: found.passages.map((p) => ({
          label: p.label,
          kind: 'text',
          content: p.text,
          question: null,
          answer: null,
        })),
        grounded: found.grounded,
        history: stored.history,
        visitorMessage: data.body,
      });
    }

    // The model (or the visitor's keyword) asked for a person: the same handoff a flow node makes (BL-399). The marker never reaches the visitor.
    let handoffAsked: { reason: string | null } | null = null;
    if (stored.assistant && replyText !== null) {
      const read = readHandoff(stored.assistant, data.body, replyText);
      replyText = read.reply;
      if (read.handoff) handoffAsked = { reason: read.reason };
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

    if (handoffAsked && this.handoff) {
      try {
        const uuid = await this.db.txAs({ orgId }, async (tx) => {
          const r = await tx.execute(
            sql`SELECT uuid FROM conversations WHERE org_id = ${orgId} AND id = ${stored.conversation.id}`,
          );
          return (r.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
        });
        if (uuid) {
          await this.handoff.handoff({
            orgId,
            conversationUuid: uuid,
            source: 'ai_agent',
            reason: 'customer_asked',
            reasonText: handoffAsked.reason,
            summary: handoffAsked.reason,
            destination: { kind: 'rules' },
            idempotencyKey: `ai:${stored.inbound.id}`,
            messageText: data.body,
            actor: { kind: 'bot' },
          });
        }
      } catch (err) {
        // A failed handoff never costs the visitor their answer; the conversation stays where it is.
        this.logger.warn({ widget: widget.uuid, err: String(err) }, '[WGT] handoff failed');
      }
    }

    return { ok: true, inbound: { id: stored.inbound.id }, reply };
  }

  /**
   * The age gate of the intake form (BL-218, spec 11.10). Off for most widgets. A visitor who already passed is not asked again; any
   * other visitor must answer on the first message. `block` refuses the chat with a neutral 403 (nothing is stored; the page remembers
   * for the session), `flag` lets it through and the contact is flagged once it exists. With the box and `block`, an unticked box is
   * only an unanswered question (422), because nobody has said anything yet.
   */
  private async ageCheck(
    orgId: number,
    widget: WidgetRow,
    req: PublicRequest,
    data: WidgetMessageRequest,
  ): Promise<AgeCheck | null> {
    const gate = widget.ageGate;
    if (!gate.enabled) return null;
    const known = await this.db.txAs({ orgId }, async (tx) => {
      const found = await this.resolveVisitor(tx, orgId, widget, req, false);
      return found?.visitor;
    });
    if (known?.ageCheckedAt) return null;
    const minAge =
      gate.minAge ?? (await this.db.txAs({ orgId }, (tx) => this.privacy.minorAge(tx, orgId)));
    const verdict = judgeAgeAnswer(
      {
        mode: gate.mode,
        dob: data.date_of_birth ?? undefined,
        age: data.age ?? undefined,
        confirmed: data.age_confirmed === true,
      },
      minAge,
      new Date(),
    );
    const unanswered = () =>
      new WidgetPublicError(422, {
        message: 'Please answer the question before you continue.',
        errors: { age: ['required'] },
      });
    if (verdict.kind === 'invalid') throw unanswered();
    if (verdict.kind === 'adult') return { verdict };
    if (gate.mode === 'declaration' && gate.whenUnder === 'block') throw unanswered();
    if (gate.whenUnder === 'block') {
      throw new WidgetPublicError(403, {
        ok: false,
        code: 'age_blocked',
        message: 'We are not able to continue this chat.',
      });
    }
    return { verdict };
  }

  /**
   * The visitor passed the gate: remember it (they are not asked again), write the date of birth they gave, and flag the contact when
   * the answer was under the line. A contact exists only once the visitor gave a phone number or an email, so without one there is
   * nothing to write to. Best effort in a savepoint: the visitor's message is never lost over it.
   */
  private async applyAge(
    tx: Tx,
    orgId: number,
    widgetUuid: string,
    visitorId: number,
    conversationId: number,
    visitor: VisitorForInbox,
    age: AgeCheck | null,
  ): Promise<void> {
    if (!age) return;
    await this.visitors.markAgeChecked(tx, orgId, visitorId);
    try {
      await tx.transaction(async (sp) => {
        const contactId = await this.inbox.contactOf(sp as Tx, orgId, conversationId, {
          email: visitor.email,
          phone: visitor.phone,
        });
        if (contactId === null) return;
        const v = age.verdict;
        await this.minors.applyAnswer(sp as Tx, orgId, contactId, {
          dob: v.mode === 'dob' ? (v.dob ?? null) : null,
          under:
            v.kind === 'under'
              ? {
                  source: v.mode === 'declaration' ? 'declaration' : 'dob',
                  minorUntil: v.minorUntil,
                }
              : null,
          evidence: { widgetId: widgetUuid },
        });
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[WGT] the age answer could not be applied');
    }
  }

  /**
   * The visitor ticked the consent line of the intake form: a grant on the channels they gave (WhatsApp for a phone, email for an
   * address), against the version of the wording their page showed. Written only when the box was ticked, the version is a real,
   * enabled version of THIS widget's notice, and the thread has a contact; never an IP or a user agent. Best effort by design: a
   * failure here (in a savepoint) never loses the visitor's message.
   */
  private async recordConsent(
    tx: Tx,
    orgId: number,
    widgetUuid: string,
    conversationId: number,
    visitor: VisitorForInbox,
    data: { consent?: boolean | null; consent_version?: number | null },
  ): Promise<void> {
    if (data.consent !== true || !data.consent_version) return;
    try {
      await tx.transaction(async (sp) => {
        const notice = await this.notices.seen(
          sp as Tx,
          orgId,
          'widget',
          widgetUuid,
          data.consent_version!,
        );
        if (!notice) return;
        const contactId = await this.inbox.contactOf(sp as Tx, orgId, conversationId, {
          email: visitor.email,
          phone: visitor.phone,
        });
        if (contactId === null) return;
        const channels: ConsentChannel[] = noticeGrantChannels(notice, {
          phone: phoneDigits(visitor.phone) !== '',
          email: Boolean(visitor.email),
        });
        if (channels.length === 0) return;
        await this.consentIntake.grant(sp as Tx, orgId, {
          contactId,
          channels,
          source: 'widget',
          proof: { text: notice.text, version: String(notice.version) },
          evidence: {
            widgetId: widgetUuid,
            noticeVersion: String(notice.version),
            noticeUrl: notice.url,
          },
          keyBase: `widget:${widgetUuid}:${visitor.visitorUuid}:v${notice.version}`,
          fallbackNote: 'Ticked the consent line on the website chat form',
        });
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[WGT] consent could not be recorded');
    }
  }

  /**
   * The visitor's browser sent the Global Privacy Control signal (`Sec-GPC: 1`): record the Do Not Sell or Share opt-out of the thread's
   * contact, but only when the workspace has `ccpa_us` on and the visitor has given a phone or an email (otherwise there is no contact
   * to record it for; a later message that carries one does). Once per visitor of this widget. Best effort in a savepoint, like the
   * consent line: a failure never loses the visitor's message. Nothing but the widget id is kept as evidence.
   */
  private async recordGpc(
    tx: Tx,
    orgId: number,
    widgetUuid: string,
    conversationId: number,
    visitor: VisitorForInbox,
    req: PublicRequest,
  ): Promise<void> {
    if (req.gpc !== true) return;
    try {
      await tx.transaction(async (sp) => {
        const contactId = await this.inbox.contactOf(sp as Tx, orgId, conversationId, {
          email: visitor.email,
          phone: visitor.phone,
        });
        if (contactId === null) return;
        await this.privacy.recordGpc(sp as Tx, orgId, contactId, {
          keyBase: `widget:${widgetUuid}:${visitor.visitorUuid}`,
          evidence: { widgetId: widgetUuid },
        });
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[WGT] GPC opt-out could not be recorded');
    }
  }

  /** The visitor, their thread and its channel for a flow bot's widget, as the inbox's ingest names them. */
  private async flowPeer(
    orgId: number,
    widget: WidgetRow,
    req: PublicRequest,
    forInbox: WidgetForInbox,
    data: Pick<WidgetMessageRequest, 'name' | 'email' | 'phone' | 'consent' | 'consent_version'>,
    age: AgeCheck | null,
  ): Promise<{ peerKey: string; peerName: string | null; channelUuid: string }> {
    return this.db.txAs({ orgId }, async (tx) => {
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
      await this.recordConsent(tx, orgId, widget.uuid, conversation.id, fresh, data);
      await this.recordGpc(tx, orgId, widget.uuid, conversation.id, fresh, req);
      await this.applyAge(tx, orgId, widget.uuid, visitor.id, conversation.id, fresh, age);
      return {
        peerKey: visitor.visitorUuid,
        peerName: fresh.name,
        channelUuid: await this.inbox.channelUuidOf(tx, orgId, conversation.id),
      };
    });
  }

  /**
   * A message to a flow bot's widget. The visitor and the thread are kept here as for any widget, but the line itself is not
   * written here: it joins the inbox's ingest queue like a message from any channel, so the worker stores it and the flow runtime
   * starts or resumes the bot. The answer reaches the visitor through the history poll, so `reply` is always null.
   */
  private async flowMessage(
    orgId: number,
    widget: WidgetRow,
    req: PublicRequest,
    data: WidgetMessageRequest,
    forInbox: WidgetForInbox,
    age: AgeCheck | null,
  ): Promise<WidgetMessageResponse> {
    const prepared = await this.flowPeer(orgId, widget, req, forInbox, data, age);
    const tapped = data.tap_id ? { interactive: { id: data.tap_id, title: data.body } } : undefined;
    await this.ingest.enqueueInbound(orgId, prepared.channelUuid, {
      providerMessageId: `wgt-${randomUUID()}`,
      peerKey: prepared.peerKey,
      ...(prepared.peerName ? { peerName: prepared.peerName } : {}),
      kind: tapped ? 'interactive' : 'text',
      body: data.body,
      ...(tapped ? { meta: tapped } : {}),
      providerTimestamp: new Date(),
    });
    return { ok: true, inbound: { id: 0 }, reply: null };
  }

  /**
   * A file the visitor attaches to answer a question that asked for one (`POST /widget/<token>/api/upload`). The bytes are checked and
   * staged in the media store (the content decides the type, never the name), then the visitor's line goes through the inbox's own
   * pipeline as a media message, like a photo on WhatsApp, so the flow's "Ask for file" step receives it. Flow bots only.
   */
  async upload(
    token: string,
    req: PublicRequest,
    file: { buffer: Buffer; originalname: string } | undefined,
  ): Promise<{ ok: true; name: string }> {
    const { orgId, widget } = await this.locateActive(token);
    if (widget.flowId === null)
      throw new WidgetPublicError(422, { message: 'This chat does not take files.' });
    if (!file || file.buffer.length === 0)
      throw new WidgetPublicError(422, { message: 'Choose a file to send.' });
    let stored;
    try {
      stored = await this.media.store({
        orgId,
        filename: file.originalname || 'file',
        buffer: file.buffer,
      });
    } catch (err) {
      throw new WidgetPublicError(422, {
        message: err instanceof Error && err.message ? err.message : 'That file cannot be sent.',
      });
    }
    const forInbox: WidgetForInbox = {
      id: widget.id,
      uuid: widget.uuid,
      userId: widget.userId,
      name: widget.name,
      welcomeMessage: widget.welcomeMessage,
      assistantUuid: widget.assistantUuid,
    };
    const peer = await this.flowPeer(orgId, widget, req, forInbox, {}, null);
    const mime = stored.mime;
    await this.ingest.enqueueInbound(orgId, peer.channelUuid, {
      providerMessageId: `wgt-${randomUUID()}`,
      peerKey: peer.peerKey,
      ...(peer.peerName ? { peerName: peer.peerName } : {}),
      kind: 'media',
      media: {
        // The staged object: the channel's `fetchMedia` reads it back and ingest stores the final copy.
        providerMediaId: stored.key,
        mediaKind: mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
            ? 'video'
            : mime.startsWith('audio/')
              ? 'audio'
              : 'document',
        mime,
        name: stored.name,
        sizeBytes: stored.size,
      },
      providerTimestamp: new Date(),
    });
    return { ok: true, name: stored.name };
  }

  // --- history --------------------------------------------------------------------------------------------------------

  /**
   * Business lines newer than `since`, so a person's reply from the team inbox reaches the open widget.
   */
  async history(token: string, req: PublicRequest, since: number): Promise<WidgetHistoryResponse> {
    // QUIRK: reproduced deliberately (TW-WGT-018 rule 1, TW-WGT-011 rule 4). The history route does not look at the status, so
    // a paused widget still serves it; and an unknown or missing visitor uuid creates a visitor row on every poll.
    const found = await this.locate(token);
    if (!found) throw notFound();
    const { orgId, widget } = found;
    return this.db.txAs({ orgId }, async (tx) => {
      const resolved = (await this.resolveVisitor(tx, orgId, widget, req, true))!;
      await this.visitors.touch(tx, orgId, resolved.visitor.id);
      if (resolved.visitor.conversationId === null) return { ok: true as const, messages: [] };
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
          ...(m.buttons ? { buttons: m.buttons } : {}),
          ...(m.media ? { media: widgetMediaOf(m) } : {}),
          ...(m.input ? { input: m.input } : {}),
          ...(m.links && m.links.length ? { links: m.links } : {}),
          ...(m.cards && m.cards.length ? { cards: m.cards } : {}),
        })),
      };
    });
  }

  /**
   * A visitor's thumbs up or down on a line the bot sent them, kept on that line (`meta.feedback`) for the team to read. Only a line of
   * the visitor's own thread can be marked; anything else is the same 404.
   */
  /**
   * "Restart this chat" and "Close this chat": the visitor starts over with a fresh visitor (and so a fresh conversation); the old
   * thread stays in the team inbox as it was. The new uuid is returned for the cookie and the window's own storage.
   */
  async restart(
    token: string,
    req: PublicRequest,
  ): Promise<{ widgetUuid: string; visitorUuid: string }> {
    const { orgId, widget } = await this.locateActive(token);
    const visitor = await this.db.txAs({ orgId }, (tx) =>
      this.visitors.create(tx, orgId, widget.id, {
        referrer: req.referer.slice(0, 1024),
        userAgent: req.userAgent.slice(0, 512),
        ip: req.ip,
      }),
    );
    return { widgetUuid: widget.uuid, visitorUuid: visitor.visitorUuid };
  }

  async feedback(token: string, req: PublicRequest, rawBody: unknown): Promise<{ ok: true }> {
    const parsed = widgetFeedbackRequestSchema.safeParse(rawBody ?? {});
    if (!parsed.success)
      throw new WidgetPublicError(422, { message: 'The given data was invalid.' });
    const { orgId, widget } = await this.locateActive(token);
    const done = await this.db.txAs({ orgId }, async (tx) => {
      const resolved = await this.resolveVisitor(tx, orgId, widget, req, false);
      if (!resolved || resolved.visitor.conversationId === null) return false;
      return this.inbox.setFeedback(
        tx,
        orgId,
        resolved.visitor.conversationId,
        parsed.data.message_id,
        parsed.data.value,
      );
    });
    if (!done) throw notFound();
    return { ok: true };
  }

  /**
   * A file a flow bot sent this visitor: the stored object's key and type, only when the line is on the visitor's own thread. A
   * missing visitor, thread or file is the same 404, so the route confirms nothing about other visitors' files.
   */
  async mediaFile(
    token: string,
    req: PublicRequest,
    id: number,
  ): Promise<{ orgId: number; key: string; mime: string; name: string }> {
    const found = await this.locate(token);
    if (!found) throw notFound();
    const { orgId, widget } = found;
    const line = await this.db.txAs({ orgId }, async (tx) => {
      const resolved = await this.resolveVisitor(tx, orgId, widget, req, false);
      if (!resolved || resolved.visitor.conversationId === null) return null;
      return this.inbox.mediaOf(tx, orgId, resolved.visitor.conversationId, id);
    });
    if (!line) throw notFound();
    return { orgId, key: line.key, mime: line.mime, name: line.name };
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
