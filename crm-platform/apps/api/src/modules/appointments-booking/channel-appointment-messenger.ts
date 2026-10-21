import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { holdOf, type PurposeInput } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import type {
  AppointmentMessenger,
  BookingMessage,
  BookingMessageResult,
} from '../../infra/providers/appointments-booking';
import { EngineSenderRegistry, SenderRefused, SenderThrottled } from '../broadcasts';
import {
  CONVERSATIONS_FACADE,
  ChannelsFacade,
  type ConversationsFacade,
} from '../chat-conversations';
import { SendWindowService } from '../compliance-center';
import { ConsentGate } from '../contact-consent';
import { ContactsRepository } from '../crm';
import { kindOfButton } from '../../infra/providers/whatsapp/template-vocab';
import { TemplatesRepository, tokensOf } from '../message-templates';
import { AppointmentChannelsRepository } from './appointment-channels.repository';
import {
  digitsOf,
  outcomeOfCode,
  outcomeOfDenial,
  templateProblem,
  waTemplateValues,
  type ChannelOutcome,
} from './appointment-reminder.rules';

/** The ConsentGate's channel name for each channel a booking message can use (the Cloud API is the only WhatsApp that has templates). */
const CONSENT_CHANNEL = { whatsapp: 'whatsapp_cloud', email: 'email' } as const;
const DAY_MS = 24 * 3_600_000;
/** A reminder is not pushed by quiet hours to within this long of the booking's start: it would arrive as the person walks in. */
const LATE_MARGIN_MS = 5 * 60_000;

type Raw = Record<string, unknown>;

