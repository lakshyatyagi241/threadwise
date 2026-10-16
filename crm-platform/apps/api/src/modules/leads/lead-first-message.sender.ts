import { Inject, Injectable, Logger } from '@nestjs/common';
import { type PurposeInput, type SpeedToLead } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  EngineSenderRegistry,
  SenderRefused,
  SenderThrottled,
  buildRecipientVars,
  renderPlainBody,
} from '../broadcasts';
import {
  CONVERSATIONS_FACADE,
  ChannelsFacade,
  type ConversationsFacade,
} from '../chat-conversations';
import { ConsentGate } from '../contact-consent';
import { MergeTagService, renderMergeTags, resolveToken, type ContactRow } from '../crm';
import { EmailTemplatesService } from '../email-templates';
import { TemplatesRepository, tokensOf, type TemplateRow } from '../message-templates';
import { LeadFirstMessageLookups } from './lead-first-message.lookups';
import { factsOf, shapeOf } from './lead-first-message.templates';
import type { FirstReplyRow } from './lead-first-replies.repository';
import { templateProblem, verdictOfCode, type Verdict } from './lead-first-reply.rules';

/** What a prepared first message did when it was delivered. */
export type DeliverOutcome = { kind: 'sent' } | { kind: 'verdict'; verdict: Verdict };

/** A message that is ready to go: who decides whether it may (the purpose), and the delivery itself. */
export interface Prepared {
  /** What the send IS for the ConsentGate and the quiet hours: a WhatsApp template takes its category; SMS and email are marketing. */
  purpose: PurposeInput;
  /** The address the quiet hours and the consent are asked about. */
  target: { phone: string | null; email: string | null };
  deliver(): Promise<DeliverOutcome>;
}

/** The message cannot go, and why. */
type Refusal = { kind: 'verdict'; verdict: Verdict };
export type Preparation = { kind: 'ready'; prepared: Prepared } | Refusal;

const skip = (reason: Verdict['reason']): Refusal => ({
  kind: 'verdict',
  verdict: { status: 'skipped', reason },
});

const digitsOf = (v: string | null): string => (v ?? '').replace(/\D/g, '');

/** WhatsApp refuses a body parameter with a line break, a tab or four spaces in a row (error 132018). */
const BAD_PARAMETER = /[\n\r\t]| {4,}/;

/**
 * What an SMS or email engine says when it cannot send, as a verdict. The engines throw the operator's sentence (the broadcast screens
 * show it as is), so this reads the sentence; anything it does not recognise is a provider failure, never a guess at consent or plan.
 */
