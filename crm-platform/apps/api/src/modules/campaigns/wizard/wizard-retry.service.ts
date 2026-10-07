import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { FREQUENCY_CAP_ERROR_CODE, WIZARD_RETRY_INTERVAL_HOURS } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import { WabaApiError } from '../../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { MergeTagService } from '../../crm';
import {
  EngineSenderRegistry,
  LinkTracker,
  PacingRuntime,
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  assemblePhone,
  sanitizeOverrides,
  type SenderDirectory,
  type TemplateDirectory,
} from '../../broadcasts';
import { CampaignEvents, asSystem } from '../campaign-events';
import { buildTemplatePayload, wizardVariablesOf } from '../campaign-payload';
import { CampaignsRepository } from '../campaigns.repository';
import { FREQUENCY_CAP_SQL, isFrequencyCap, nextRetrySlot } from './wizard-rules';

/** Retries claimed in one pass. */
const MAX_PER_PASS = 50;
/** A retry claimed this long ago by a worker that died is dealt with (see `reap`). */
const STALE_CLAIM_MS = 15 * 60_000;
const STEP_MS = WIZARD_RETRY_INTERVAL_HOURS * 3_600_000;

interface Claimed {
  orgId: number;
  id: number;
  campaignId: number;
  contactId: number | null;
  retryCount: number;
  firstSentAt: Date;
  nextAt: Date;
}

const when = (v: unknown) => new Date(v as string);

/**
 * Retries for Meta's frequency capping (error 131049), in the worker. A message Meta refuses for frequency capping is sent AGAIN,
 * exactly 24 hours after the first send and every 24 hours after that, until the end date the person chose. Never any other failure,
 * never a message that went through, never more than once per slot.
 *
 * It works from the rows (the truth), in three passes that can each be repeated safely:
 *   arm      a failed recipient of a retry-enabled campaign whose failure is the frequency cap gets its next slot;
 *   settle   a recipient whose retry was accepted is `recovered` once delivered, or armed again (cap) or finished (any other failure);
 *   run      due slots are CLAIMED (`scheduled` to `sending`, one worker wins), logged with a unique (recipient, attempt) row BEFORE
 *            the provider is called, sent through the same message builder a run uses, and recorded.
 * Cost: a failed message is never charged and a retry is charged only when delivered, per provider message id, by the wallet, so
 * a retry adds no cost and cannot be charged twice.
 */
