import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { emailMetaSchema } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { resolveThreadKey, type OutgoingMail } from '../../infra/providers/channel-email';
import { ChannelError } from '../../infra/providers/chat-conversations';
import {
  SenderRefused,
  SenderThrottled,
  type EngineSender,
  type OpenedSender,
  type OutgoingText,
} from '../broadcasts';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../chat-conversations';
import { ConsentGate, ConsentUnsubscribeService } from '../contact-consent';
import { MailDriverError } from './drivers/mail-driver';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import {
  NOT_A_CONTACT,
  NO_RECORDED_CONSENT,
  NO_SENDABLE_MAILBOX,
  OPTED_OUT,
  PLAN_WITHOUT_EMAIL,
  campaignBodies,
  campaignMessageId,
  contactOfReference,
  monthStart,
  oneLine,
  quotaMessage,
} from './email-engine.rules';
import { MailboxUnavailableError } from './mail-errors';
import { MailPlan } from './mail-plan';
import { MailSendGuard } from './mail-send.guard';
import { MailTokens } from './mail-tokens.service';
import { MailboxesRepository, type MailboxRow } from './mailboxes.repository';

/** How long a mailbox that is out of room for the hour asks the campaign to wait when it cannot say (a minute). */
const DEFAULT_WAIT_MS = 60_000;

/**
 * The email engine for campaigns (Reference's `EmailCampaignRunner` transport, `?channel=email`). Registered in the shared
 * `EngineSenderRegistry` in the API and in the worker, so a campaign on an `email:<mailbox uuid>` sender is sent like any other: one
 * recipient at a time through the campaign dispatcher, which has already merged the contact's values into the text and the subject (the
 * Header field) and put the address in `to`. A mail is a typed message only: there is no template send.
 *
 * Per run: the plan has the Email add-on, the mailbox is connected, and the plan's monthly mail cap has room. Per recipient, in this
 * order: the contact's consent on the `email` channel for marketing (a withdrawn contact is never mailed), the mailbox's own limits and
 * the bounce list (`MailSendGuard`: an address that hard-bounced is refused, and the hourly cap makes the run wait rather than fail),
 * the signed unsubscribe link with the one-click headers (RFC 8058), the send through the mailbox's driver, the books, and a copy of the
 * mail in the mailbox's inbox thread. A failure throws the operator's sentence, which the dispatcher stores on the recipient.
 */
