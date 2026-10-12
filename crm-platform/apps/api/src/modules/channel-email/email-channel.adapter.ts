import { Injectable } from '@nestjs/common';
import type { ChannelCapabilities, ChannelHealth } from '@crm/contracts';
import { GmailClient, GoogleMailError, buildMime } from '../../infra/providers/channel-email';
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
import { recipientsOf, replyMessageId } from './email-send-rules';
import { MailboxUnavailableError } from './mail-errors';
import { MailPlan } from './mail-plan';
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
 * A Gmail mailbox as an inbox channel (kind `email`, one per mailbox, its external id the mailbox uuid). A reply goes out through Gmail's
 * `users.messages.send` as an RFC 5322 message with `In-Reply-To`, `References` and the thread id, under the mailbox's own address and
 * name. Inbound does not come through a channel webhook but through the mailbox sync job, so `verifyInbound` is false and `parseInbound`
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
    private readonly gmail: GmailClient,
    private readonly plan: MailPlan,
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
      return await this.tokens.withToken(channel.orgId, mailboxUuid, async (token, mailbox) => {
        const messageId = replyMessageId(envelope.clientReference, mailbox.address);
        // A retry: an earlier try may have reached Gmail and lost the answer. The same Message-ID finds it.
        if (envelope.attempt > 1) {
          const found = await this.gmail.findByMessageId(token, messageId).catch(() => null);
          if (found) return { providerMessageId: found.id, acceptedAt: new Date() };
        }
        const { to, cc, bcc } = recipientsOf(email, mailbox.address);
        if (to.length === 0) {
          throw new ChannelError(
            'MAIL_SEND_REFUSED',
            'There is nobody to send this reply to.',
            false,
          );
        }
        const raw = await buildMime({
          from: { name: mailbox.displayName, address: mailbox.address },
          to,
          cc,
          bcc,
          subject: email.subject,
          text: envelope.body,
          messageId,
          inReplyTo: email.inReplyTo,
          references: email.references,
        });
        const sent = await this.gmail.sendMessage(token, { raw, threadId: email.threadId });
        return { providerMessageId: sent.id, acceptedAt: new Date() };
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
      const profile = await this.tokens.withToken(channel.orgId, mailboxUuid, (token) =>
        this.gmail.getProfile(token),
      );
      return {
        health: this.health(at, true, 'healthy', [], null, null, profile.emailAddress),
        needsReauth: false,
        providerFault: false,
      };
    } catch (err) {
      if (err instanceof MailboxUnavailableError) {
        return down(
          err.reason === 'needs_reauth' ? 'TOKEN_INVALID' : 'MAIL_MAILBOX_UNAVAILABLE',
          err.reason === 'needs_reauth'
            ? 'Google no longer allows access: reconnect the mailbox'
            : 'The mailbox is not connected',
          null,
          err.reason === 'needs_reauth',
        );
      }
      if (err instanceof GoogleMailError) {
        return down('MAIL_PROVIDER_UNREACHABLE', 'Google did not answer', `${err.kind}`, false);
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

  /** Everything the send can throw, in the dispatcher's vocabulary. Never Google's own text. */
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
    if (err instanceof GoogleMailError) {
      if (err.retryable) {
        return new ChannelError(
          'MAIL_SEND_FAILED',
          'Google did not accept the reply yet. It will be tried again.',
          true,
          {
            providerCode: err.reason || null,
          },
        );
      }
      const needsReauth = err.kind === 'forbidden' && err.reason === 'insufficientPermissions';
      return new ChannelError(
        'MAIL_SEND_REFUSED',
        err.kind === 'too_large'
          ? 'The reply is too large for Gmail to send.'
          : needsReauth
            ? 'This mailbox may no longer send mail. Reconnect it.'
            : 'Google refused to send this reply.',
        false,
        { needsReauth, providerCode: err.reason || null },
      );
    }
    return new ChannelError('MAIL_SEND_FAILED', 'The reply could not be sent.', true);
  }
}
