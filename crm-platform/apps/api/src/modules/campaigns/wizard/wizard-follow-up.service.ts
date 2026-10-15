import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  FREQUENCY_CAP_ERROR_CODE,
  WIZARD_FOLLOW_UP_WAIT_MAX,
  WIZARD_RETRY_INTERVAL_HOURS,
  type WizardFollowUp,
} from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import { WabaApiError } from '../../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { ConsentGate } from '../../contact-consent';
import { MergeTagService } from '../../crm';
import {
  EngineSenderRegistry,
  LinkTracker,
  PacingRuntime,
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  assemblePhone,
  type SenderDirectory,
  type TemplateDirectory,
} from '../../broadcasts';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  type CampaignBilling,
  type CampaignFlowStarter,
} from '../_shims/tokens';
import { CampaignEvents, asSystem } from '../campaign-events';
import { buildTemplatePayload } from '../campaign-payload';
import { CampaignsRepository } from '../campaigns.repository';
import { decideFollowUp, followUpsOf, type FollowUpDecision } from './wizard-follow-up-rules';

/** Recipients looked at in one pass. */
const MAX_PER_PASS = 100;
/** A recipient claimed this long ago by a worker that died is looked at again. */
const LEASE_MS = 5 * 60_000;
/** A pass stops taking new batches after this long. */
const MAX_PASS_MS = 8_000;
/** A campaign that stopped sending longer ago than this is no longer looked at for new chains (its recipients were armed long before). */
const ARM_WINDOW_MS = 3 * 86_400_000;
/** The arming pass moves this many recipients into their chain at once. */
const ARM_BATCH = 500;

interface Claimed {
  orgId: number;
  id: number;
  campaignId: number;
  contactId: number | null;
  variant: string | null;
  stepNo: number;
  baseAt: Date;
  /** The campaign message was read (step 1), or the message of the step before was (later steps). */
  read: boolean;
  /** The recipient wrote to us since `baseAt`. */
  replied: boolean;
  repliedAt: Date | null;
  /** The text of that first message (a placeholder for media). */
  replyText: string | null;
  alreadyResponded: boolean;
  wizard: { draft?: unknown } | null;
  trackingEnabled: boolean;
  /** The campaign's own gap between two sends (Smart Delivery), in seconds; null when it has none. */
  gapMinSec: number | null;
  gapMaxSec: number | null;
  campaignUuid: string;
  campaignName: string;
}

type Outcome = 'sent' | 'flow_started' | 'failed' | 'skipped' | 'lapsed';

const when = (v: unknown) => new Date(v as string);
const iso = (d: Date) => d.toISOString();

/**
 * Follow-up steps of a guided campaign, in the worker (the draft's `followUps`). After the campaign message goes out, a recipient's
 * reaction, or silence, decides whether another message goes out or a flow starts, up to three steps in a row. Step 1 is measured
 * from the campaign message, step 2 from step 1's message, and so on (see `decideFollowUp` for the rules of each trigger).
 *
 * It works from the rows, in two passes that can each be repeated safely:
 *   arm   a recipient whose campaign message went out joins its chain (`follow_up_state = 'active'`, step 1, measured from the send);
 *   run   recipients whose time to be looked at has come are CLAIMED (their next look is pushed out, so one worker takes each and a
 *         crash only delays it), and each one is decided: wait (look again later), do the step, or end the chain.
 * A step is logged with a unique (recipient, step) row BEFORE the provider is called, so it happens at most once even if a worker
 * dies in between; the recipient is then moved on, whatever the provider answered. A recipient who opted out, whose consent is gone,
 * or whose wallet cannot pay never gets a later step: the chain ends and the log says why.
 *
 * A reply is a message from the contact in the inbox since the base time; a read is the provider's read report of the message before
 * the step. Cost: a template follow-up is charged like any campaign message, by the wallet, when its delivery report arrives
 * (CampaignReceiptsService routes it: the follow-up's message id names its attempt row).
 */
