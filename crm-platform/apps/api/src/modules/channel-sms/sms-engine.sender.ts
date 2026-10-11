import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  SMS_GATEWAY,
  type SmsCredentials,
  type SmsGateway,
} from '../../infra/providers/channel-sms/sms.port';
import { TWILIO_STOP_CODE, credentialsProblem } from '../../infra/providers/channel-sms/sms-rules';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { EngineSender, OpenedSender, OutgoingText } from '../broadcasts';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  SMS_USAGE_METRIC,
  contactOfReference,
  deliveryReportUrl,
  quotaMessage,
  usagePeriod,
} from './sender-rules';
import { SmsSendersRepository, type SenderRow } from './sms-senders.repository';
import { SmsSendersService } from './sms-senders.service';

/** Reference's words for a sender that cannot send (TW-SMS-017 rule 1); the same for a switched-off sender. */
export const NO_SENDABLE_SENDER = 'No sendable SMS number connected';
export const OPTED_OUT = 'This contact has opted out of messages.';

/**
 * The SMS engine for broadcasts and campaigns (TW-SMS-010, 011, 012, 017, 019, 026). Registered in the shared `EngineSenderRegistry`
 * in the API and in the worker, so a broadcast on a `sms:` sender is sent like any other: one recipient at a time through the same
 * dispatcher, which has already merged the recipient's variables into the text. SMS has no template send, only text.
 *
 * Per recipient, in this order: the contact's opt-out (so a retry after they opted out does not text them), one message taken from
 * the month's allowance (atomically, so the cap cannot be overshot), the provider call, and the books: a refused send gives its
 * place back, because only accepted messages count. A failure throws the operator's sentence, which the dispatcher stores on the
 * recipient.
 */
@Injectable()
export class SmsEngineSender implements EngineSender {
  private readonly logger = new Logger(SmsEngineSender.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SmsSendersRepository,
    private readonly senders: SmsSendersService,
    private readonly entitlements: PlanEntitlementService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGateway,
  ) {}

  async open(orgId: number, sender: { id: number }): Promise<OpenedSender> {
    const row = await this.db.txAs({ orgId }, (tx) => this.repo.findById(tx, orgId, sender.id));
    // The stored sender is NOT replaced by another when it exists but is switched off (TW-SMS-006 rule 4).
    if (!row || row.status !== 'connected') throw new Error(NO_SENDABLE_SENDER);
    const creds = this.senders.credentialsOf(row);
    if (!creds)
      throw new Error('The keys of this SMS number cannot be read. Reconnect the number.');
    const missing = credentialsProblem(creds);
    if (missing) throw new Error(missing);

    // Once per run, so a spent month fails the whole run up front with the plan sentence and nothing is sent (TW-SMS-026 rule 2).
    const cap = await this.entitlements.limit(orgId, 'sms_monthly');
    const period = usagePeriod(new Date());
    if (cap > 0) {
      const used = await this.db.txAs({ orgId }, (tx) =>
        this.repo.used(tx, orgId, SMS_USAGE_METRIC, period),
      );
      if (used >= cap) throw new Error(quotaMessage(cap));
    }

    const callback = deliveryReportUrl(this.config.get('APP_URL', { infer: true }));
    return {
      send: () => {
        throw new Error('SMS sends the rendered text, not a template.');
      },
      sendText: (m) => this.sendOne(orgId, row, creds, cap, period, callback, m),
    };
  }

  private async sendOne(
    orgId: number,
    row: SenderRow,
    creds: SmsCredentials,
    cap: number,
    period: string,
    callback: string,
    m: OutgoingText,
  ): Promise<{ providerMessageId: string | null }> {
    // The dispatchers name the contact in the client reference; a reference of any other shape skips only this extra check.
    const contactId = contactOfReference(m.clientReference);
    if (contactId !== null) {
      const out = await this.db.txAs({ orgId }, (tx) => this.repo.isOptedOut(tx, orgId, contactId));
      if (out) throw new Error(OPTED_OUT);
    }

    const reserved = await this.db.txAs({ orgId }, (tx) =>
      this.repo.reserve(tx, orgId, SMS_USAGE_METRIC, period, cap),
    );
    if (!reserved) throw new Error(quotaMessage(cap));

    // Header, footer, buttons and media are not part of an SMS (TW-SMS-014 rule 9): the body only.
    const res = await this.gateway.send(creds, m.to, m.text, { statusCallbackUrl: callback });
    if (res.ok) return { providerMessageId: res.messageId || null };

    await this.db
      .txAs({ orgId }, (tx) => this.repo.release(tx, orgId, SMS_USAGE_METRIC, period))
      .catch((err: unknown) =>
        this.logger.warn({ err: String(err) }, 'sms allowance not given back'),
      );
    if (res.code === TWILIO_STOP_CODE && contactId !== null)
      await this.flagOptedOut(orgId, contactId);
    if (res.badCredentials) await this.flagNeedsAttention(orgId, row, res.error);
    throw new Error(res.error || 'SMS send failed');
  }

  /** The recipient replied STOP at Twilio (21610): flag them so the next run does not try (and fail) again. Never changes the send's result. */
  private async flagOptedOut(orgId: number, contactId: number): Promise<void> {
    try {
      await this.db.txAs({ orgId }, async (tx) => {
        if (!(await this.repo.markOptedOut(tx, orgId, contactId))) return;
        await this.audit.record(tx, {
          module: 'contacts',
          recordId: contactId,
          action: 'update',
          delta: { is_unsubscribed: { old: false, new: true } },
        });
      });
    } catch (err) {
      this.logger.warn({ err: String(err), orgId }, 'sms: contact not flagged as opted out');
    }
  }

  /** The provider refused the key itself: switch the sender off with the reason, so the operator sees it and nothing keeps failing. */
  private async flagNeedsAttention(orgId: number, row: SenderRow, reason: string): Promise<void> {
    try {
      await this.db.txAs({ orgId }, async (tx) => {
        const fresh = await this.repo.findByUuid(tx, orgId, row.uuid, true);
        if (!fresh || fresh.status !== 'connected') return;
        await this.repo.setStatus(tx, orgId, fresh.id, 'failed', reason.slice(0, 255));
        await this.audit.record(tx, {
          module: 'sms_senders',
          recordId: fresh.id,
          action: 'update',
          delta: { active: { old: true, new: false } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'sms_senders',
          aggregateId: fresh.id,
          eventType: 'sms.sender.toggled',
          payload: { uuid: fresh.uuid, active: false, reason: 'bad_credentials' },
        });
      });
    } catch (err) {
      this.logger.warn({ err: String(err), orgId }, 'sms: sender not flagged as needing attention');
    }
  }
}
