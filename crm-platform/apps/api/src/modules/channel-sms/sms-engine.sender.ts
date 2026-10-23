import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { measureSms } from '@crm/contracts';
import type { Env } from '../../config/env.schema';
import { RequestContextStore } from '../../common/context/request-context';
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
import { ConsentGate, ContactConsentService } from '../contact-consent';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { UsageBillingService } from '../wallet-message-billing';
import {
  SMS_USAGE_METRIC,
  contactOfReference,
  deliveryReportUrl,
  quotaMessage,
  subjectOfReference,
  usagePeriod,
  usageSourceOf,
} from './sender-rules';
import { SmsSendersRepository, type SenderRow } from './sms-senders.repository';
import { SmsSendersService } from './sms-senders.service';
import { SmsUsageReporter } from './sms-usage.reporter';

/**
 * A wallet verdict of "can pay" is reused this long within one run, like the WhatsApp launch gate does: the balance only moves when the
 * worker settles a report, so asking the database for it before every one of 50,000 texts would triple the queries of a run. A longer
 * message than the one verified is asked again.
 */
const AFFORD_OK_MS = 3_000;

/** What one open sender keeps between its recipients: the names shown in the expense log and the last wallet verdict. */
interface RunState {
  subjects: Map<string, string | null>;
  affordable: { until: number; segments: number };
}

/** Reference's words for a sender that cannot send (TW-SMS-017 rule 1); the same for a switched-off sender. */
export const NO_SENDABLE_SENDER = 'No sendable SMS number connected';
export const OPTED_OUT = 'This contact has opted out of messages.';
export const NO_RECORDED_CONSENT = 'This contact has no recorded consent for marketing messages.';

/**
 * The SMS engine for broadcasts and campaigns (TW-SMS-010, 011, 012, 017, 019, 026). Registered in the shared `EngineSenderRegistry`
 * in the API and in the worker, so a broadcast on a `sms:` sender is sent like any other: one recipient at a time through the same
 * dispatcher, which has already merged the recipient's variables into the text. SMS has no template send, only text.
 *
 * Per recipient, in this order: the contact's opt-out (so a retry after they opted out does not text them), the wallet (it must be
 * able to pay for the message's segments, else 422 `WALLET_EMPTY` and nothing is sent), one message taken from the month's allowance
 * (atomically, so the cap cannot be overshot), the provider call, and the books: a refused send gives its place back, because only
 * accepted messages count, and an accepted one is reported to the wallet (`usage.reported`, one charge per provider message id). A
 * failure throws the operator's sentence, which the dispatcher stores on the recipient.
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
    private readonly consent: ContactConsentService,
    private readonly consentGate: ConsentGate,
    private readonly config: ConfigService<Env, true>,
    private readonly usage: UsageBillingService,
    private readonly usageReporter: SmsUsageReporter,
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
    const run: RunState = { subjects: new Map(), affordable: { until: 0, segments: 0 } };
    return {
      send: () => {
        throw new Error('SMS sends the rendered text, not a template.');
      },
      sendText: (m) => this.sendOne(orgId, row, creds, cap, period, callback, run, m),
    };
  }

  private async sendOne(
    orgId: number,
    row: SenderRow,
    creds: SmsCredentials,
    cap: number,
    period: string,
    callback: string,
    run: RunState,
    m: OutgoingText,
  ): Promise<{ providerMessageId: string | null }> {
    // The dispatchers name the contact in the client reference; a reference of any other shape skips only this extra check. The
    // ConsentGate decides (BL-141): a withdrawn contact (the roll-up flag or the sms ledger) is refused as before, and with the
    // workspace switch on a contact with no recorded sms grant is too. A broadcast or campaign text is marketing.
    const contactId = contactOfReference(m.clientReference);
    if (contactId !== null) {
      const verdict = await this.consentGate.check(
        orgId,
        { type: 'contact', id: contactId },
        'sms',
        'marketing_messaging',
      );
      if (verdict.decision === 'deny') {
        throw new Error(verdict.reason === 'withdrawn' ? OPTED_OUT : NO_RECORDED_CONSENT);
      }
    }

    // Paid work: the wallet must cover this message BEFORE it leaves (an AppError 422 `WALLET_EMPTY`, which the broadcast and campaign
    // dispatchers read as "put the recipient back and pause the run", never as a failed recipient). The segments are counted the way the
    // provider will count them; a platform-owned workspace and a free price pass, and a failed lookup lets the message through.
    const segments = measureSms(m.text.trim()).segments;
    if (run.affordable.until <= Date.now() || segments > run.affordable.segments) {
      await this.usage.assertCanAfford(orgId, 'sms', segments);
      run.affordable = { until: Date.now() + AFFORD_OK_MS, segments };
    }

    const reserved = await this.db.txAs({ orgId }, (tx) =>
      this.repo.reserve(tx, orgId, SMS_USAGE_METRIC, period, cap),
    );
    if (!reserved) throw new Error(quotaMessage(cap));

    // Header, footer, buttons and media are not part of an SMS (TW-SMS-014 rule 9): the body only.
    const res = await this.gateway.send(creds, m.to, m.text, { statusCallbackUrl: callback });
    if (res.ok) {
      await this.bill(orgId, creds, m, res, run.subjects);
      return { providerMessageId: res.messageId || null };
    }

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

  /**
   * The provider accepted the message: the wallet is told, once, with the provider's own segment count. This is the ONE place an SMS is
   * billed, whoever asked for it (broadcast, campaign, first message to a lead). It never throws: the message has left, and a billing
   * fault must not fail or retry it (the reporter logs it with the message id).
   */
  private async bill(
    orgId: number,
    creds: SmsCredentials,
    m: OutgoingText,
    res: { messageId: string; segments: number },
    subjects: Map<string, string | null>,
  ): Promise<void> {
    const subject = subjectOfReference(m.clientReference);
    await this.usageReporter.used(orgId, {
      // A provider that answers without an id still sent the message and still charges for it: a made-up id keeps it to one charge (it
      // cannot be matched to a later failure report, which names no message we know).
      messageId: res.messageId || `local:${randomUUID()}`,
      provider: creds.provider,
      segments: res.segments,
      recipient: m.to,
      source: usageSourceOf(m.clientReference, m.screen?.source),
      subjectName: subject ? await this.subjectName(orgId, subject, subjects) : null,
    });
  }

  private async subjectName(
    orgId: number,
    subject: NonNullable<ReturnType<typeof subjectOfReference>>,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    const key = `${subject.kind}-${subject.id}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const name = await this.db
      .txAs({ orgId }, (tx) => this.repo.subjectName(tx, orgId, subject))
      .catch(() => null);
    cache.set(key, name);
    return name;
  }

  /** The recipient replied STOP at Twilio (21610): flag them so the next run does not try (and fail) again. Never changes the send's result. */
  private async flagOptedOut(orgId: number, contactId: number): Promise<void> {
    try {
      await this.db.txAs({ orgId }, async (tx) => {
        const changed = await this.repo.markOptedOut(tx, orgId, contactId);
        // The ledger keeps the proof (provider-reported STOP); one event per contact and day however often sends are retried.
        await RequestContextStore.run(
          {
            requestId: `sms-stop-${orgId}-${contactId}`,
            orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          () =>
            this.consent.recordInTx(tx, orgId, {
              contactId,
              channel: 'sms',
              action: 'withdrawn',
              source: 'keyword',
              evidence: { reference: 'sms-provider-21610' },
              idempotencyKey: `keyword:sms-provider:${contactId}:${new Date().toISOString().slice(0, 10)}`,
            }),
        );
        if (!changed) return;
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
