import { Injectable } from '@nestjs/common';
import type { ChannelCapabilities, ChannelHealth } from '@crm/contracts';
import type { OutgoingMail } from '../../infra/providers/channel-email';
import {
  ChannelError,
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelHealthResult,
  type ChannelRuntime,
  type OutboundEnvelope,
  type ParsedInbound,
  type SendResult,
  type WindowInfo,
} from '../../infra/providers/chat-conversations/channel.port';
import { MailDriverError } from './drivers/mail-driver';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { recipientsOf, replyMessageId } from './email-send-rules';
import { MailboxUnavailableError } from './mail-errors';
import { MailOutboundPreparer } from './mail-outbound.preparer';
import { MailPlan } from './mail-plan';
import { MailSendGuard } from './mail-send.guard';
import { MailTokens } from './mail-tokens.service';

/**
 * No window rule (a mail can be answered at any time), no templates, no reactions, no files out (an attachment on a reply is TW-MAIL-027,
 * not in this build), `sent` is the only receipt Gmail gives.
 */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: [],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: false,
};

/**
 * A mailbox of any provider as an inbox channel (kind `email`, one per mailbox, its external id the mailbox uuid). A reply goes out through
 * the mailbox's driver (`MailDriver.send`) as an RFC 5322 message with `In-Reply-To`, `References` and the thread key, under the mailbox's
 * own address and name. Inbound does not come through a channel webhook but through the mailbox sync job, so `verifyInbound` is false and `parseInbound`
 * empty.
 *
 * Never throws anything but `ChannelError`: a refused or unreachable Google, a mailbox that needs reconnecting and a workspace that lost
 * the add-on are all answers the dispatcher understands (and a retry is safe: the reply's Message-ID comes from the send's idempotency
 * key, and a retry first looks for a message with that id).
 */
