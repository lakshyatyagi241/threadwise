import { Injectable, Logger } from '@nestjs/common';
import {
  holdOf,
  purposeOf,
  type LeadFirstReplyReason,
  type LeadFirstReplyStatus,
  type SpeedToLead,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import type { OutboxEvent } from '../../kernel/outbox/outbox-subscribers';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { holdsPurpose, SendWindowService } from '../compliance-center';
import { ConsentGate } from '../contact-consent';
import { ContactActivitiesRepository, ContactsRepository } from '../crm';
import { runInOrg } from './lead-context';
import { LeadEventsRepository } from './lead-events.repository';
import { LeadFirstMessageLookups } from './lead-first-message.lookups';
import { LeadFirstMessageSender, type Preparation } from './lead-first-message.sender';
import { LeadFirstRepliesRepository, type FirstReplyRow } from './lead-first-replies.repository';
import {
  CONSENT_CHANNEL,
  FIRST_REPLY_EXPIRY_MS,
  FIRST_REPLY_MAX_ATTEMPTS,
  FIRST_REPLY_RETRY_MS,
  dueAtOf,
  isLeadTooOld,
  nextBusinessOpening,
  timelineEntry,
  verdictOfDenial,
  type Verdict,
} from './lead-first-reply.rules';
import { defaultsOf } from './lead-rules';
import { LeadSourcesRepository, type LeadSourceRow } from './lead-sources.repository';

const MODULE_KEY = 'lead_first_replies';
const BATCH = 25;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

type Outcome =
  | { status: 'sent' }
  | {
      status: Extract<LeadFirstReplyStatus, 'held' | 'blocked' | 'skipped' | 'failed'>;
      reason: LeadFirstReplyReason;
      /** Held only: when to look again. */
      until?: Date;
    };

/**
 * The automatic first message to a new lead (BL-014, spec L-16). Two halves:
 *
 *  - `schedule` (the outbox consumer, on `lead.created`): if the lead's source has speed-to-lead switched on, writes ONE row for the
 *    lead (the unique key is the "never twice") due after the source's delay, with its audit row and outbox event.
 *  - `processOne` / `processDue` (the worker): decides and sends. In this order: the setting is still on and the source active, the
 *    message has not waited too long, the workspace's business hours (if the source asks), what the channel needs (template, sender,
 *    address), the quiet hours, and the ConsentGate. Only then is it delivered, through the dispatcher of its channel.
 *
 * Nothing is inferred about consent: a lead that arrived with proof of consent has a grant in the ledger (BL-168) and the gate sees it;
 * one that did not is asked about as a stranger. The gate's answer is final, there is no override. A message the gate or the plan
 * refused is `blocked` for good; one that only has to wait (quiet hours, business hours, a channel that is down, an empty wallet) is
 * `held` and goes by itself, or ends `failed / expired` after a day.
 *
 * Every outcome is written in the lead's own transaction with an audit row, an outbox event (`lead.first_reply.<status>`) and an
 * entry on the contact's timeline. Entries hold the outcome and a stable reason, never the message or an address.
 */
@Injectable()
export class LeadFirstReplyService {
  private readonly logger = new Logger(LeadFirstReplyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly replies: LeadFirstRepliesRepository,
    private readonly sources: LeadSourcesRepository,
    private readonly events: LeadEventsRepository,
    private readonly sender: LeadFirstMessageSender,
    private readonly lookups: LeadFirstMessageLookups,
    private readonly consentGate: ConsentGate,
    private readonly sendWindow: SendWindowService,
    private readonly contacts: ContactsRepository,
    private readonly activities: ContactActivitiesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- scheduling (the outbox consumer) -------------------------------------------------------------------------------------------

  /** `lead.created`: a new contact came from a lead. Writes the lead's first message when its source asks for one; a test lead never. */
  async schedule(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    if (p.test === true) return;
    const leadEventUuid = str(p.leadEventId);
    const sourceUuid = str(p.leadSourceId);
    if (!leadEventUuid || !sourceUuid) return;

    const orgId = event.orgId;
    const created = await runInOrg(orgId, () =>
      this.db.txAs({ orgId, userId: null }, async (tx) => {
        const source = await this.sources.findByUuid(tx, orgId, sourceUuid);
        if (!source) return null;
        const cfg = defaultsOf(source).speedToLead;
        if (!cfg.enabled) return null;
        const lead = await this.events.findByUuid(tx, orgId, source.id, leadEventUuid);
        if (!lead || lead.isTest || lead.contactId === null) return null;

        const now = new Date();
        // A lead older than the source allows (a backfill, a retry of an old lead, a late sweep) is decided at once: the worker records
        // it as skipped, so the lead and the contact's timeline say why nobody was messaged, instead of waiting out a delay for nothing.
        const old = isLeadTooOld(lead.receivedAt, now, cfg.maxLeadAgeMinutes);
        const dueAt = old ? now : dueAtOf(now, cfg.delayMinutes);
        const row = await this.replies.insertOnce(tx, orgId, {
          leadEventId: lead.id,
          contactId: lead.contactId,
          channel: cfg.channel,
          dueAt,
          expiresAt: new Date(dueAt.getTime() + FIRST_REPLY_EXPIRY_MS),
        });
        if (!row) return null;
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: row.id,
          action: 'insert',
          delta: {
            status: { old: null, new: 'scheduled' },
            channel: { old: null, new: cfg.channel },
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'leads',
          aggregateId: row.id,
          eventType: 'lead.first_reply.scheduled',
          orgId,
          payload: {
            leadEventId: leadEventUuid,
            leadSourceId: sourceUuid,
            channel: cfg.channel,
            dueAt: dueAt.toISOString(),
          },
        });
        return { id: row.id, immediate: old || cfg.delayMinutes === 0 };
      }),
    );
    // No delay: try now instead of waiting for the next sweep. A failure here is not the event's failure; the sweep picks the row up.
    if (created?.immediate) await this.attempt(orgId, created.id);
  }

  // --- sending (the worker) -------------------------------------------------------------------------------------------------------

  /** Claims one due message and works on it. Never throws: whatever goes wrong is left to the sweep, which finds the row again. */
  async attempt(orgId: number, id: number): Promise<void> {
    try {
      const claimed = await runInOrg(orgId, () =>
        this.db.txAs({ orgId, userId: null }, (tx) => this.replies.claimOne(tx, orgId, id)),
      );
      if (claimed) await this.processOne(orgId, id);
    } catch (err) {
      this.logger.error({ err, orgId, id }, 'first message attempt failed');
    }
  }

  /** One sweep: frees abandoned claims, then takes what is due across workspaces and works on each. Returns how many it took. */
  async processDue(): Promise<number> {
    await this.db.privileged((tx) => this.replies.recoverStale(tx));
    const due = await this.db.privileged((tx) => this.replies.claimDue(tx, BATCH));
    for (const { orgId, id } of due) {
      try {
        await this.processOne(orgId, id);
      } catch (err) {
        this.logger.error({ err, orgId, id }, 'first message processing failed');
      }
    }
    return due.length;
  }

  /** Works on a message this process has claimed (status `sending`). */
  async processOne(orgId: number, id: number): Promise<void> {
    await runInOrg(orgId, async () => {
      const now = new Date();
      const loaded = await this.db.txAs({ orgId, userId: null }, async (tx) => {
        const row = await this.replies.byId(tx, orgId, id);
        if (!row || row.status !== 'sending') return null;
        const source = await this.sources.findById(tx, orgId, row.sourceId);
        const contact =
          row.contactId === null
            ? undefined
            : await this.contacts.findById(tx, orgId, row.contactId);
        const hours = await this.lookups.businessHours(tx, orgId);
        return { row, source, contact, hours };
      });
      if (!loaded) return;
      const { row, source, contact, hours } = loaded;

      let outcome: Outcome;
      try {
        outcome = await this.decide(orgId, row, source, contact, hours, now);
      } catch (err) {
        // Whatever we did not foresee. The message is not retried blindly: an SMS or an email may already have gone.
        this.logger.error({ err, orgId, id }, 'first message failed unexpectedly');
        outcome = { status: 'failed', reason: 'internal_error' };
      }
      await this.finish(orgId, row, source, outcome, now);
    });
  }

  private async decide(
    orgId: number,
    row: FirstReplyRow,
    source: LeadSourceRow | undefined,
    contact: Awaited<ReturnType<ContactsRepository['findById']>>,
    hours: { hours: unknown; timezone: string },
    now: Date,
  ): Promise<Outcome> {
    if (!source) return skipped('disabled');
    const cfg: SpeedToLead = defaultsOf(source).speedToLead;
    if (!cfg.enabled) return skipped('disabled');
    if (source.status !== 'active') return skipped('source_paused');
    if (isLeadTooOld(row.leadReceivedAt, row.createdAt, cfg.maxLeadAgeMinutes)) {
      return skipped('lead_too_old');
    }
    if (row.attempts > FIRST_REPLY_MAX_ATTEMPTS) return { status: 'failed', reason: 'interrupted' };
    if (now.getTime() > row.expiresAt.getTime()) return { status: 'failed', reason: 'expired' };
    if (!contact) return skipped('no_contact_point');

    if (cfg.businessHoursOnly) {
      const opening = nextBusinessOpening(hours.hours, hours.timezone, now);
      if (opening === null) return skipped('outside_business_hours');
      if (opening.getTime() > now.getTime()) {
        return { status: 'held', reason: 'outside_business_hours', until: opening };
      }
    }

    // The channel and the template are the source's CURRENT ones: a setting changed while the message waited applies to it.
    const reply: FirstReplyRow = { ...row, channel: cfg.channel };
    const prepared: Preparation = await this.sender.prepare(orgId, reply, cfg, contact, now);
    if (prepared.kind === 'verdict') return withRetry(prepared.verdict, now);
    const { purpose, target, deliver } = prepared.prepared;

    // Quiet hours: only a marketing purpose is held, a service message or a utility notice is never asked about.
    if (holdsPurpose(purposeOf(purpose).ledgerPurpose)) {
      const decision = await this.sendWindow.check(orgId, 'message', {
        contactId: contact.id,
        phone: target.phone,
        email: target.email,
      });
      const hold = holdOf(decision);
      if (hold) return { status: 'held', reason: 'quiet_hours', until: new Date(hold.until) };
    }

    const verdict = await this.consentGate.check(
      orgId,
      { type: 'contact', id: contact.id },
      CONSENT_CHANNEL[cfg.channel],
      purpose,
    );
    if (verdict.decision !== 'allow') return verdictOfDenial(verdict.reason);

    const delivered = await deliver();
    return delivered.kind === 'sent' ? { status: 'sent' } : withRetry(delivered.verdict, now);
  }

  // --- the outcome ------------------------------------------------------------------------------------------------------------------

  private async finish(
    orgId: number,
    row: FirstReplyRow,
    source: LeadSourceRow | undefined,
    outcome: Outcome,
    now: Date,
  ): Promise<void> {
    const status = outcome.status;
    const reason = outcome.status === 'sent' ? null : outcome.reason;
    // The channel it was decided on is the source's current one (see `decide`); the outbox event and the timeline name that one.
    const channel = source ? defaultsOf(source).speedToLead.channel : row.channel;
    const current: FirstReplyRow = { ...row, channel };
    const until = outcome.status === 'held' ? outcome.until : undefined;
    // A held message that is still held for the same reason says nothing new: no second timeline entry, audit row or event.
    const again = status === 'held' && row.reason === reason;

    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.replies.finish(tx, orgId, row.id, {
        status,
        reason,
        channel,
        ...(until ? { dueAt: until } : {}),
        ...(status === 'sent' ? { sentAt: now } : {}),
      });
      if (again) return;
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: {
          status: { old: 'scheduled', new: status },
          ...(reason ? { reason: { old: null, new: reason } } : {}),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'leads',
        aggregateId: row.id,
        eventType: `lead.first_reply.${status}`,
        orgId,
        payload: {
          leadEventId: row.leadEventUuid,
          leadSourceId: source?.uuid ?? null,
          channel,
          reason,
        },
      });
      if (row.contactId !== null) await this.timeline(tx, orgId, current, outcome);
    });
  }

  private async timeline(
    tx: Tx,
    orgId: number,
    row: FirstReplyRow,
    outcome: Outcome,
  ): Promise<void> {
    const entry = timelineEntry(
      outcome.status,
      row.channel,
      outcome.status === 'sent' ? null : outcome.reason,
      outcome.status === 'held' ? outcome.until : undefined,
    );
    await this.activities.insert(tx, orgId, {
      contactId: row.contactId!,
      activityType: 'speed_to_lead',
      title: entry.title,
      body: entry.body,
      source: 'system',
      actorId: null,
    });
  }
}

const skipped = (reason: LeadFirstReplyReason): Outcome => ({ status: 'skipped', reason });

/** A verdict as an outcome. A transient `held` (channel, wallet, halt) asks again in ten minutes; a quiet-hours or business-hours one carries its own time. */
function withRetry(v: Verdict, now: Date): Outcome {
  if (v.status === 'held') {
    return {
      status: 'held',
      reason: v.reason,
      until: new Date(now.getTime() + FIRST_REPLY_RETRY_MS),
    };
  }
  return { status: v.status, reason: v.reason };
}