@Injectable()
export class EmailEngineSender implements EngineSender {
  private readonly logger = new Logger(EmailEngineSender.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly tokens: MailTokens,
    private readonly drivers: MailDriverRegistry,
    private readonly plan: MailPlan,
    private readonly guard: MailSendGuard,
    private readonly consentGate: ConsentGate,
    private readonly unsubscribe: ConsentUnsubscribeService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async open(orgId: number, sender: { id: number }): Promise<OpenedSender> {
    if (!(await this.plan.isEnabled(orgId))) throw new Error(PLAN_WITHOUT_EMAIL);
    const mailbox = await this.db.txAs({ orgId }, (tx) => this.repo.byId(tx, orgId, sender.id));
    // The mailbox the campaign names is never swapped for another: it is somebody's address, and mail from the wrong one cannot be undone.
    if (!mailbox || mailbox.status !== 'connected') throw new Error(NO_SENDABLE_MAILBOX);

    // Once per run, so a spent month fails the whole run up front with the plan sentence and nothing is sent (Reference).
    const cap = await this.plan.monthlyLimit(orgId);
    let used =
      cap > 0
        ? await this.db.txAs({ orgId }, (tx) =>
            this.repo.sentSince(tx, orgId, monthStart(new Date())),
          )
        : 0;
    if (cap > 0 && used >= cap) throw new Error(quotaMessage(cap));

    return {
      send: () => {
        throw new Error('Email sends the typed message, not a template.');
      },
      sendText: async (m) => {
        // Reference checks the cap once per run; counting this run's own mails keeps a long campaign from overshooting it.
        if (cap > 0 && used >= cap) throw new SenderRefused(quotaMessage(cap));
        const out = await this.sendOne(orgId, mailbox.uuid, m);
        used += 1;
        return out;
      },
    };
  }

  private async sendOne(
    orgId: number,
    mailboxUuid: string,
    m: OutgoingText,
  ): Promise<{ providerMessageId: string | null }> {
    // The dispatchers name the contact in the client reference; a reference of any other shape skips only this extra check. The
    // ConsentGate decides (BL-141): a withdrawn contact is refused, and with the workspace switch on a contact with no recorded email
    // grant is too. A campaign mail is marketing.
    const contactId = contactOfReference(m.clientReference);
    if (contactId !== null) {
      const verdict = await this.consentGate.check(
        orgId,
        { type: 'contact', id: contactId },
        'email',
        'marketing_messaging',
      );
      if (verdict.decision === 'deny') {
        throw new SenderRefused(verdict.reason === 'withdrawn' ? OPTED_OUT : NO_RECORDED_CONSENT);
      }
    }
    const subject = oneLine(m.header ?? '') || 'Message';

    try {
      return await this.tokens.withAccess(orgId, mailboxUuid, async (access, mailbox) => {
        await this.guard.assertAllowed(orgId, mailbox, [m.to]);
        const link =
          contactId !== null
            ? this.unsubscribe.linkFor(orgId, contactId)
            : await this.unsubscribe.linkForAddress(orgId, m.to);
        if (!link) throw new SenderRefused(NOT_A_CONTACT);

        const bodies = campaignBodies(m.text, link.pageUrl);
        const mail: OutgoingMail = {
          messageId: campaignMessageId(m.clientReference, mailbox.address),
          from: { name: mailbox.displayName, address: mailbox.address },
          to: [m.to],
          cc: [],
          bcc: [],
          subject,
          text: bodies.text,
          html: bodies.html,
          inReplyTo: null,
          references: [],
          threadKey: null,
          attachments: [],
          headers: link.headers,
          attempt: 1,
        };
        const sent = await this.drivers
          .get(mailbox.provider)
          .send({ orgId, mailbox, access }, mail);
        await this.guard.recordSent(orgId, mailbox, [m.to]);
        await this.mirror(orgId, mailbox, mail, m.text, contactId, sent);
        return { providerMessageId: sent.providerMessageId };
      });
    } catch (err) {
      throw this.asSendError(err);
    }
  }

  /**
   * The mail as a message of the mailbox's inbox thread (Reference mirrored each campaign mail into the unified inbox), so the reply
   * lands beside it. Best effort and never failing the send: the mail is gone, so a bookkeeping failure must not repeat it.
   */
  private async mirror(
    orgId: number,
    mailbox: MailboxRow,
    mail: OutgoingMail,
    body: string,
    contactId: number | null,
    sent: { providerMessageId: string; threadKey?: string | null },
  ): Promise<void> {
    if (!mailbox.channelUuid) return; // the mailbox has no inbox channel yet: nothing to mirror into
    try {
      const threadKey = resolveThreadKey({
        providerThreadId: sent.threadKey ?? null,
        messageId: mail.messageId,
      });
      const contactUuid =
        contactId === null
          ? null
          : await this.db.txAs({ orgId }, (tx) => this.repo.contactUuid(tx, orgId, contactId));
      const email = emailMetaSchema.parse({
        subject: mail.subject.slice(0, 998),
        from: mail.from,
        to: [{ name: null, address: mail.to[0] }],
        messageId: mail.messageId,
        html: null,
        threadId: threadKey.slice(0, 128),
        delivery: 'sent',
      });
      await RequestContextStore.run(
        { requestId: randomUUID(), orgId, actorType: 'system', actorId: null, userId: null },
        () =>
          this.conversations.recordOutbound({
            channelId: mailbox.channelUuid!,
            peerKey: `t:${threadKey}`,
            ...(contactUuid ? { contactId: contactUuid } : {}),
            threadTitle: mail.subject.slice(0, 200),
            source: 'campaign',
            body,
            providerMessageId: sent.providerMessageId,
            meta: { email },
          }),
      );
    } catch (err) {
      this.logger.warn({ orgId, err: String(err) }, 'email campaign: inbox thread not written');
    }
  }

  /** Everything a send can throw, in the dispatcher's vocabulary: a refusal (final), a wait (the run stops and resumes), or a plain error (retried). */
  private asSendError(err: unknown): Error {
    if (err instanceof SenderRefused || err instanceof SenderThrottled) return err;
    if (err instanceof ChannelError) {
      if (err.code === 'MAIL_RATE_LIMITED') {
        return new SenderThrottled(err.message, err.retryAfterMs ?? DEFAULT_WAIT_MS);
      }
      // An address that hard-bounced is not tried again: sending damages the mailbox's reputation and cannot succeed.
      if (err.code === 'MAIL_RECIPIENT_BOUNCED') return new SenderRefused(err.message);
      return new Error(err.message);
    }
    if (err instanceof MailboxUnavailableError) {
      return new Error(
        err.reason === 'needs_reauth'
          ? 'This mailbox needs reconnecting before it can send.'
          : err.reason === 'not_configured'
            ? 'Gmail is not set up for this platform.'
            : 'This mailbox is disconnected.',
      );
    }
    if (err instanceof MailDriverError) return new Error(err.message);
    return new Error('The email could not be sent.');
  }
}