@Injectable()
export class WizardRetryService {
  private readonly logger = new Logger(WizardRetryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly campaigns: CampaignsRepository,
    private readonly events: CampaignEvents,
    private readonly engines: EngineSenderRegistry,
    private readonly merge: MergeTagService,
    private readonly tracker: LinkTracker,
    private readonly runtime: PacingRuntime,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  /** One full pass. Returns what it did, for the log and the tests. */
  async tick(): Promise<{ armed: number; settled: number; sent: number; reaped: number }> {
    const reaped = await this.reap();
    const armed = await this.arm();
    const settled = await this.settle();
    const sent = await this.runDue();
    return { armed, settled, sent, reaped };
  }

  // ---------------------------------------------------------------------------------------- arm

  /** Failed recipients of retry-enabled campaigns whose failure is the frequency cap: give them their first slot (or end them). */
  async arm(): Promise<number> {
    const now = this.runtime.now();
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT r.org_id, r.id, coalesce(r.sent_at, r.updated_at) AS first_at, c.retry_until
        FROM wp_campaign_contacts r
        JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
        WHERE c.retry_enabled AND c.status NOT IN ('cancelled') AND r.status = 'failed' AND r.retry_state IS NULL
          AND ${sql.raw(FREQUENCY_CAP_SQL)}
        ORDER BY r.id LIMIT 200`);
      return res.rows as Array<{
        org_id: number | string;
        id: number | string;
        first_at: string;
        retry_until: string | null;
      }>;
    });
    for (const r of rows) {
      const slot = nextRetrySlot({
        firstSentAt: when(r.first_at),
        retriesDone: 0,
        now,
        windowCloses: r.retry_until ? when(r.retry_until) : null,
      });
      await this.db.txAs({ orgId: Number(r.org_id) }, async (tx) => {
        await tx.execute(sql`
          UPDATE wp_campaign_contacts SET
            retry_state = ${slot.at ? 'scheduled' : 'exhausted'}, retry_first_sent_at = ${when(r.first_at).toISOString()}::timestamptz,
            retry_next_at = ${slot.at ? slot.at.toISOString() : null}::timestamptz,
            error_code = coalesce(error_code, ${FREQUENCY_CAP_ERROR_CODE})
          WHERE org_id = ${Number(r.org_id)} AND id = ${Number(r.id)} AND retry_state IS NULL AND status = 'failed'`);
      });
    }
    return rows.length;
  }

  // ---------------------------------------------------------------------------------------- settle

  /** A retry that was accepted: delivered means recovered; a new frequency-cap failure arms the next slot; any other failure ends it. */
  async settle(): Promise<number> {
    const now = this.runtime.now();
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT r.org_id, r.id, r.status, r.retry_count, r.retry_first_sent_at, c.retry_until,
               ${sql.raw(FREQUENCY_CAP_SQL)} AS cap
        FROM wp_campaign_contacts r
        JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
        WHERE r.retry_state = 'sent' AND r.status IN ('delivered', 'read', 'responded', 'failed')
        ORDER BY r.id LIMIT 200`);
      return res.rows as Array<{
        org_id: number | string;
        id: number | string;
        status: string;
        retry_count: number;
        retry_first_sent_at: string;
        retry_until: string | null;
        cap: boolean;
      }>;
    });
    for (const r of rows) {
      const orgId = Number(r.org_id);
      const id = Number(r.id);
      if (r.status !== 'failed') {
        await this.setState(orgId, id, 'recovered', null, 'sent');
        continue;
      }
      // The provider accepted the retry and reported the failure afterwards: the attempt's outcome is what was reported.
      await this.db.txAs({ orgId }, async (tx) => {
        await tx.execute(sql`
          UPDATE camp_retry_attempts a SET outcome = ${r.cap ? 'frequency_cap' : 'failed'},
            error_code = r.error_code, error_message = r.error_message
          FROM wp_campaign_contacts r
          WHERE r.org_id = ${orgId} AND r.id = ${id} AND a.org_id = r.org_id AND a.recipient_id = r.id AND a.attempt_no = r.retry_count`);
      });
      if (!r.cap) {
        await this.setState(orgId, id, 'exhausted', null, 'sent');
        continue;
      }
      const slot = nextRetrySlot({
        firstSentAt: when(r.retry_first_sent_at),
        retriesDone: Number(r.retry_count),
        now,
        windowCloses: r.retry_until ? when(r.retry_until) : null,
      });
      await this.setState(orgId, id, slot.at ? 'scheduled' : 'exhausted', slot.at, 'sent');
    }
    return rows.length;
  }

  private setState(
    orgId: number,
    id: number,
    state: 'scheduled' | 'exhausted' | 'recovered',
    nextAt: Date | null,
    from: string,
  ): Promise<void> {
    return this.db.txAs({ orgId }, async (tx) => {
      await tx.execute(sql`
        UPDATE wp_campaign_contacts SET retry_state = ${state}, retry_next_at = ${nextAt ? nextAt.toISOString() : null}::timestamptz
        WHERE org_id = ${orgId} AND id = ${id} AND retry_state = ${from}`);
    });
  }

  // ---------------------------------------------------------------------------------------- reap

  /**
   * A claim that was never finished (the worker died). With no attempt logged nothing was sent, so the slot goes back; with one logged
   * the message may have gone out, and it is never sent again: the retries for that recipient end.
   */
  async reap(): Promise<number> {
    const cutoff = new Date(this.runtime.now().getTime() - STALE_CLAIM_MS).toISOString();
    return this.db.privileged(async (tx) => {
      const stale = sql`r.retry_state = 'sending' AND r.updated_at < ${cutoff}::timestamptz`;
      const gone = await tx.execute(sql`
        UPDATE wp_campaign_contacts r SET retry_state = 'exhausted'
        WHERE ${stale} AND EXISTS (
          SELECT 1 FROM camp_retry_attempts a WHERE a.org_id = r.org_id AND a.recipient_id = r.id AND a.attempt_no > r.retry_count)
        RETURNING r.id`);
      const back = await tx.execute(sql`
        UPDATE wp_campaign_contacts r SET retry_state = 'scheduled'
        WHERE ${stale} AND NOT EXISTS (
          SELECT 1 FROM camp_retry_attempts a WHERE a.org_id = r.org_id AND a.recipient_id = r.id AND a.attempt_no > r.retry_count)
        RETURNING r.id`);
      return gone.rows.length + back.rows.length;
    });
  }

  // ---------------------------------------------------------------------------------------- run

  /** Claims the due slots (one worker wins each) and sends them. */
  async runDue(): Promise<number> {
    const now = this.runtime.now();
    const claimed = await this.claim(now);
    let sent = 0;
    for (const c of claimed) {
      try {
        if (await this.runOne(c)) sent++;
      } catch (err) {
        this.logger.error({ recipient: c.id, err }, '[CAMP] a frequency-cap retry crashed');
      }
    }
    return sent;
  }

  private claim(now: Date): Promise<Claimed[]> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE wp_campaign_contacts r SET retry_state = 'sending'
        WHERE (r.org_id, r.id) IN (
          SELECT r2.org_id, r2.id FROM wp_campaign_contacts r2
          JOIN wpcampaigns c ON c.org_id = r2.org_id AND c.id = r2.campaign_id
          WHERE r2.retry_state = 'scheduled' AND r2.retry_next_at <= ${now.toISOString()}::timestamptz
            AND r2.status = 'failed' AND c.retry_enabled AND c.status NOT IN ('cancelled', 'paused')
          ORDER BY r2.retry_next_at, r2.id LIMIT ${MAX_PER_PASS} FOR UPDATE OF r2 SKIP LOCKED)
        AND r.retry_state = 'scheduled' AND r.status = 'failed'
        RETURNING r.org_id, r.id, r.campaign_id, r.contact_id, r.retry_count, r.retry_first_sent_at, r.retry_next_at`);
      return (res.rows as Array<Record<string, unknown>>).map((r) => ({
        orgId: Number(r.org_id),
        id: Number(r.id),
        campaignId: Number(r.campaign_id),
        contactId: r.contact_id === null ? null : Number(r.contact_id),
        retryCount: Number(r.retry_count),
        firstSentAt: when(r.retry_first_sent_at),
        nextAt: when(r.retry_next_at),
      }));
    });
  }

  /** One claimed slot. True when a message was sent. */
  private async runOne(c: Claimed): Promise<boolean> {
    const now = this.runtime.now();
    const { orgId } = c;
    // The slot's number on the 24-hour grid: it is what makes the attempt unique.
    const attemptNo = Math.round((c.nextAt.getTime() - c.firstSentAt.getTime()) / STEP_MS);

    const prep = await this.db.txAs({ orgId }, async (tx) => {
      const camp = await this.campaigns.findById(tx, orgId, c.campaignId);
      if (!camp || c.contactId === null || camp.templateId === null)
        return { skip: 'gone' as const };
      const tpl = await this.templates.findById(tx, orgId, camp.templateId);
      if (!tpl) return { skip: 'gone' as const };
      const contactRow = (
        await tx.execute(
          sql`SELECT phone, country_code, is_unsubscribed FROM contacts WHERE org_id = ${orgId} AND id = ${c.contactId}`,
        )
      ).rows[0] as
        { phone: string | null; country_code: string | null; is_unsubscribed: boolean } | undefined;
      if (!contactRow || contactRow.is_unsubscribed) return { skip: 'opted_out' as const };
      const to = assemblePhone(contactRow.phone, contactRow.country_code);
      if (!to) return { skip: 'gone' as const };
      const sender = await this.senders.resolveForDispatch(tx, orgId, {
        provider: camp.provider,
        deviceId: camp.deviceId,
      });
      if (!sender) return { skip: 'no_sender' as const };
      const base = await this.merge.baseContext(tx, orgId);
      const contact = await this.merge.contactFor(tx, orgId, c.contactId);
      // The slot is claimed in the log BEFORE the provider is called: a second claim of it (a crash, a duplicate job) fails here.
      const logged = await tx.execute(sql`
        INSERT INTO camp_retry_attempts (org_id, campaign_id, recipient_id, attempt_no, scheduled_for, executed_at, outcome, error_message)
        VALUES (${orgId}, ${c.campaignId}, ${c.id}, ${attemptNo}, ${c.nextAt.toISOString()}::timestamptz,
                ${now.toISOString()}::timestamptz, 'failed', 'interrupted before the provider answered')
        ON CONFLICT (org_id, recipient_id, attempt_no) DO NOTHING RETURNING id`);
      if (logged.rows.length === 0) return { skip: 'duplicate' as const };
      return { camp, tpl, to, sender, ctx: { ...base, contact } };
    });

    if ('skip' in prep) {
      // Nothing was sent, and nothing ever will be for this recipient: say why on the row.
      await this.finish(c, attemptNo, now, {
        outcome: 'failed',
        state: 'exhausted',
        errorMessage: `Retry skipped: ${prep.skip}`,
        wamid: null,
        errorCode: null,
        log: prep.skip !== 'duplicate',
      });
      return false;
    }

    const adapter = this.engines.get(prep.sender.engine);
    try {
      if (!adapter) throw new Error(`no sender adapter for engine ${prep.sender.engine}`);
      const opened = await adapter.open(orgId, prep.sender);
      const built = await buildTemplatePayload(
        { db: this.db, templates: this.templates, tracker: this.tracker },
        {
          orgId,
          campaign: { id: prep.camp.id, trackingEnabled: prep.camp.trackingEnabled },
          wizardVariables: wizardVariablesOf(prep.camp.wizard),
          tpl: prep.tpl,
          overrides: sanitizeOverrides(prep.camp.templateOverrides),
          contactId: c.contactId!,
          to: prep.to,
          ctx: prep.ctx,
        },
      );
      const res = await opened.send({
        to: prep.to,
        templateName: built.name,
        language: prep.tpl.language,
        clientReference: `camp-${prep.camp.id}-${c.contactId}-r${attemptNo}`,
        ...(prep.sender.engine === 'waba' ? { components: built.components } : {}),
      });
      await this.finish(c, attemptNo, now, {
        outcome: 'sent',
        state: 'sent',
        errorMessage: null,
        wamid: res.providerMessageId,
        errorCode: null,
        log: true,
      });
      return true;
    } catch (err) {
      const code = err instanceof WabaApiError && err.code !== null ? String(err.code) : null;
      const message = err instanceof Error ? err.message : String(err);
      const cap = isFrequencyCap({ code, message });
      await this.finish(c, attemptNo, now, {
        outcome: cap ? 'frequency_cap' : 'failed',
        state: cap ? 'cap' : 'exhausted',
        errorMessage: message,
        wamid: null,
        errorCode: cap ? FREQUENCY_CAP_ERROR_CODE : code,
        log: true,
      });
      return false;
    }
  }

  /** Records what a slot did: the attempt row, the recipient's state, and the campaign's counters. */
  private async finish(
    c: Claimed,
    attemptNo: number,
    now: Date,
    o: {
      outcome: 'sent' | 'frequency_cap' | 'failed';
      state: 'sent' | 'exhausted' | 'cap';
      errorMessage: string | null;
      wamid: string | null;
      errorCode: string | null;
      log: boolean;
    },
  ): Promise<void> {
    const { orgId } = c;
    await asSystem(orgId, () =>
      this.db.txAs({ orgId }, async (tx) => {
        if (o.log) {
          await tx.execute(sql`
            UPDATE camp_retry_attempts SET outcome = ${o.outcome}, provider_message_id = ${o.wamid},
              error_code = ${o.errorCode}, error_message = ${o.errorMessage ? o.errorMessage.slice(0, 1024) : null}
            WHERE org_id = ${orgId} AND recipient_id = ${c.id} AND attempt_no = ${attemptNo}`);
        }
        if (o.state === 'sent') {
          await tx.execute(sql`
            UPDATE wp_campaign_contacts SET status = 'sent', sent_at = ${now.toISOString()}::timestamptz,
              whatsapp_message_id = ${o.wamid}, error_message = NULL, error_code = NULL, next_attempt_at = NULL,
              retry_state = 'sent', retry_count = ${attemptNo}, retry_next_at = NULL
            WHERE org_id = ${orgId} AND id = ${c.id}`);
          const camp = await this.campaigns.findById(tx, orgId, c.campaignId);
          if (camp && c.contactId !== null) {
            await this.events.contactStatus(
              tx,
              camp.id,
              camp.uuid,
              camp.name,
              c.contactId,
              'sent',
              {
                providerMessageId: o.wamid,
              },
            );
          }
        } else if (o.state === 'cap') {
          const retryUntil = (
            await tx.execute(
              sql`SELECT retry_until FROM wpcampaigns WHERE org_id = ${orgId} AND id = ${c.campaignId}`,
            )
          ).rows[0] as { retry_until: string | null };
          const slot = nextRetrySlot({
            firstSentAt: c.firstSentAt,
            retriesDone: attemptNo,
            now,
            windowCloses: retryUntil.retry_until ? when(retryUntil.retry_until) : null,
          });
          await tx.execute(sql`
            UPDATE wp_campaign_contacts SET retry_count = ${attemptNo}, error_code = ${FREQUENCY_CAP_ERROR_CODE},
              error_message = ${o.errorMessage ? o.errorMessage.slice(0, 1024) : null},
              retry_state = ${slot.at ? 'scheduled' : 'exhausted'}, retry_next_at = ${slot.at ? slot.at.toISOString() : null}::timestamptz
            WHERE org_id = ${orgId} AND id = ${c.id}`);
        } else {
          await tx.execute(sql`
            UPDATE wp_campaign_contacts SET retry_count = ${attemptNo}, retry_state = 'exhausted', retry_next_at = NULL,
              error_code = coalesce(${o.errorCode}, error_code),
              error_message = ${o.errorMessage ? o.errorMessage.slice(0, 1024) : null}
            WHERE org_id = ${orgId} AND id = ${c.id}`);
        }
        await this.campaigns.recount(tx, orgId, c.campaignId);
      }),
    );
  }
}
