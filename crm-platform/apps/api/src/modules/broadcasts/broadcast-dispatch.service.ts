import { OUTCOME_UNKNOWN_PREFIX, isOutcomeUnknown } from './retry-policy';
import { FailureRecorder } from '../failed-operations';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { buildSend, type TemplateShape } from '../../infra/providers/whatsapp/meta-send-payload';
import { SendWindowService } from '../compliance-center';
import { ConsentGate, purposeOfCategory } from '../contact-consent';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import {
  ContactTouchService,
  MergeTagService,
  renderMergeTags,
  resolveToken,
  type MergeContext,
} from '../crm';
import { BroadcastInboxMirrorService } from './broadcast-inbox-mirror.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { EngineSenderRegistry, renderPlainBody, type OutgoingText } from './engine-senders';
import {
  applyOverrides,
  sanitizeOverrides,
  type TemplateOverrides,
} from './payload/template-overrides';
import { buildRecipientVars } from './payload/template-vars';
import { LinkTracker } from './tracking/link-tracker';
import {
  batchCooldownMs,
  batchingApplies,
  capRemaining,
  nextGapMs,
  nextUtcMidnight,
} from './pacing';
import {
  CapTally,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
  type PacingSettingsSource,
} from './send-safety';
import { assemblePhone } from './recipient-phone';
import {
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  WARMER_GATE,
  type SenderDirectory,
  type TemplateDirectory,
  type TemplateRecord,
  type WalletGate,
  type WarmerGate,
} from './_shims/tokens';

/** Recipients are read and sent in small slices so a long broadcast never holds a transaction or a big array. */
const BATCH = 200;
/** The counters on the broadcast row are refreshed this often while a run is going, so the list page moves. */
const COUNTER_EVERY = 25;
/** A recipient claimed for sending but not settled this long ago belongs to a worker that died. */
const STALE_MINUTES = 10;
/** Tries to write the outcome of an accepted send, and the wait before the next (times the try number). */
const RECORD_ATTEMPTS = 3;
const RECORD_RETRY_MS = 250;
/** While resting, the sender lease is renewed this often. */
const HEARTBEAT_MS = 20_000;

/** `busy`: another run holds this sender; the job is put back for later. */
export type DispatchResult = 'skipped' | 'failed' | 'paused' | 'finished' | 'busy';

interface BroadcastRow {
  template_overrides: unknown;
  status: string;
  provider: string | null;
  device_id: number | string | null;
  template_id: number | string | null;
}

interface RecipientRow {
  /** Set when the recipient was held for the quiet hours and is being released now. */
  held_until: string | Date | null;
  bc_id: number | string;
  contact_id: number | string;
  phone: string | null;
  country_code: string | null;
}

/**
 * Sends one broadcast (TW-BCAST-016, and the per-recipient loop of 022 in its simplest form).
 *
 * Runs inside a BullMQ job in the worker: the job carries the broadcast id, this re-reads everything. Safe to run twice:
 * each recipient is claimed (`pending` to `processing`) before the provider is called, so a retry after a crash never
 * sends the same person twice; a claim older than STALE_MINUTES is failed as interrupted rather than re-sent.
 *
 * Failure states follow Reference: no sender, an unsupported engine or unreadable credentials mark the broadcast `failed`
 * and leave the recipients `pending`; a recipient without a usable number is failed on its own.
 */
@Injectable()
export class BroadcastDispatchService {
  private readonly logger = new Logger(BroadcastDispatchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly progress: BroadcastProgressService,
    private readonly mirror: BroadcastInboxMirrorService,
    private readonly engines: EngineSenderRegistry,
    private readonly merge: MergeTagService,
    private readonly tracker: LinkTracker,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(WARMER_GATE) private readonly warmer: WarmerGate,
    @Inject(PACING_SETTINGS) private readonly pacingSettings: PacingSettingsSource,
    private readonly runtime: PacingRuntime,
    private readonly leadHandling: ContactTouchService,
    private readonly cap: CapTally,
    private readonly lease: SenderLease,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    private readonly sendWindow: SendWindowService,
    private readonly consentGate: ConsentGate,
    // Optional so the dispatcher still builds where the record is not wired; the recipient is marked failed either way.
    @Optional() private readonly failures?: FailureRecorder,
  ) {}