@Injectable()
export class EmailChannelAdapter implements ChannelAdapter {
  readonly kind = 'email' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly tokens: MailTokens,
    private readonly drivers: MailDriverRegistry,
    private readonly plan: MailPlan,
    private readonly preparer: MailOutboundPreparer,
    private readonly guard: MailSendGuard,
  ) {}

  externalIdOf(): string | null {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return {
      ...CAPABILITIES,
      media: [...CAPABILITIES.media],
      receipts: [...CAPABILITIES.receipts],
    };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(CAPABILITIES.windowHours, lastInboundAt, now);
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    if (envelope.kind !== 'text') {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `An email reply cannot carry a ${envelope.kind} message`,
        false,
      );
    }
    const email = envelope.email;
    if (!email) {
      throw new ChannelError(
        'MAIL_NO_THREAD',
        'There is no email to answer on this conversation.',
        false,
      );
    }
    const mailboxUuid = channel.externalId;
    if (!mailboxUuid) {
      throw new ChannelError(
        'MAIL_MAILBOX_UNAVAILABLE',
        'This email channel has no mailbox.',
        false,
      );
    }
    if (!(await this.plan.isEnabled(channel.orgId))) {
      throw new ChannelError(
        'MAIL_MAILBOX_UNAVAILABLE',
        'Your plan no longer includes the Email channel, so replies cannot be sent.',
        false,
      );
    }
    try {
      return await this.tokens.withAccess(channel.orgId, mailboxUuid, async (access, mailbox) => {
        const { to, cc, bcc } = recipientsOf(email, mailbox.address);
        if (to.length === 0) {
          throw new ChannelError(
            'MAIL_SEND_REFUSED',
            'There is nobody to send this reply to.',
            false,
          );
        }
        const everyone = [...to, ...cc, ...bcc];
        await this.guard.assertAllowed(channel.orgId, mailbox, everyone);
        const draft: OutgoingMail = {
          messageId: replyMessageId(envelope.clientReference, mailbox.address),
          from: { name: mailbox.displayName, address: mailbox.address },
          to,
          cc,
          bcc,
          subject: email.subject,
          text: envelope.body,
          html: null, // the preparer fills it (rich body, signature)
          inReplyTo: email.inReplyTo,
          references: email.references,
          threadKey: email.threadId,
          attachments: [],
          // Mail an automation wrote (a bot, a flow: no sending person) says so, so the other side never auto-answers it (loop protection).
          headers: email.sentBy ? {} : { 'Auto-Submitted': 'auto-generated' },
          attempt: envelope.attempt,
        };
        const mail = await this.preparer.prepare({ orgId: channel.orgId, mailbox, email }, draft);
        const sent = await this.drivers
          .get(mailbox.provider)
          .send({ orgId: channel.orgId, mailbox, access }, mail);
        await this.guard.recordSent(channel.orgId, mailbox, everyone);
        const meta = await this.preparer.sent({ orgId: channel.orgId, mailbox, email }, mail, {
          providerMessageId: sent.providerMessageId,
          threadKey: sent.threadKey ?? null,
        });
        return {
          providerMessageId: sent.providerMessageId,
          acceptedAt: new Date(),
          ...(meta ? { meta } : {}),
        };
      });
    } catch (err) {
      throw this.asChannelError(err);
    }
  }

  async checkHealth(channel: ChannelRuntime): Promise<ChannelHealthResult> {
    const mailboxUuid = channel.externalId;
    const at = new Date().toISOString();
    const down = (
      code: string,
      title: string,
      detail: string | null,
      needsReauth: boolean,
    ): ChannelHealthResult => ({
      health: this.health(
        at,
        false,
        'blocked',
        [{ severity: 'critical', code, title, detail }],
        code,
        title,
      ),
      needsReauth,
      providerFault: false,
    });
    if (!mailboxUuid) return down('MAIL_NO_MAILBOX', 'This channel has no mailbox', null, false);
    try {
      const result = await this.tokens.withAccess(channel.orgId, mailboxUuid, (access, mailbox) =>
        this.drivers.get(mailbox.provider).health({ orgId: channel.orgId, mailbox, access }),
      );
      return {
        health: this.health(at, true, 'healthy', [], null, null, result.displayName),
        needsReauth: false,
        providerFault: false,
      };
    } catch (err) {
      if (err instanceof MailboxUnavailableError) {
        return down(
          err.reason === 'needs_reauth' ? 'TOKEN_INVALID' : 'MAIL_MAILBOX_UNAVAILABLE',
          err.reason === 'needs_reauth'
            ? 'The provider no longer allows access: reconnect the mailbox'
            : 'The mailbox is not connected',
          null,
          err.reason === 'needs_reauth',
        );
      }
      if (err instanceof MailDriverError) {
        return down(
          err.needsReauth ? 'TOKEN_INVALID' : 'MAIL_PROVIDER_UNREACHABLE',
          err.needsReauth
            ? 'The provider no longer allows access: reconnect the mailbox'
            : 'The mail provider did not answer',
          `${err.kind}`,
          err.needsReauth,
        );
      }
      throw new ChannelError('MAIL_HEALTH_FAILED', 'The mailbox could not be checked.', true);
    }
  }

  private health(
    checkedAt: string,
    ok: boolean,
    overall: ChannelHealth['overall'],
    issues: ChannelHealth['issues'],
    errorCode: string | null,
    errorMessage: string | null,
    displayName: string | null = null,
  ): ChannelHealth {
    return {
      ok,
      overall,
      checkedAt,
      displayName,
      displayPhoneNumber: null,
      qualityRating: null,
      messagingLimitTier: null,
      phoneStatus: null,
      codeVerificationStatus: null,
      nameStatus: null,
      platformType: null,
      token: { valid: ok ? true : null, expiresAt: null, scopes: null },
      webhook: { subscribed: null },
      issues,
      errorCode,
      errorMessage,
    };
  }

  /** Everything the send can throw, in the dispatcher's vocabulary. Never the provider's own text (the driver already wrote ours). */
  private asChannelError(err: unknown): ChannelError {
    if (err instanceof ChannelError) return err;
    if (err instanceof MailboxUnavailableError) {
      const reauth = err.reason === 'needs_reauth';
      return new ChannelError(
        'MAIL_MAILBOX_UNAVAILABLE',
        reauth
          ? 'This mailbox needs reconnecting before it can send.'
          : err.reason === 'not_configured'
            ? 'Gmail is not set up for this platform.'
            : 'This mailbox is disconnected.',
        false,
        { needsReauth: reauth },
      );
    }
    if (err instanceof MailDriverError) {
      if (err.retryable) {
        return new ChannelError('MAIL_SEND_FAILED', err.message, true, {
          providerCode: err.providerCode || null,
        });
      }
      return new ChannelError('MAIL_SEND_REFUSED', err.message, false, {
        needsReauth: err.needsReauth,
        providerCode: err.providerCode || null,
      });
    }
    return new ChannelError('MAIL_SEND_FAILED', 'The reply could not be sent.', true);
  }
}