@Injectable()
export class WizardFollowUpService {
  private readonly logger = new Logger(WizardFollowUpService.name);

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
    @Inject(CAMPAIGN_BILLING) private readonly billing: CampaignBilling,
    @Inject(CAMPAIGN_FLOW_STARTER) private readonly flows: CampaignFlowStarter,
    @Optional() private readonly consentGate?: ConsentGate,
  ) {}

  /** One full pass. Returns what it did, for the log and the tests. */
  async tick(): Promise<{ armed: number; looked: number; acted: number }> {
    const armed = await this.arm();
    const started = Date.now();
    let looked = 0;
    let acted = 0;
    // Keep going while there is more due and the pass has not run long: the next tick must not start on top of this one.
    for (;;) {
      const claimed = await this.claim(this.runtime.now());
      for (const c of claimed) {
        try {
          if (await this.handle(c)) {
            acted++;
            await this.gap(c);
          }
        } catch (err) {
          this.logger.error({ recipient: c.id, err }, '[CAMP] a follow-up step crashed');
        }
      }
      looked += claimed.length;
      if (claimed.length < MAX_PER_PASS || Date.now() - started > MAX_PASS_MS) break;
    }
    return { armed, looked, acted };
  }

  // ---------------------------------------------------------------------------------------- arm

  /** Recipients of a campaign with follow-ups whose campaign message went out: they start their chain at step 1. */
  async arm(): Promise<number> {
    const now = this.runtime.now();
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE wp_campaign_contacts r SET follow_up_state = 'active', follow_up_next = 1,
          follow_up_base_at = r.sent_at, follow_up_check_at = ${iso(now)}::timestamptz
        WHERE (r.org_id, r.id) IN (
          SELECT r2.org_id, r2.id FROM wp_campaign_contacts r2
          JOIN wpcampaigns c ON c.org_id = r2.org_id AND c.id = r2.campaign_id
          WHERE c.follow_up_count > 0 AND c.status <> 'cancelled' AND r2.follow_up_state IS NULL AND r2.sent_at IS NOT NULL
            AND (c.status = 'running' OR coalesce(c.completed_at, c.last_run_at, c.updated_at) > ${iso(new Date(now.getTime() - ARM_WINDOW_MS))}::timestamptz)
            AND r2.contact_id IS NOT NULL AND r2.status IN ('sent', 'delivered', 'read', 'responded')
          ORDER BY r2.id LIMIT ${ARM_BATCH} FOR UPDATE OF r2 SKIP LOCKED)
        RETURNING r.id`);
      return res.rows.length;
    });
  }

  // ---------------------------------------------------------------------------------------- claim

  private claim(now: Date): Promise<Claimed[]> {
    const lease = new Date(now.getTime() + LEASE_MS);
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE wp_campaign_contacts r SET follow_up_check_at = ${iso(lease)}::timestamptz
        FROM wpcampaigns c
        WHERE c.org_id = r.org_id AND c.id = r.campaign_id
          AND (r.org_id, r.id) IN (
            SELECT r2.org_id, r2.id FROM wp_campaign_contacts r2
            JOIN wpcampaigns c2 ON c2.org_id = r2.org_id AND c2.id = r2.campaign_id
            WHERE r2.follow_up_state = 'active' AND r2.follow_up_check_at <= ${iso(now)}::timestamptz
              AND c2.status NOT IN ('cancelled', 'paused', 'draft')
            ORDER BY r2.follow_up_check_at, r2.id LIMIT ${MAX_PER_PASS} FOR UPDATE OF r2 SKIP LOCKED)
        RETURNING r.org_id, r.id, r.campaign_id, r.contact_id, r.variant, r.follow_up_next, r.follow_up_base_at,
          r.response IS NOT NULL AS already_responded,
          c.wizard, c.tracking_enabled, c.throttle_min_sec, c.throttle_max_sec, c.uuid AS campaign_uuid, c.campaign_name,
          (SELECT m.created_at FROM messages m JOIN conversations cv ON cv.org_id = m.org_id AND cv.id = m.conversation_id
            WHERE m.org_id = r.org_id AND cv.contact_id = r.contact_id AND m.direction = 'in'
              AND m.created_at > r.follow_up_base_at ORDER BY m.created_at LIMIT 1) AS replied_at,
          (SELECT coalesce(nullif(m.body, ''), '[' || m.kind || ']') FROM messages m JOIN conversations cv ON cv.org_id = m.org_id AND cv.id = m.conversation_id
            WHERE m.org_id = r.org_id AND cv.contact_id = r.contact_id AND m.direction = 'in'
              AND m.created_at > r.follow_up_base_at ORDER BY m.created_at LIMIT 1) AS reply_text,
          CASE WHEN r.follow_up_next = 1 THEN r.read_at IS NOT NULL
               ELSE coalesce((SELECT a.read_at IS NOT NULL FROM camp_follow_up_attempts a
                              WHERE a.org_id = r.org_id AND a.recipient_id = r.id AND a.step_no = r.follow_up_next - 1), false)
          END AS was_read`);
      return (res.rows as Array<Record<string, unknown>>).map((r) => ({
        orgId: Number(r.org_id),
        id: Number(r.id),
        campaignId: Number(r.campaign_id),
        contactId: r.contact_id === null ? null : Number(r.contact_id),
        variant: r.variant === null || r.variant === undefined ? null : String(r.variant),
        stepNo: Number(r.follow_up_next),
        baseAt: when(r.follow_up_base_at),
        read: Boolean(r.was_read),
        replied: r.replied_at !== null && r.replied_at !== undefined,
        repliedAt: r.replied_at ? when(r.replied_at) : null,
        replyText:
          r.reply_text === null || r.reply_text === undefined ? null : String(r.reply_text),
        alreadyResponded: Boolean(r.already_responded),
        wizard: (r.wizard as { draft?: unknown } | null) ?? null,
        trackingEnabled: Boolean(r.tracking_enabled),
        gapMinSec:
          r.throttle_min_sec === null || r.throttle_min_sec === undefined
            ? null
            : Number(r.throttle_min_sec),
        gapMaxSec:
          r.throttle_max_sec === null || r.throttle_max_sec === undefined
            ? null
            : Number(r.throttle_max_sec),
        campaignUuid: String(r.campaign_uuid),
        campaignName: String(r.campaign_name),
      }));
    });
  }

  /** The campaign's own gap between two sends, so a follow-up wave is paced the way the campaign was. */
  private async gap(c: Claimed): Promise<void> {
    const min = c.gapMinSec ?? 0;
    const max = Math.max(min, c.gapMaxSec ?? min);
    if (max <= 0) return;
    await this.runtime.sleep((min + this.runtime.random() * (max - min)) * 1000);
  }

  // ---------------------------------------------------------------------------------------- one recipient

  /** True when the recipient got a message or a flow from this look. */
  private async handle(c: Claimed): Promise<boolean> {
    const now = this.runtime.now();
    const steps = followUpsOf(c.wizard);
    const step = steps[c.stepNo - 1];
    // The campaign no longer has this step (its draft was edited, or never had it): nothing to do, the chain is over.
    if (!step) {
      await this.endChain(c);
      return false;
    }
    // A reply the recipient wrote after the campaign message is the campaign's response too (its statistics and the replied event),
    // whichever trigger the step has.
    if (c.replied && !c.alreadyResponded) await this.recordResponse(c);

    const decision: FollowUpDecision = decideFollowUp(step, {
      now,
      baseAt: c.baseAt,
      replied: c.replied,
      read: c.read,
    });
    if (decision.kind === 'wait') {
      await this.db.txAs({ orgId: c.orgId }, (tx) =>
        tx.execute(sql`
          UPDATE wp_campaign_contacts SET follow_up_check_at = ${iso(decision.checkAt)}::timestamptz
          WHERE org_id = ${c.orgId} AND id = ${c.id} AND follow_up_state = 'active' AND follow_up_next = ${c.stepNo}`),
      );
      return false;
    }
    if (decision.kind === 'skip' || decision.kind === 'lapse') {
      await this.finish(c, step, now, {
        outcome: decision.kind === 'skip' ? 'skipped' : 'lapsed',
        errorMessage: null,
        wamid: null,
        errorCode: null,
        end: true,
        insert: true,
      });
      return false;
    }
    return this.fire(c, step, now);
  }

  /** The step's condition holds: send its template or start its flow, once. */
  private async fire(c: Claimed, step: WizardFollowUp, now: Date): Promise<boolean> {
    const { orgId } = c;
    // The flow runtime and the outbox take their tenant from the context, and the worker has no request: run as the system.
    let prep: Awaited<ReturnType<WizardFollowUpService['prepare']>>;
    try {
      prep = await this.prepare(c, step, now);
    } catch (err) {
      // The step could not even be set up (the flow runtime or a lookup threw): it is over for this recipient, not retried every lease.
      await this.finish(c, step, now, {
        outcome: 'failed',
        errorMessage: `Follow-up not sent: ${err instanceof Error ? err.message : String(err)}`,
        wamid: null,
        errorCode: null,
        end: true,
        insert: true,
      });
      return false;
    }

    if ('skip' in prep) {
      // Nothing was sent and nothing ever will be for this step: say why on the log and end the chain. A `claimedLog` step already has
      // its row; the others (opted out, no consent, a duplicate) are written now (a duplicate leaves the row that exists).
      await this.finish(c, step, now, {
        outcome: prep.skip === 'opted_out' || prep.skip === 'no_consent' ? 'skipped' : 'failed',
        errorMessage: `Follow-up not sent: ${prep.skip}`,
        wamid: null,
        errorCode: null,
        end: true,
        insert: !('claimedLog' in prep),
        keepExisting: prep.skip === 'duplicate',
      });
      return false;
    }

    if ('flow' in prep && prep.flow) {
      const flow = prep.flow;
      const ok = flow.ok;
      await this.finish(c, step, now, {
        outcome: ok ? 'flow_started' : 'failed',
        errorMessage: ok ? null : (flow.error ?? 'The flow could not be started.'),
        wamid: null,
        errorCode: null,
        end: !ok,
      });
      return ok;
    }

    // The wallet must cover this message, as it must for any campaign message; if not, the chain ends here.
    const allowed = await this.billing.consume({ orgId, to: prep.to, usedThisMonth: 0 });
    if (!allowed) {
      await this.finish(c, step, now, {
        outcome: 'failed',
        errorMessage: 'Follow-up not sent: the wallet cannot cover it.',
        wamid: null,
        errorCode: null,
        end: true,
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
          campaign: { id: prep.camp.id, trackingEnabled: c.trackingEnabled },
          wizardVariables: null,
          tpl: prep.tpl,
          overrides: null,
          contactId: c.contactId!,
          to: prep.to,
          ctx: prep.ctx,
        },
      );
      const res = await opened.send({
        to: prep.to,
        templateName: built.name,
        language: prep.tpl.language,
        clientReference: `camp-${prep.camp.id}-${c.contactId}-f${c.stepNo}`,
        ...(prep.sender.engine === 'waba' ? { components: built.components } : {}),
      });
      await this.finish(c, step, now, {
        outcome: 'sent',
        errorMessage: null,
        wamid: res.providerMessageId,
        errorCode: null,
        end: false,
      });
      return true;
    } catch (err) {
      const code = err instanceof WabaApiError && err.code !== null ? String(err.code) : null;
      // Meta's frequency cap (131049) passes: give the step its claim back and look again in 24 hours, for at most as long as the longest wait.
      const giveUpAt = c.baseAt.getTime() + WIZARD_FOLLOW_UP_WAIT_MAX * 60_000;
      if (code === FREQUENCY_CAP_ERROR_CODE && now.getTime() < giveUpAt) {
        await this.retryLater(c, now);
        return false;
      }
      await this.finish(c, step, now, {
        outcome: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        wamid: null,
        errorCode: code,
        end: true,
      });
      return false;
    }
  }

  /** The provider refused for now: the claim in the log is released and the recipient is looked at again after a retry interval. */
  private async retryLater(c: Claimed, now: Date): Promise<void> {
    const { orgId } = c;
    const next = new Date(now.getTime() + WIZARD_RETRY_INTERVAL_HOURS * 3_600_000);
    await this.db.txAs({ orgId }, async (tx) => {
      await tx.execute(sql`
        DELETE FROM camp_follow_up_attempts
        WHERE org_id = ${orgId} AND recipient_id = ${c.id} AND step_no = ${c.stepNo} AND outcome = 'claimed'`);
      await tx.execute(sql`
        UPDATE wp_campaign_contacts SET follow_up_check_at = ${iso(next)}::timestamptz
        WHERE org_id = ${orgId} AND id = ${c.id} AND follow_up_state = 'active' AND follow_up_next = ${c.stepNo}`);
    });
  }

  /** Everything a step needs before the provider is called, in one transaction: the checks, the claim in the log, and a flow's start. */
  private async prepare(c: Claimed, step: WizardFollowUp, now: Date) {
    const { orgId } = c;
    return asSystem(orgId, () =>
      this.db.txAs({ orgId }, async (tx) => {
        const camp = await this.campaigns.findById(tx, orgId, c.campaignId);
        if (!camp || c.contactId === null) return { skip: 'gone' as const };
        const contactRow = (
          await tx.execute(
            sql`SELECT phone, country_code, is_unsubscribed FROM contacts WHERE org_id = ${orgId} AND id = ${c.contactId}`,
          )
        ).rows[0] as
          | { phone: string | null; country_code: string | null; is_unsubscribed: boolean }
          | undefined;
        if (!contactRow || contactRow.is_unsubscribed) return { skip: 'opted_out' as const };
        if (this.consentGate) {
          const verdict = await this.consentGate.checkMany(
            orgId,
            [c.contactId],
            'whatsapp',
            'marketing_messaging',
            undefined,
            { tx },
          );
          if (verdict.decisions.get(c.contactId)?.decision === 'deny')
            return { skip: 'no_consent' as const };
        }
        const to = assemblePhone(contactRow.phone, contactRow.country_code);
        if (!to) return { skip: 'gone' as const };

        // The step is claimed in the log BEFORE the provider is called: a second claim of it (a crash, a duplicate pass) fails here.
        const claimed = await tx.execute(sql`
        INSERT INTO camp_follow_up_attempts (org_id, campaign_id, recipient_id, step_no, trigger, action_kind, scheduled_for, executed_at, outcome, error_message)
        VALUES (${orgId}, ${c.campaignId}, ${c.id}, ${c.stepNo}, ${step.trigger}, ${step.action.kind}, ${iso(c.baseAt)}::timestamptz,
                ${iso(now)}::timestamptz, 'claimed', 'interrupted before the provider answered')
        ON CONFLICT (org_id, recipient_id, step_no) DO NOTHING RETURNING id`);
        if (claimed.rows.length === 0) return { skip: 'duplicate' as const };

        if (step.action.kind === 'flow') {
          const flowId = step.action.flowId
            ? await this.campaigns.flowId(tx, orgId, step.action.flowId)
            : null;
          if (flowId === null) return { skip: 'flow_gone' as const, claimedLog: true };
          const res = await this.flows.start(tx, orgId, {
            flowId,
            contactId: c.contactId,
            campaignId: c.campaignId,
            variant: c.variant,
          });
          return { flow: res };
        }

        const tpl = step.action.templateId
          ? await this.templates.find(tx, orgId, step.action.templateId)
          : undefined;
        if (!tpl) return { skip: 'template_gone' as const, claimedLog: true };
        const sender = await this.senders.resolveForDispatch(tx, orgId, {
          provider: camp.provider,
          deviceId: camp.deviceId,
        });
        if (!sender) return { skip: 'no_sender' as const, claimedLog: true };
        const base = await this.merge.baseContext(tx, orgId);
        const contact = await this.merge.contactFor(tx, orgId, c.contactId);
        return { camp, tpl, to, sender, ctx: { ...base, contact } };
      }),
    );
  }

  /**
   * Records what a step did and moves the recipient on: to the next step (measured from now, the moment this one went out), or out
   * of the chain when this was the last step or the step ended it.
   */
  private async finish(
    c: Claimed,
    step: WizardFollowUp,
    now: Date,
    o: {
      outcome: Outcome;
      errorMessage: string | null;
      wamid: string | null;
      errorCode: string | null;
      /** The chain stops here, whatever steps are left. */
      end: boolean;
      /** The log row does not exist yet (a step that ended before it was claimed). */
      insert?: boolean;
      /** A row from an earlier, interrupted look exists: leave what it says, only move the recipient on. */
      keepExisting?: boolean;
    },
  ): Promise<void> {
    const { orgId } = c;
    const last = c.stepNo >= followUpsOf(c.wizard).length;
    await asSystem(orgId, () =>
      this.db.txAs({ orgId }, async (tx) => {
        if (o.insert) {
          await tx.execute(sql`
            INSERT INTO camp_follow_up_attempts (org_id, campaign_id, recipient_id, step_no, trigger, action_kind, scheduled_for, executed_at, outcome, error_message)
            VALUES (${orgId}, ${c.campaignId}, ${c.id}, ${c.stepNo}, ${step.trigger}, ${step.action.kind}, ${iso(c.baseAt)}::timestamptz,
                    ${iso(now)}::timestamptz, ${o.outcome}, ${o.errorMessage ? o.errorMessage.slice(0, 1024) : null})
            ON CONFLICT (org_id, recipient_id, step_no) DO NOTHING`);
        } else if (!o.keepExisting) {
          await tx.execute(sql`
            UPDATE camp_follow_up_attempts SET outcome = ${o.outcome}, provider_message_id = ${o.wamid},
              delivery_status = ${o.outcome === 'sent' ? 'sent' : null}, error_code = ${o.errorCode},
              error_message = ${o.errorMessage ? o.errorMessage.slice(0, 1024) : null}, executed_at = ${iso(now)}::timestamptz
            WHERE org_id = ${orgId} AND recipient_id = ${c.id} AND step_no = ${c.stepNo}`);
        } else {
          // An earlier look died after claiming the step: the message may or may not have gone out, so it is neither sent nor lost
          // in the totals: it is a failure that says why.
          await tx.execute(sql`
            UPDATE camp_follow_up_attempts SET outcome = 'failed'
            WHERE org_id = ${orgId} AND recipient_id = ${c.id} AND step_no = ${c.stepNo} AND outcome = 'claimed'`);
        }
        if (o.end || last) {
          await tx.execute(sql`
            UPDATE wp_campaign_contacts SET follow_up_state = 'done', follow_up_next = NULL, follow_up_base_at = NULL, follow_up_check_at = NULL
            WHERE org_id = ${orgId} AND id = ${c.id} AND follow_up_next = ${c.stepNo}`);
        } else {
          // The next step is measured from this one's message; its first look is at once (a watching step needs to see replies now,
          // a waiting step finds out it has time to spare and sets its own deadline).
          await tx.execute(sql`
            UPDATE wp_campaign_contacts SET follow_up_next = ${c.stepNo + 1}, follow_up_base_at = ${iso(now)}::timestamptz,
              follow_up_check_at = ${iso(now)}::timestamptz
            WHERE org_id = ${orgId} AND id = ${c.id} AND follow_up_next = ${c.stepNo}`);
        }
      }),
    );
  }

  /** The chain of a recipient whose campaign has no such step any more. */
  private async endChain(c: Claimed): Promise<void> {
    await this.db.txAs({ orgId: c.orgId }, (tx) =>
      tx.execute(sql`
        UPDATE wp_campaign_contacts SET follow_up_state = 'done', follow_up_next = NULL, follow_up_base_at = NULL, follow_up_check_at = NULL
        WHERE org_id = ${c.orgId} AND id = ${c.id} AND follow_up_state = 'active'`),
    );
  }

  /** The contact's first message since the campaign went out becomes the recipient's response (statistics, the replied event). */
  private async recordResponse(c: Claimed): Promise<void> {
    const { orgId } = c;
    if (c.contactId === null || !c.repliedAt) return;
    await asSystem(orgId, () =>
      this.db.txAs({ orgId }, async (tx) => {
        const response = c.replyText ?? '[reply]';
        const changed = await tx.execute(sql`
          UPDATE wp_campaign_contacts SET response = ${response.slice(0, 4096)}, responded_at = ${iso(c.repliedAt!)}::timestamptz
          WHERE org_id = ${orgId} AND id = ${c.id} AND response IS NULL RETURNING id`);
        if (changed.rows.length === 0) return;
        await this.events.replied(
          tx,
          c.campaignId,
          c.campaignUuid,
          c.campaignName,
          c.contactId!,
          response,
        );
        await this.campaigns.recount(tx, orgId, c.campaignId);
      }),
    );
  }
}