  /** Must run inside a request context for `orgId` (the processor sets it from the job). */
  async run(orgId: number, broadcastId: number): Promise<DispatchResult> {
    const prep = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT status, provider, device_id, template_id, template_overrides FROM broadcasts
        WHERE org_id = ${orgId} AND id = ${broadcastId} FOR UPDATE`);
      const b = res.rows[0] as unknown as BroadcastRow | undefined;
      if (!b || !['processing', 'scheduled'].includes(b.status)) return { skip: true as const };

      // The unofficial engine is off for this workspace (owner decisions 2026-10-05, 2026-10-06): nothing is sent and nothing is changed. The row keeps its status
      // and recipients, and the queue link is cleared so the due sweep picks it up again once the engine is turned back on.
      if (b.provider === UNOFFICIAL_ENGINE && !(await this.unofficial.isEnabledFor(orgId))) {
        await tx.execute(sql`
          UPDATE broadcasts SET node_schedule_id = NULL WHERE org_id = ${orgId} AND id = ${broadcastId}`);
        this.logger.warn({ orgId, broadcastId }, '[BCAST] not sent: the unofficial engine is off');
        return { skip: true as const };
      }

      await this.progress.setStatus(tx, orgId, broadcastId, 'processing');

      const fail = async (reason: string) => {
        this.logger.warn({ orgId, broadcastId, reason }, '[BCAST] dispatch failed');
        await this.progress.setStatus(tx, orgId, broadcastId, 'failed');
        return { skip: false as const, failed: true as const };
      };

      const template =
        b.template_id === null
          ? undefined
          : await this.templates.findById(tx, orgId, Number(b.template_id));
      if (!template) return fail('template not found');

      const sender = await this.senders.resolveForDispatch(tx, orgId, {
        provider: b.provider,
        deviceId: b.device_id === null ? null : Number(b.device_id),
      });
      if (!sender) return fail('no sender');
      if (!sender.phoneDigits) return fail('sender has no number');

      const adapter = this.engines.get(sender.engine);
      if (!adapter) return fail(`no sender adapter for engine ${sender.engine}`);

      await tx.execute(sql`
        UPDATE broadcast_contacts SET status = 'failed', error_message = 'Send was interrupted before it finished'
        WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND status = 'processing'
          AND updated_at < now() - ${`${STALE_MINUTES} minutes`}::interval`);

      // Cloud API components are built per recipient for the waba engine (TW-BCAST-017). Other engines send from their own
      // template rendering, which does not read the overrides yet (see parity/broadcasts.md).
      const shape: TemplateShape & { headerLocation: unknown } = {
        templateName: template.templateName,
        language: template.language,
        templateType: template.templateType,
        templateBody: template.templateBody,
        header: template.header,
        attachmentType: template.attachmentType,
        attachmentFile: template.attachmentFile,
        parameterFormat: template.parameterFormat,
        variableMap: template.variableMap,
        buttons: template.buttons,
        carouselData: template.carouselData,
        headerLocation: template.headerLocation,
      };
      const overrides = sanitizeOverrides(b.template_overrides);
      // A MARKETING template is held for the quiet hours; a utility or authentication one is a notice the person needs (BL-177).
      const cat = await tx.execute(sql`
        SELECT lower(coalesce(meta_category, category)) AS category FROM wa_templates
        WHERE org_id = ${orgId} AND id = ${Number(b.template_id)}`);
      const marketing =
        purposeOfCategory((cat.rows[0] as { category?: string } | undefined)?.category) ===
        'marketing_messaging';
      const mergeBase = await this.merge.baseContext(tx, orgId);
      const pacing = await this.pacingSettings.get(tx, orgId);
      const warm = await this.warmer.gap(tx, sender);
      const pending = await tx.execute(sql`
        SELECT count(*)::int AS n FROM broadcast_contacts
        WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND status = 'pending'`);
      const pendingTotal = Number((pending.rows[0] as { n: number }).n);

      return {
        skip: false as const,
        failed: false as const,
        template,
        sender,
        adapter,
        shape,
        overrides,
        mergeBase,
        pacing,
        warm,
        pendingTotal,
        marketing,
      };
    });

    if (prep.skip) return 'skipped';
    if (prep.failed) return 'failed';
    const {
      template,
      sender,
      adapter,
      shape,
      overrides,
      mergeBase,
      pacing,
      warm,
      pendingTotal,
      marketing,
    } = prep;
    if (mergeBase && sender.engine === 'waba')
      this.logger.log(
        { orgId, broadcastId, engine: sender.engine },
        '[BCAST] meta_payloads are built per recipient',
      );

    let opened;
    try {
      opened = await adapter.open(orgId, sender);
    } catch (err) {
      this.logger.warn(
        { orgId, broadcastId, err: String(err) },
        '[BCAST] sender could not be opened',
      );
      await this.db.tx((tx) => this.progress.setStatus(tx, orgId, broadcastId, 'failed'));
      return 'failed';
    }

    // One run at a time per sender: two through the same number would break the gaps its quality depends on.
    const leaseKey = SenderLease.key(orgId, sender.engine, sender.id);
    const leaseToken = await this.lease.acquire(leaseKey);
    if (!leaseToken) return 'busy';
    try {
      const batching = batchingApplies(pacing, pendingTotal);
      let processed = 0;
      let sinceBatch = 0;
      let lastId = 0;
      let sinceCounters = 0;
      // Quiet hours (BL-177): recipients left `pending` because the hours are closed for them, and the earliest instant one of them opens.
      let held = 0;
      let heldEarliest: Date | null = null;
      for (;;) {
        const batch = await this.db.tx(async (tx) => {
          const res = await tx.execute(sql`
          SELECT bc.id AS bc_id, bc.contact_id, bc.held_until, c.phone, c.country_code
          FROM broadcast_contacts bc
          JOIN contacts c ON c.org_id = bc.org_id AND c.id = bc.contact_id
          WHERE bc.org_id = ${orgId} AND bc.broadcast_id = ${broadcastId} AND bc.status = 'pending' AND bc.id > ${lastId}
          ORDER BY bc.id LIMIT ${BATCH}`);
          return res.rows as unknown as RecipientRow[];
        });
        if (batch.length === 0) break;

        // One statement for the whole slice; a utility broadcast is never asked.
        const windows = marketing
          ? await this.sendWindow.checkMany(
              orgId,
              'message',
              batch.map((r) => Number(r.contact_id)),
            )
          : null;

        // A recipient released from a hold may have unsubscribed while it waited: the ConsentGate is asked again, as it is for every
        // message that leaves a queue (BL-141). Recipients that were never held keep the audience check made when the broadcast was made.
        const released = batch.filter((r) => r.held_until !== null);
        const recheck =
          released.length > 0
            ? await this.consentGate.checkMany(
                orgId,
                released.map((r) => Number(r.contact_id)),
                consentChannelOfEngine(sender.engine),
                'marketing_messaging',
              )
            : null;

        for (const r of batch) {
          lastId = Number(r.bc_id);
          const contactId = Number(r.contact_id);
          const to = assemblePhone(r.phone, r.country_code);

          const verdict = recheck?.decisions.get(contactId);
          if (verdict && verdict.decision === 'deny') {
            const why =
              verdict.reason === 'withdrawn'
                ? 'Not sent: the contact unsubscribed while the message waited for the quiet hours to end'
                : 'Not sent: no recorded consent';
            await this.db.tx(async (tx) => {
              const from = await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
                status: 'failed',
                error: why,
              });
              if (from !== null)
                await this.progress.emitMessage(
                  tx,
                  orgId,
                  broadcastId,
                  contactId,
                  'failed',
                  'send',
                  {
                    errorReason: why,
                  },
                );
            });
            processed++;
            continue;
          }

          // Held, not denied: the recipient stays `pending` with the instant it may go, the rest of the audience carries on.
          const hold = windows?.held.get(contactId);
          if (hold) {
            await this.db.tx((tx) =>
              tx.execute(sql`
                UPDATE broadcast_contacts SET held_until = ${hold.until}::timestamptz, held_reason = ${hold.reason}
                WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId} AND status = 'pending'`),
            );
            held++;
            const at = new Date(hold.until);
            if (heldEarliest === null || at.getTime() < heldEarliest.getTime()) heldEarliest = at;
            continue;
          }

          // The unofficial engine has a daily cap per number (Reference's default 4000). At the cap the run stops, nobody is lost,
          // and it resumes after midnight UTC.
          if (to && sender.engine === 'baileys') {
            const used = await this.cap.sentToday(orgId, sender.engine, sender.id);
            if (capRemaining(pacing.baileysDailyCap, used) <= 0) {
              const now = this.runtime.now();
              await this.db.tx(async (tx) => {
                await this.progress.recompute(tx, orgId, broadcastId);
                await this.progress.pause(tx, orgId, broadcastId, {
                  reason: 'daily_cap',
                  at: now.toISOString(),
                  resumeAfter: nextUtcMidnight(now).toISOString(),
                });
              });
              this.logger.warn({ orgId, broadcastId, used }, '[BCAST] paused: daily cap reached');
              return 'paused';
            }
          }

          // The wallet must pay for this message: when it cannot, the run stops here (nobody is failed) until a top-up and Resume.
          if (to) {
            try {
              await this.wallet.precheckSend(orgId, to, {
                source: 'broadcast',
                category: 'marketing',
              });
            } catch (err) {
              if (!(err instanceof AppError && err.code === ERROR_CODES.WALLET_EMPTY)) throw err;
              await this.db.tx(async (tx) => {
                await this.progress.recompute(tx, orgId, broadcastId);
                await this.progress.pause(tx, orgId, broadcastId, {
                  reason: 'manual',
                  at: this.runtime.now().toISOString(),
                });
              });
              this.logger.warn(
                { orgId, broadcastId },
                '[BCAST] paused: wallet cannot cover the next message',
              );
              return 'paused';
            }
          }

          const claimed = await this.db.tx(async (tx) => {
            if (!to) {
              await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
                status: 'failed',
                error: 'No usable phone number',
              });
              await this.progress.emitMessage(tx, orgId, broadcastId, contactId, 'failed', 'send', {
                errorReason: 'No usable phone number',
              });
              return false;
            }
            const res = await tx.execute(sql`
            UPDATE broadcast_contacts SET status = 'processing', held_until = NULL, held_reason = NULL
            WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId} AND status = 'pending'
            RETURNING id`);
            return res.rows.length > 0;
          });
          if (!claimed) {
            processed++;
            continue;
          }

          try {
            const clientReference = `bcast-${broadcastId}-${contactId}`;
            let sent: { providerMessageId: string | null };
            if (sender.engine !== 'waba' && opened.sendText) {
              // Plain-text engines (unofficial, Twilio): the rendered template, not a Meta template.
              sent = await opened.sendText(
                await this.textFor(
                  orgId,
                  contactId,
                  to,
                  template,
                  shape,
                  mergeBase,
                  clientReference,
                  sender.engine,
                ),
              );
            } else {
              const built =
                sender.engine === 'waba'
                  ? await this.payloadFor(
                      orgId,
                      broadcastId,
                      contactId,
                      template.id,
                      to,
                      shape,
                      overrides,
                      mergeBase,
                    )
                  : null;
              sent = await opened.send({
                to,
                templateName: built ? built.name : template.templateName,
                language: template.language,
                clientReference,
                ...(built ? { components: built.components } : {}),
              });
            }
            // The provider has accepted the message. Nothing below may turn that into a failed recipient: a failed one is sent again.
            await this.recordSent(orgId, broadcastId, contactId, sent.providerMessageId);
            if (sender.engine === 'baileys') await this.cap.bump(orgId, sender.engine, sender.id);
          } catch (err) {
            if (err instanceof AppError && err.code === ERROR_CODES.AUTH_SEND_HALTED) {
              // The emergency halt is on: put this recipient back and stop. Nothing is lost; the run resumes when it is lifted.
              await this.db.tx(async (tx) => {
                await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
                  status: 'pending',
                });
                await this.progress.recompute(tx, orgId, broadcastId);
                await this.progress.pause(tx, orgId, broadcastId, {
                  reason: 'halt',
                  at: this.runtime.now().toISOString(),
                });
              });
              this.logger.warn({ orgId, broadcastId }, '[BCAST] paused by the emergency halt');
              return 'paused';
            }
            const message = err instanceof Error ? err.message : String(err);
            // A timeout or reset may have been accepted by the provider: say so, and the automatic retry leaves it alone.
            const unknown = isOutcomeUnknown(err);
            const reason = unknown ? `${OUTCOME_UNKNOWN_PREFIX}${message}` : message;
            // Shown as failed and never resent by itself; the record lets a person check the provider's receipt first (DLQ audit DF-08).
            if (unknown)
              await this.failures?.recordUnknownOutcome({
                source: 'broadcast-send',
                orgId,
                ref: `${broadcastId}:${contactId}`,
                jobName: 'broadcast-recipient',
                reason: message,
              });
            await this.db.tx(async (tx) => {
              const from = await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
                status: 'failed',
                error: reason,
              });
              if (from !== null)
                await this.progress.emitMessage(
                  tx,
                  orgId,
                  broadcastId,
                  contactId,
                  'failed',
                  'send',
                  {
                    errorReason: reason,
                  },
                );
            });
          }

          // A human-paced gap between messages, and a longer rest between batches. Not after the last recipient.
          processed++;
          // SMS is sent one message at a time with no pacing: the provider and the carrier set the rate, not a human-like gap.
          if (processed < pendingTotal - held && sender.engine !== 'sms') {
            if (batching && ++sinceBatch >= pacing.batchSize) {
              sinceBatch = 0;
              await this.rest(batchCooldownMs(pacing, this.runtime.random), leaseKey, leaseToken);
            } else {
              await this.rest(nextGapMs(pacing, warm, this.runtime.random), leaseKey, leaseToken);
            }
          }

          if (++sinceCounters >= COUNTER_EVERY) {
            sinceCounters = 0;
            await this.db.tx((tx) => this.progress.recompute(tx, orgId, broadcastId));
          }
        }
      }

      // Everyone who could go has gone. Those held for the quiet hours wait: the broadcast pauses until the first of them opens and the
      // resume sweep then takes it up again (the consent and the hours are asked once more for each).
      if (held > 0 && heldEarliest) {
        const resumeAfter = heldEarliest;
        await this.db.tx(async (tx) => {
          await this.progress.recompute(tx, orgId, broadcastId);
          await this.progress.pause(tx, orgId, broadcastId, {
            reason: 'quiet_hours',
            at: this.runtime.now().toISOString(),
            resumeAfter: resumeAfter.toISOString(),
          });
        });
        this.logger.log(
          { orgId, broadcastId, held, resumeAfter },
          '[BCAST] paused: recipients held for the quiet hours',
        );
        return 'paused';
      }
      const final = await this.db.tx((tx) => this.progress.finish(tx, orgId, broadcastId));
      this.logger.log({ orgId, broadcastId, final }, '[BCAST] dispatch finished');
      return 'finished';
    } finally {
      await this.lease.release(leaseKey, leaseToken);
    }
  }

  /**
   * Writes the outcome of a send the provider accepted. Never throws: a database error here must not mark the recipient failed (the
   * automatic retry would send it a second time). It is tried again a few times; if the database stays down the recipient keeps its
   * claim, and the stale-claim pass later marks it as interrupted, which the automatic retry skips.
   */
  private async recordSent(
    orgId: number,
    broadcastId: number,
    contactId: number,
    providerMessageId: string | null,
  ): Promise<void> {
    for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
      try {
        await this.db.tx(async (tx) => {
          const from = await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
            status: 'sent',
            providerMessageId,
          });
          if (from !== null) {
            await this.progress.emitMessage(tx, orgId, broadcastId, contactId, 'sent', 'send', {
              providerMessageId,
            });
            // The broadcast reached the contact: lead handling (the uncontacted marker, BL-290). Never throws.
            await this.leadHandling.touch(tx, orgId, contactId, 'automation');
          }
        });
        // The inbox bubble is best effort and has its own transaction: it never undoes the recorded send.
        await this.mirror
          .mirror(orgId, broadcastId, contactId, 'sent', providerMessageId)
          .catch((err: Error) =>
            this.logger.warn(
              { orgId, broadcastId, err: err.message },
              '[BCAST] inbox mirror failed',
            ),
          );
        return;
      } catch (err) {
        if (attempt === RECORD_ATTEMPTS) {
          this.logger.error(
            { orgId, broadcastId, contactId, providerMessageId, err: (err as Error).message },
            '[BCAST] provider accepted the message but its result could not be recorded',
          );
          return;
        }
        await this.runtime.sleep(RECORD_RETRY_MS * attempt);
      }
    }
  }

  /** Waits `ms`, renewing the sender lease so a long cooldown does not give the number away. */
  private async rest(ms: number, leaseKey: string, token: string): Promise<void> {
    for (let left = ms; left > 0; left -= HEARTBEAT_MS) {
      await this.runtime.sleep(Math.min(left, HEARTBEAT_MS));
      await this.lease.renew(leaseKey, token);
    }
  }

  /**
   * The text a plain-text engine (the unofficial engine, Twilio) sends one recipient: the template's body with this contact's
   * values, its header and footer, and its media as a link. Send-time overrides are Cloud API components, not applied here.
   */
  private async textFor(
    orgId: number,
    contactId: number,
    to: string,
    template: TemplateRecord,
    shape: TemplateShape & { headerLocation: unknown },
    base: Omit<MergeContext, 'contact'>,
    clientReference: string,
    engine: string,
  ): Promise<OutgoingText> {
    const contact = await this.db.tx((tx) => this.merge.contactFor(tx, orgId, contactId));
    const ctx: MergeContext = { ...base, contact };
    const vars = buildRecipientVars(shape, {
      pull: (key) => resolveToken(key, ctx).value,
      mediaUrl: (path) => this.templates.mediaUrl(path),
    });
    const kind = (template.attachmentType ?? '').toLowerCase();
    const media =
      vars.headerMediaUrl && (kind === 'image' || kind === 'video' || kind === 'document')
        ? { kind: kind as 'image' | 'video' | 'document', url: vars.headerMediaUrl }
        : null;
    return {
      to,
      // An SMS template with `{{first_name}}` and no variable map would render every token empty (Reference's defect, TW-SMS-014): its
      // tokens are resolved against the contact itself instead.
      text:
        engine === 'sms' && vars.body === undefined
          ? renderMergeTags(template.templateBody, ctx).rendered
          : renderPlainBody(template.templateBody, vars.body),
      header: vars.header ?? (template.header && !media ? template.header : null),
      footer: template.footer,
      media,
      clientReference,
    };
  }

  /**
   * The Cloud API template object for one recipient: the template's variables resolved against this contact (column,
   * attribute, workspace default, system token), the send-time overrides laid over them, then the Meta rules applied.
   */
  private async payloadFor(
    orgId: number,
    broadcastId: number,
    contactId: number,
    templateId: number,
    phone: string,
    shape: TemplateShape & { headerLocation: unknown },
    overrides: TemplateOverrides | null,
    base: Omit<MergeContext, 'contact'>,
  ): Promise<{ name: string; components: unknown[] }> {
    const contact = await this.db.tx((tx) => this.merge.contactFor(tx, orgId, contactId));
    const ctx: MergeContext = { ...base, contact };
    const vars = buildRecipientVars(shape, {
      pull: (key) => resolveToken(key, ctx).value,
      mediaUrl: (path) => this.templates.mediaUrl(path),
    });
    const applied = applyOverrides(vars, overrides, (text) => renderMergeTags(text, ctx).rendered);
    if (applied.ignoredButtons.length) {
      // The UI offered a button slot this template cannot take; Meta would reject a parameter for it (#132000).
      this.logger.warn(
        { orgId, broadcastId, buttons: applied.ignoredButtons },
        '[BCAST] button overrides ignored: not parameterised in the template',
      );
    }
    // Every URL button gets this recipient's own short link, so a tap is attributed to them (TW-BCAST-018).
    const tracked = await this.db.tx((tx) =>
      this.tracker.wrapVars(
        tx,
        orgId,
        applied.vars,
        { broadcastId, contactId, templateId, phone },
        { buttons: shape.buttons, carouselData: shape.carouselData },
      ),
    );
    const send = buildSend(shape, tracked);
    return { name: send.name, components: send.components };
  }
}

/** The consent channel a broadcast engine sends on: the ledger keeps one grant per channel. */
function consentChannelOfEngine(engine: string): string {
  return engine === 'sms' ? 'sms' : engine === 'email' ? 'email' : 'whatsapp';
}