export function verdictOfEngineError(err: unknown): Verdict {
  if (err instanceof SenderThrottled) return { status: 'held', reason: 'channel_unavailable' };
  const message = err instanceof Error ? err.message : '';
  if (/no sendable|not connected|cannot be read|reconnect/i.test(message))
    return { status: 'skipped', reason: 'no_sender' };
  if (/plan does not include|plan's limit|reached your plan/i.test(message))
    return { status: 'blocked', reason: 'plan_limit' };
  if (/opted out/i.test(message)) return { status: 'blocked', reason: 'opted_out' };
  if (/no recorded consent/i.test(message)) return { status: 'blocked', reason: 'no_consent' };
  if (err instanceof SenderRefused) return { status: 'failed', reason: 'provider_error' };
  return { status: 'failed', reason: 'provider_error' };
}

/**
 * Prepares and delivers the first message of a new lead on each channel (BL-014, spec L-16). It owns what differs per channel (which
 * template, which sender, how the text is made); the decision whether the message may go (business hours, quiet hours, the
 * ConsentGate) is the service's and uses what `prepare` returns.
 *
 * WhatsApp goes through the conversation core (`enqueueOutbound`): the message lands in the contact's inbox thread, and the dispatcher
 * checks the connection, the plan's monthly cap, the wallet, the emergency halt and the consent again at send time, holding a marketing
 * template for the quiet hours. The idempotency key is the first reply's own uuid, so a retry never sends a second message.
 *
 * SMS and email go through the engines the broadcast and campaign screens use (`EngineSenderRegistry`), which enforce the sender's
 * connection, the plan's cap and, for email, the bounce list and the unsubscribe link. They have no idempotency key: the service never
 * retries an SMS or an email whose delivery was interrupted.
 */
@Injectable()
export class LeadFirstMessageSender {
  private readonly logger = new Logger(LeadFirstMessageSender.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly lookups: LeadFirstMessageLookups,
    private readonly templates: TemplatesRepository,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly merge: MergeTagService,
    private readonly consentGate: ConsentGate,
    private readonly channels: ChannelsFacade,
    private readonly engines: EngineSenderRegistry,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async prepare(
    orgId: number,
    reply: FirstReplyRow,
    config: SpeedToLead,
    contact: ContactRow,
    now: Date,
  ): Promise<Preparation> {
    if (!config.templateId) return skip('template_unavailable');
    switch (reply.channel) {
      case 'whatsapp':
        return this.whatsapp(orgId, reply, config.templateId, contact, now);
      case 'sms':
        return this.sms(orgId, reply, config, config.templateId, contact, now);
      case 'email':
        return this.email(orgId, reply, config, config.templateId, contact);
    }
  }

  // --- WhatsApp ----------------------------------------------------------------------------------------------------------------

  private async whatsapp(
    orgId: number,
    reply: FirstReplyRow,
    templateId: string,
    contact: ContactRow,
    now: Date,
  ): Promise<Preparation> {
    if (!contact.phone) return skip('no_contact_point');
    const ready = await this.db.txAs({ orgId }, async (tx) => {
      const tpl = await this.templates.findByUuid(tx, orgId, templateId);
      if (!tpl || (await this.lookups.templateChannel(tx, orgId, templateId)) !== 'whatsapp') {
        return skip('template_unavailable');
      }
      if (templateProblem(factsOf(tpl), now) !== null) return skip('template_unavailable');

      const all = await this.channels.list(tx, orgId);
      const mine = all.filter(
        (c) => c.kind === 'whatsapp_cloud' && c.wabaConfigId === tpl.providerConfigId,
      );
      const channel = mine.find((c) => c.status === 'connected') ?? mine[0];
      if (!channel) return skip('no_sender');
      if (channel.status !== 'connected') {
        return {
          kind: 'verdict',
          verdict: { status: 'held', reason: 'channel_unavailable' },
        } satisfies Refusal;
      }

      const values = await this.bodyValues(tx, orgId, contact.id, tpl);
      const tokens = tokensOf(tpl.templateBody);
      const variables: Record<string, string> = {};
      for (const [i, token] of tokens.entries()) variables[token] = (values[i] ?? '').trim();
      // Meta refuses an empty or malformed parameter; a lead with no name must not become a failed send nobody understands.
      if (Object.values(variables).some((v) => v === '' || BAD_PARAMETER.test(v))) {
        return skip('missing_value');
      }
      const purpose = await this.consentGate.purposeOfTemplate(
        orgId,
        tpl.templateName,
        tpl.language,
        tx,
      );
      return { kind: 'data' as const, tpl, channelUuid: channel.uuid, variables, purpose };
    });
    if (ready.kind === 'verdict') return ready;

    const { tpl, channelUuid, variables, purpose } = ready;
    return {
      kind: 'ready',
      prepared: {
        purpose,
        target: { phone: contact.phone, email: null },
        deliver: async () => {
          try {
            const thread = await this.conversations.openConversationFor(contact.uuid, channelUuid);
            await this.conversations.enqueueOutbound({
              conversationId: thread.id,
              // The first reply's own id: the conversation ledger returns the first message for a repeat, so a retry cannot double-send.
              clientMessageId: reply.uuid,
              content: {
                kind: 'template',
                name: tpl.templateName,
                language: tpl.language,
                variables,
                body: tpl.templateBody.replace(
                  /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
                  (m: string, t: string) => variables[t] ?? m,
                ),
                templateId: tpl.id,
              },
              sender: { kind: 'bot' },
            });
            return { kind: 'sent' };
          } catch (err) {
            if (err instanceof AppError) {
              const verdict = verdictOfCode(err.code);
              if (verdict) return { kind: 'verdict', verdict };
              // The contact's number cannot be messaged (the conversation core could not read it): nothing to send to.
              if (err.getStatus() === 422 && /phone number/i.test(err.message)) {
                return {
                  kind: 'verdict',
                  verdict: { status: 'skipped', reason: 'no_contact_point' },
                };
              }
            }
            throw err;
          }
        },
      },
    };
  }

  // --- SMS ---------------------------------------------------------------------------------------------------------------------

  private async sms(
    orgId: number,
    reply: FirstReplyRow,
    config: SpeedToLead,
    templateId: string,
    contact: ContactRow,
    now: Date,
  ): Promise<Preparation> {
    const digits = digitsOf(contact.phone);
    if (!digits) return skip('no_contact_point');
    const engine = this.engines.get('sms');
    if (!engine) return skip('no_sender');

    const ready = await this.db.txAs({ orgId }, async (tx) => {
      const tpl = await this.templates.findByUuid(tx, orgId, templateId);
      if (!tpl || (await this.lookups.templateChannel(tx, orgId, templateId)) !== 'sms') {
        return skip('template_unavailable');
      }
      if (
        (tpl.status !== 'approved' && tpl.status !== 'public') ||
        (tpl.pausedUntil && tpl.pausedUntil.getTime() > now.getTime())
      ) {
        return skip('template_unavailable');
      }
      const sender = await this.lookups.smsSender(tx, orgId, config.senderId ?? null);
      if (!sender) return skip('no_sender');

      const base = await this.merge.baseContext(tx, orgId);
      const mc = await this.merge.contactFor(tx, orgId, contact.id);
      const ctx = { ...base, contact: mc };
      const vars = buildRecipientVars(shapeOf(tpl), {
        pull: (key) => resolveToken(key, ctx).value,
        mediaUrl: () => null,
      });
      // An SMS template with `{{first_name}}` and no variable map is filled from the contact itself, as the broadcast screen does.
      const text = (
        vars.body === undefined
          ? renderMergeTags(tpl.templateBody, ctx).rendered
          : renderPlainBody(tpl.templateBody, vars.body)
      ).trim();
      if (text === '') return skip('template_unavailable');
      return { kind: 'data' as const, sender, text };
    });
    if (ready.kind === 'verdict') return ready;

    const { sender, text } = ready;
    return {
      kind: 'ready',
      prepared: {
        // SMS has no template categories in this product: every SMS a business starts is marketing until a person recorded the opposite.
        purpose: 'marketing_messaging',
        target: { phone: contact.phone, email: null },
        deliver: async () => {
          try {
            const opened = await engine.open(orgId, {
              engine: 'sms',
              id: sender.id,
              phoneDigits: sender.phoneDigits,
              label: sender.label,
            });
            if (!opened.sendText) return failed('provider_error');
            await opened.sendText({ to: digits, text, clientReference: refOf(reply, contact) });
            return { kind: 'sent' };
          } catch (err) {
            return this.engineFailure(err);
          }
        },
      },
    };
  }

  // --- email -------------------------------------------------------------------------------------------------------------------

  private async email(
    orgId: number,
    reply: FirstReplyRow,
    config: SpeedToLead,
    templateId: string,
    contact: ContactRow,
  ): Promise<Preparation> {
    if (!contact.email) return skip('no_contact_point');
    const engine = this.engines.get('email');
    if (!engine) return skip('no_sender');

    const ready = await this.db.txAs({ orgId }, async (tx) => {
      const mailbox = await this.lookups.mailbox(tx, orgId, config.senderId ?? null);
      if (!mailbox) return skip('no_sender');
      const base = await this.merge.baseContext(tx, orgId);
      const mc = await this.merge.contactFor(tx, orgId, contact.id);
      const rendered = await this.emailTemplates.renderShared(tx, orgId, templateId, {
        contact: mc,
        base,
        peerName: contact.name,
      });
      if (rendered.kind !== 'ok') return skip('template_unavailable');
      if (rendered.text.trim() === '' || rendered.subject.trim() === '') {
        return skip('template_unavailable');
      }
      return { kind: 'data' as const, mailbox, subject: rendered.subject, text: rendered.text };
    });
    if (ready.kind === 'verdict') return ready;

    const { mailbox, subject, text } = ready;
    const to = contact.email;
    return {
      kind: 'ready',
      prepared: {
        // The email engine sends every mail as marketing (with the unsubscribe link), so the gate is asked the same question.
        purpose: 'marketing_messaging',
        target: { phone: null, email: to },
        deliver: async () => {
          try {
            const opened = await engine.open(orgId, {
              engine: 'email',
              id: mailbox.id,
              phoneDigits: mailbox.address,
              label: mailbox.label,
            });
            if (!opened.sendText) return failed('provider_error');
            await opened.sendText({
              to,
              text,
              header: subject,
              clientReference: refOf(reply, contact),
            });
            return { kind: 'sent' };
          } catch (err) {
            return this.engineFailure(err);
          }
        },
      },
    };
  }

  // --- shared ------------------------------------------------------------------------------------------------------------------

  /** The body values of a template for this contact, in the template's own variable order (its variable map decides what each is). */
  private async bodyValues(
    tx: Tx,
    orgId: number,
    contactId: number,
    tpl: TemplateRow,
  ): Promise<string[]> {
    const base = await this.merge.baseContext(tx, orgId);
    const mc = await this.merge.contactFor(tx, orgId, contactId);
    const ctx = { ...base, contact: mc };
    const vars = buildRecipientVars(shapeOf(tpl), {
      pull: (key) => resolveToken(key, ctx).value,
      mediaUrl: () => null,
    });
    return vars.body ?? [];
  }

  private engineFailure(err: unknown): DeliverOutcome {
    const verdict = verdictOfEngineError(err);
    if (verdict.reason === 'provider_error') {
      // The provider's sentence can carry a number or an address: it goes to the log's error field, never to the row or the timeline.
      this.logger.warn(
        { err: err instanceof Error ? err.message : 'unknown' },
        'first message failed',
      );
    }
    return { kind: 'verdict', verdict };
  }
}

const failed = (reason: Verdict['reason']): DeliverOutcome => ({
  kind: 'verdict',
  verdict: { status: 'failed', reason },
});

/**
 * The reference an SMS or an email carries. It must NOT look like `bcast-<n>-<contact>` or `camp-<n>-<contact>`: those are matched to
 * campaign recipients by the engines and the receipt handlers. The contact's id is in it for the sender's own bookkeeping only.
 */
const refOf = (reply: FirstReplyRow, contact: ContactRow): string =>
  `lead-first-${reply.id}-${contact.id}`;