/** A UUID made from the message's idempotency key: the same key is the same id, so the conversation ledger sends it once. */
export function uuidOfKey(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** What the email engine says when it cannot send, as an outcome; the engine throws the operator's sentence. */
export function outcomeOfEngineError(err: unknown): ChannelOutcome {
  if (err instanceof SenderThrottled) return { status: 'held', reason: 'channel_unavailable' };
  const message = err instanceof Error ? err.message : '';
  if (/no sendable|not connected|cannot be read|reconnect/i.test(message)) {
    return { status: 'skipped', reason: 'no_sender' };
  }
  if (/plan does not include|plan's limit|reached your plan/i.test(message)) {
    return { status: 'skipped', reason: 'plan_limit' };
  }
  if (/opted out/i.test(message)) return { status: 'skipped', reason: 'opted_out' };
  if (/no recorded consent/i.test(message)) return { status: 'skipped', reason: 'no_consent' };
  if (err instanceof SenderRefused) return { status: 'failed', reason: 'provider_error' };
  return { status: 'failed', reason: 'provider_error' };
}

const toResult = (o: ChannelOutcome, until?: string): BookingMessageResult => {
  switch (o.status) {
    case 'sent':
      return {
        status: 'sent',
        ...(o.providerMessageId ? { providerMessageId: o.providerMessageId } : {}),
      };
    case 'held':
      return {
        status: 'held',
        reason: o.reason,
        ...((o.until ?? until) ? { holdUntil: (o.until ?? until)! } : {}),
      };
    default:
      return { status: o.status, reason: o.reason };
  }
};

/**
 * The real customer messenger of the booking domain (BL-283; it replaces `NoAppointmentMessenger`). A finished booking message arrives
 * through the `APPOINTMENT_MESSENGER` port and leaves through the stack the rest of the product already sends with, not a new transport:
 *
 *  - WhatsApp goes through the conversation core (`enqueueOutbound`), so the message lands in the contact's thread and the dispatcher
 *    checks the connection, the plan's cap, the wallet and the emergency halt again at send time. The Cloud API only allows free text
 *    inside the 24 hour window, so outside it the message needs an approved template; without one WhatsApp is skipped (the run then
 *    falls to its next channel). A QR (unofficial) number sends text anywhere.
 *  - Email goes through the engine the broadcast screens use (`EngineSenderRegistry`), which enforces the sender's connection and the
 *    plan's cap and the bounce list. SMS is not a channel of appointment messages (DLT and per-country rules make it unreliable).
 *
 * Before anything is delivered, in this order: the address exists, the quiet hours (reminders and follow-ups only: HOLD, never deny, and a
 * reminder they would push past the booking is skipped instead), and the ConsentGate (withdrawn consent, do-not-call, minors). A
 * confirmation or cancellation is a service message the person asked for and is not held by quiet hours.
 *
 * Idempotent on `idempotencyKey` for WhatsApp (the conversation ledger returns the first message for a repeat). Email has no key at the
 * engine, so the caller never retries a delivery that was interrupted. The message text and the address never reach a result, a run or the timeline; a
 * provider's own error sentence goes to the log's error field only.
 */
@Injectable()
export class ChannelAppointmentMessenger implements AppointmentMessenger {
  readonly name = 'channels';
  private readonly logger = new Logger(ChannelAppointmentMessenger.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly contacts: ContactsRepository,
    private readonly consentGate: ConsentGate,
    private readonly sendWindow: SendWindowService,
    private readonly channels: ChannelsFacade,
    private readonly engines: EngineSenderRegistry,
    private readonly templates: TemplatesRepository,
    private readonly channelSettings: AppointmentChannelsRepository,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async send(m: BookingMessage): Promise<BookingMessageResult> {
    try {
      return toResult(await this.attempt(m));
    } catch (err) {
      // The provider's sentence can carry a number or an address: it goes to the log's error field only, never to the result.
      this.logger.warn(
        { err: err instanceof Error ? err.message : 'unknown', channel: m.channel, event: m.event },
        'booking message failed',
      );
      return { status: 'failed', reason: 'provider_error' };
    }
  }

  private async attempt(m: BookingMessage): Promise<ChannelOutcome> {
    if (m.channel !== 'whatsapp' && m.channel !== 'email') {
      return { status: 'skipped', reason: 'no_channel' };
    }
    const channel = m.channel;
    // The workspace owner decides which channels carry appointment messages (BL-350). Asked here, at send time, so switching a channel
    // off also stops what was scheduled before; the run then falls to its next channel.
    const gate = await this.db.txAs({ orgId: m.orgId, userId: null }, (tx) =>
      this.channelSettings.gate(tx, m.orgId, channel),
    );
    if (!gate.enabled) return { status: 'skipped', reason: 'channel_disabled' };
    const phone = digitsOf(m.to.phone);
    if (channel === 'email' ? !m.to.email : phone === '') {
      return { status: 'skipped', reason: 'no_contact_point' };
    }
    const contact = m.contactId
      ? await this.db.txAs({ orgId: m.orgId, userId: null }, (tx) =>
          this.contacts.findByUuid(tx, m.orgId, m.contactId!),
        )
      : undefined;
    if (channel === 'whatsapp' && !contact)
      return { status: 'skipped', reason: 'no_contact_point' };

    // Prepare first (it finds the sender and the template), so the quiet hours and the gate are asked about what will really be sent.
    const prepared = await this.prepare(
      m,
      channel,
      phone,
      contact?.uuid ?? null,
      gate.defaultSenderId,
    );
    if (prepared.kind === 'refused') return prepared.outcome;

    // A test to a staff member's own mailbox is not a message to a customer: no quiet hours, no consent to ask.
    if (m.isTest) {
      if (channel !== 'email') return { status: 'skipped', reason: 'no_channel' };
      return prepared.deliver();
    }

    const quiet = await this.quietHours(m, contact?.id ?? null, phone);
    if (quiet) return quiet;

    const verdict = await this.consentGate.check(
      m.orgId,
      contact
        ? { type: 'contact', id: contact.id }
        : channel === 'email'
          ? { type: 'email', email: m.to.email ?? '' }
          : { type: 'phone', phone },
      CONSENT_CHANNEL[channel],
      prepared.purpose,
    );
    if (verdict.decision !== 'allow') return outcomeOfDenial(verdict.reason);

    return prepared.deliver();
  }

  // --- quiet hours --------------------------------------------------------------------------------------------------------------

  /**
   * The workspace's quiet hours for a reminder or follow-up: a HOLD until they end. A reminder they would push to within minutes of
   * the booking (or past it) is skipped, because a reminder after the start is worse than none. Null = go.
   */
  private async quietHours(
    m: BookingMessage,
    contactId: number | null,
    phone: string,
  ): Promise<ChannelOutcome | null> {
    // A confirmation, a cancellation and a reschedule notice are service messages the person asked for; everything else waits.
    if (m.event === 'confirmation' || m.event === 'cancellation' || m.event === 'reschedule') {
      return null;
    }
    const decision = await this.sendWindow.check(m.orgId, 'message', {
      contactId,
      phone: phone || null,
      email: m.to.email,
    });
    const hold = holdOf(decision);
    if (!hold) return null;
    if (m.event === 'reminder' && m.notAfter) {
      if (new Date(hold.until).getTime() >= new Date(m.notAfter).getTime() - LATE_MARGIN_MS) {
        return { status: 'skipped', reason: 'quiet_hours_too_late' };
      }
    }
    return { status: 'held', reason: 'quiet_hours', until: hold.until };
  }

  // --- per channel --------------------------------------------------------------------------------------------------------------

  private async prepare(
    m: BookingMessage,
    channel: 'whatsapp' | 'email',
    phone: string,
    contactUuid: string | null,
    preferredSenderId: number | null,
  ): Promise<
    | { kind: 'refused'; outcome: ChannelOutcome }
    | { kind: 'ready'; purpose: PurposeInput; deliver: () => Promise<ChannelOutcome> }
  > {
    const fallbackPurpose: PurposeInput =
      m.purpose === 'follow_up' ? 'marketing_messaging' : 'service_messaging';
    if (channel === 'whatsapp') {
      return this.whatsapp(m, contactUuid!, fallbackPurpose, preferredSenderId);
    }

    const engine = this.engines.get(channel);
    if (!engine) return refused({ status: 'skipped', reason: 'no_sender' });

    const mailbox = await this.db.txAs({ orgId: m.orgId, userId: null }, (tx) =>
      this.mailbox(tx, m.orgId, preferredSenderId),
    );
    if (!mailbox) return refused({ status: 'skipped', reason: 'no_sender' });
    return {
      kind: 'ready',
      purpose: fallbackPurpose,
      deliver: async () => {
        try {
          const opened = await engine.open(m.orgId, {
            engine: 'email',
            id: mailbox.id,
            phoneDigits: mailbox.address,
            label: mailbox.label,
          });
          if (!opened.sendText) return { status: 'failed', reason: 'provider_error' };
          await opened.sendText({
            to: m.to.email!,
            text: m.body,
            header: m.subject,
            clientReference: `appt-msg-${uuidOfKey(m.idempotencyKey).slice(0, 18)}`,
            screen: { bulk: false, source: 'appointment' },
          });
          return { status: 'sent' };
        } catch (err) {
          return outcomeOfEngineError(err);
        }
      },
    };
  }

  private async whatsapp(
    m: BookingMessage,
    contactUuid: string,
    fallbackPurpose: PurposeInput,
    preferredSenderId: number | null,
  ): Promise<
    | { kind: 'refused'; outcome: ChannelOutcome }
    | { kind: 'ready'; purpose: PurposeInput; deliver: () => Promise<ChannelOutcome> }
  > {
    const found = await this.db.txAs({ orgId: m.orgId, userId: null }, async (tx) => {
      const all = await this.channels.list(tx, m.orgId);
      const cloud = all.filter((c) => c.kind === 'whatsapp_cloud');
      const qr = all.filter((c) => c.kind === 'whatsapp_qr');
      const tpl = m.waTemplateId
        ? await this.templates.findByUuid(tx, m.orgId, m.waTemplateId)
        : null;
      return { cloud, qr, tpl };
    });
    const connectedQr = found.qr.find((c) => c.status === 'connected');
    const now = new Date();

    // A template is chosen: it is sent on the Cloud API number it was approved for.
    if (m.waTemplateId) {
      const tpl = found.tpl;
      const cloudMine = tpl
        ? found.cloud.filter((c) => c.wabaConfigId === tpl.providerConfigId)
        : [];
      const problem = tpl
        ? templateProblem(
            {
              status: tpl.status,
              metaStatus: tpl.metaStatus,
              pausedUntil: tpl.pausedUntil,
              templateType: tpl.templateType,
              attachmentType: tpl.attachmentType,
              parameterFormat: tpl.parameterFormat,
              headerTokenCount: tpl.header ? tokensOf(tpl.header).length : 0,
              dynamicButtonCount: dynamicButtons(tpl.buttons),
            },
            now,
          )
        : 'template_unavailable';
      const values = tpl
        ? waTemplateValues(tokensOf(tpl.templateBody).length, m.variables ?? {})
        : null;
      if (tpl && !problem && values) {
        const channel = cloudMine.find((c) => c.status === 'connected');
        if (!channel) {
          return cloudMine.length === 0
            ? refused({ status: 'skipped', reason: 'no_sender' })
            : refused({ status: 'held', reason: 'channel_unavailable' });
        }
        const tokens = tokensOf(tpl.templateBody);
        const variables: Record<string, string> = {};
        for (const [i, token] of tokens.entries()) variables[token] = values[i] ?? '-';
        const purpose = await this.consentGate.purposeOfTemplate(
          m.orgId,
          tpl.templateName,
          tpl.language,
        );
        // The template's own category decides the purpose: a marketing-category template is gated as marketing whatever the booking
        // says, so a reminder cannot borrow the service purpose to send marketing content.
        const components = quickReplyComponents(
          tpl.buttons,
          tokens,
          variables,
          m.quickReplyPayloads,
        );
        return {
          kind: 'ready',
          purpose,
          deliver: () =>
            this.enqueue(m, contactUuid, channel.uuid, {
              kind: 'template',
              name: tpl.templateName,
              language: tpl.language,
              variables,
              body: tpl.templateBody.replace(
                /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
                (whole: string, t: string) => variables[t] ?? whole,
              ),
              templateId: tpl.id,
              ...(components ? { components } : {}),
            }),
        };
      }
      // The template cannot go (unapproved, paused, media header, too many variables): fall through to free text where that is allowed.
      if (!connectedQr && found.cloud.length > 0) {
        return refused({ status: 'skipped', reason: problem ?? 'template_unavailable' });
      }
    }

    // Free text: allowed inside the 24 hour window on the Cloud API, anywhere on a QR number.
    // The owner's default number first, then any other connected Cloud API number.
    const cloudChannel =
      found.cloud.find((c) => c.status === 'connected' && c.wabaConfigId === preferredSenderId) ??
      found.cloud.find((c) => c.status === 'connected');
    if (cloudChannel) {
      const open = await this.windowOpen(m, contactUuid, cloudChannel.uuid);
      if (open) {
        return {
          kind: 'ready',
          purpose: fallbackPurpose,
          deliver: () =>
            this.enqueue(m, contactUuid, cloudChannel.uuid, { kind: 'text', body: m.body }),
        };
      }
    }
    if (connectedQr) {
      return {
        kind: 'ready',
        purpose: fallbackPurpose,
        deliver: () =>
          this.enqueue(m, contactUuid, connectedQr.uuid, { kind: 'text', body: m.body }),
      };
    }
    if (found.cloud.length > 0) {
      return cloudChannel
        ? refused({ status: 'skipped', reason: 'template_required' })
        : refused({ status: 'held', reason: 'channel_unavailable' });
    }
    return refused({ status: 'skipped', reason: 'no_sender' });
  }

  /** Whether the contact wrote on this channel within 24 hours, so free text may be sent to them there. */
  private async windowOpen(
    m: BookingMessage,
    contactUuid: string,
    channelUuid: string,
  ): Promise<boolean> {
    try {
      const thread = await this.conversations.openConversationFor(contactUuid, channelUuid);
      return thread.lastInboundAt !== null && Date.now() - thread.lastInboundAt.getTime() < DAY_MS;
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : 'unknown', appointmentId: m.appointmentId },
        'booking message: the thread could not be opened',
      );
      return false;
    }
  }

  private async enqueue(
    m: BookingMessage,
    contactUuid: string,
    channelUuid: string,
    content: Parameters<ConversationsFacade['enqueueOutbound']>[0]['content'],
  ): Promise<ChannelOutcome> {
    try {
      const thread = await this.conversations.openConversationFor(contactUuid, channelUuid);
      const res = await this.conversations.enqueueOutbound({
        conversationId: thread.id,
        // The same key is the same id, so a retry of the same message is the first message and sends once.
        clientMessageId: uuidOfKey(m.idempotencyKey),
        content,
        sender: { kind: 'bot' },
      });
      return { status: 'sent', providerMessageId: res.message.id };
    } catch (err) {
      if (err instanceof AppError) {
        const known = outcomeOfCode(err.code);
        if (known) return known;
        // The contact's number cannot be messaged (the conversation core could not read it): nothing to send to.
        if (err.getStatus() === 422 && /phone number/i.test(err.message)) {
          return { status: 'skipped', reason: 'no_contact_point' };
        }
      }
      throw err;
    }
  }

  // --- the sender directory (the same table the broadcast screens read) -------------------------------------------------------

  /** Shared mailboxes only: a personal mailbox is one person's address and a system send must never go out from it. */
  private async mailbox(
    tx: Tx,
    orgId: number,
    preferredId: number | null,
  ): Promise<{ id: number; label: string; address: string } | undefined> {
    const res = await tx.execute(sql`
      SELECT id, address::text AS address, coalesce(nullif(display_name, ''), address::text) AS label
      FROM mail_mailboxes
      WHERE org_id = ${orgId} AND status = 'connected' AND scope = 'shared'
      ORDER BY (id = ${preferredId ?? 0}) DESC, created_at, id LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? { id: Number(r.id), label: r.label as string, address: r.address as string }
      : undefined;
  }
}

const refused = (outcome: ChannelOutcome) => ({ kind: 'refused', outcome }) as const;

/**
 * The component list of a template that has quick-reply buttons: the body values, then each quick-reply button with its payload (a
 * signed one-time token, in button order). Null when there is nothing to attach (no payloads, or the template has no quick reply): the
 * message then goes out as a plain template. A payload is never shown to the customer; WhatsApp hands it back when the button is tapped.
 */
export function quickReplyComponents(
  buttons: unknown,
  tokens: readonly string[],
  variables: Readonly<Record<string, string>>,
  payloads: readonly string[] | undefined,
): Record<string, unknown>[] | null {
  if (!payloads || payloads.length === 0 || !Array.isArray(buttons)) return null;
  const indexes: number[] = [];
  (buttons as unknown[]).forEach((b, i) => {
    if (kindOfButton(b) === 'quick_reply') indexes.push(i);
  });
  if (indexes.length === 0) return null;
  const components: Record<string, unknown>[] = [];
  if (tokens.length > 0) {
    components.push({
      type: 'body',
      parameters: tokens.map((t) => ({ type: 'text', text: variables[t] ?? '-' })),
    });
  }
  indexes.slice(0, payloads.length).forEach((buttonIndex, j) => {
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: buttonIndex,
      parameters: [{ type: 'payload', payload: payloads[j] }],
    });
  });
  return components;
}

/** The buttons of a template that carry a variable in their link (they need a value this cannot supply). */
function dynamicButtons(buttons: unknown): number {
  if (!Array.isArray(buttons)) return 0;
  return (buttons as Array<Record<string, unknown>>).filter(
    (b) => typeof b.url === 'string' && tokensOf(b.url).length > 0,
  ).length;
}
