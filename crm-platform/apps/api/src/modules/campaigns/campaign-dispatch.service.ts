import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SendWindowService } from '../compliance-center';
import { ConsentGate, ConsentPolicyService, purposeOfCategory } from '../contact-consent';
import { DatabaseService } from '../../infra/db/database.service';
import { MergeTagService, resolveToken, type MergeContext } from '../crm';
import {
  EngineSenderRegistry,
  LinkTracker,
  PACING_SETTINGS,
  PacingRuntime,
  SENDER_DIRECTORY,
  SenderLease,
  SenderRefused,
  SenderThrottled,
  TEMPLATE_DIRECTORY,
  WARMER_GATE,
  assemblePhone,
  batchCooldownMs,
  nextGapMs,
  resolveBodyTokens,
  sanitizeOverrides,
  type OpenedSender,
  type PacingSettings,
  type PacingSettingsSource,
  type SenderDirectory,
  type TemplateDirectory,
  type TemplateRecord,
  type WarmerGate,
} from '../broadcasts';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_SETTINGS,
  type CampaignBilling,
  type CampaignFlowStarter,
  type CampaignSettings,
  type CampaignSettingsSource,
} from './_shims/tokens';
import {
  overridesForVariant,
  pickVariant,
  tidy,
  type Bundles,
  type VariantContent,
} from './campaign-body';
import { CampaignEvents } from './campaign-events';
import { buildTemplatePayload, wizardVariablesOf } from './campaign-payload';
import { CampaignMirrorService } from './campaign-mirror.service';
import {
  MEDIA_KIND,
  mediaColumnFor,
  nextRunSlot,
  advanceRecurring,
  isEcosystemThrottle,
  retryOutcome,
  withinSendWindow,
} from './campaign-rules';
import {
  CampaignsRepository,
  type CampaignRow,
  type ClaimedRecipient,
} from './campaigns.repository';
import {
  INVALID_EMAIL,
  NO_EMAIL_ADDRESS,
  cleanSubject,
  isEmailProvider,
  isMailableAddress,
  isWalletFree,
  normalizeAddress,
  subjectSource,
} from './email-campaign-rules';

/** Recipients are claimed and sent in small slices so a long campaign never holds a transaction or a big array. */
const BATCH = 200;
/** The counters on the campaign are refreshed this often while a run is going, so the list page moves. */
const COUNTER_EVERY = 25;
/** While resting, the locks and the campaign's own "alive" mark are renewed this often. */
const HEARTBEAT_MS = 20_000;

/**
 * `busy`: another run holds the campaign or its sender; the job is put back for later.
 * `rearmed`: the run stopped for a reason that passes (window, daily limit, retries waiting) and the campaign is scheduled again.
 */
export type CampaignRunResult =
  'skipped' | 'busy' | 'finished' | 'rearmed' | 'halted' | 'expired' | 'failed';

/** `rate`: the sender's own cap (a mailbox's sends per hour) is spent for now; the campaign is scheduled again when a slot frees. */
type Stop = 'cap' | 'window' | 'wallet' | 'rate' | 'quiet' | null;

const PERMANENT_SENDER_MESSAGES = {
  waba: 'WhatsApp Cloud (Official API) campaigns must use an approved template. This campaign sends a custom message, which Meta only permits inside an open 24-hour customer session.',
  other: 'This number cannot send a custom message yet.',
};

/**
 * Runs one campaign (TW-CAMP-011, 012, 013), inside a BullMQ job in the worker: the job carries the campaign id and this re-reads
 * everything. Safe to run twice: a run takes a lock on the campaign and another on its sender, each recipient is claimed
 * (`queued` to `pending`) before the provider is called, and a row that was sent is never taken again, so a retry after a crash
 * never messages anyone twice.
 *
 * What a run does in Reference's order: opted-out contacts are stamped and duplicate numbers skipped; then per recipient the checks
 * that stop it (cancelled or paused, past the end date, outside the window, the daily limit), the gap, the variant's content, the
 * merge, link tracking, billing, the send, and the record of the outcome with its retry. At the end the campaign is completed,
 * ended (expired), or scheduled again for the retries, the closed window or tomorrow's quota; a recurring one moves to its next
 * date with every recipient queued again.
 */
@Injectable()
export class CampaignDispatchService {
  private readonly logger = new Logger(CampaignDispatchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignsRepository,
    private readonly crypto: CryptoService,
    private readonly events: CampaignEvents,
    private readonly mirror: CampaignMirrorService,
    private readonly engines: EngineSenderRegistry,
    private readonly merge: MergeTagService,
    private readonly tracker: LinkTracker,
    private readonly runtime: PacingRuntime,
    private readonly lease: SenderLease,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(WARMER_GATE) private readonly warmer: WarmerGate,
    @Inject(PACING_SETTINGS) private readonly pacingSettings: PacingSettingsSource,
    @Inject(CAMPAIGN_BILLING) private readonly billing: CampaignBilling,
    @Inject(CAMPAIGN_FLOW_STARTER) private readonly flows: CampaignFlowStarter,
    @Inject(CAMPAIGN_SETTINGS) private readonly settingsSource: CampaignSettingsSource,
    @Optional() private readonly consentPolicy?: ConsentPolicyService,
    @Optional() private readonly consentGate?: ConsentGate,
    // Quiet hours (BL-177). Optional so a caller that builds the service without it keeps the old behaviour: nothing is held.
    @Optional() private readonly sendWindow?: SendWindowService,
  ) {}

  async run(orgId: number, campaignId: number): Promise<CampaignRunResult> {
    const key = `camp:run:${orgId}:${campaignId}`;
    const token = await this.lease.acquire(key);
    if (!token) return 'busy';
    try {
      return await this.runLocked(orgId, campaignId, key, token);
    } finally {
      await this.lease.release(key, token);
    }
  }

  private async runLocked(
    orgId: number,
    campaignId: number,
    key: string,
    token: string,
  ): Promise<CampaignRunResult> {
    const prep = await this.db.txAs({ orgId }, async (t) => {
      const c = await this.repo.findById(t, orgId, campaignId);
      if (!c || c.status !== 'running') return null;
      // The unofficial engine is off for this workspace (owner decisions 2026-10-05, 2026-10-06): nothing is sent and the campaign is not touched. It keeps its
      // recipients; the sweeper parks it as `scheduled` once it stalls and starts it again when the engine is turned back on.
      if (c.provider === UNOFFICIAL_ENGINE && !(await this.unofficial.isEnabledFor(orgId)))
        return null;
      await this.repo.touch(t, orgId, campaignId);
      const settings = await this.settingsSource.get(t, orgId);
      const email = isEmailProvider(c.provider);
      await this.repo.screenRecipients(
        t,
        orgId,
        campaignId,
        // With the gate present it decides the grant requirement below; the repository keeps the flag, duplicates and counts.
        this.consentGate ? false : ((await this.consentPolicy?.requiresConsent(orgId)) ?? false),
        // An email campaign's duplicates are the same address, and a contact with none cannot be reached.
        email ? 'email' : 'phone',
      );
      if (this.consentGate) {
        const ids = await this.repo.screenCandidates(t, orgId, campaignId);
        const verdict = await this.consentGate.checkMany(
          orgId,
          ids.map((r) => r.contactId),
          // The consent that counts is the one given on the channel the message goes out on.
          email ? 'email' : 'whatsapp',
          'marketing_messaging',
          undefined,
          { tx: t },
        );
        const withdrawn = ids.filter(
          (r) => verdict.decisions.get(r.contactId)?.reason === 'withdrawn',
        );
        const missing = ids.filter(
          (r) => verdict.decisions.get(r.contactId)?.decision === 'deny' && !withdrawn.includes(r),
        );
        await this.repo.markScreened(
          t,
          orgId,
          withdrawn.map((r) => r.id),
          'unsubscribed',
        );
        await this.repo.markScreened(
          t,
          orgId,
          missing.map((r) => r.id),
          'skipped',
        );
      }
      return { c, settings };
    });
    if (!prep) return 'skipped';
    const { c, settings } = prep;
    const maxAttempts = Math.max(1, settings.retryAttempts);

    // The end date: the operator's, else the platform default for the Cloud engines (Baileys has no 24-hour window).
    const deadline = await this.deadlineOf(orgId, c, settings);
    if (deadline && deadline.getTime() <= this.runtime.now().getTime()) {
      await this.endExpired(orgId, c, maxAttempts, settings.defaultExpiryHours);
      return 'expired';
    }

    if (c.type === 'flow') return this.runFlow(orgId, c, maxAttempts, key, token);

    // The sender and everything the run needs about it.
    const setup = await this.setup(orgId, c);
    if ('failed' in setup) {
      await this.failRun(orgId, c, (setup as { failed: string }).failed);
      return 'failed';
    }
    const { sender, opened, bundles, pacing, warm, base, marketing } = setup;

    const senderKey = SenderLease.key(orgId, sender.engine, sender.id);
    const senderToken = await this.lease.acquire(senderKey);
    if (!senderToken) return 'busy';
    try {
      return await this.loop({
        orgId,
        c,
        maxAttempts,
        settings,
        deadline,
        sender,
        opened,
        bundles,
        pacing,
        warm,
        base,
        marketing,
        locks: [
          [key, token],
          [senderKey, senderToken],
        ],
      });
    } finally {
      await this.lease.release(senderKey, senderToken);
    }
  }

  // ---------------------------------------------------------------- setup

  /**
   * Is this campaign marketing for the quiet hours (BL-177)? A message of your own is. A template campaign is when either of its
   * templates is a MARKETING one (or cannot be found: the gate treats the unknown as marketing); a campaign of utility and
   * authentication templates only is a notice the person needs and is never held.
   */
  private async isMarketing(
    t: Parameters<TemplateDirectory['find']>[0],
    orgId: number,
    c: CampaignRow,
  ): Promise<boolean> {
    if (c.type !== 'template') return true;
    const ids = [c.templateId, c.abTesting ? c.templateIdB : null].filter(
      (x): x is number => x !== null,
    );
    if (ids.length === 0) return true;
    const res = await t.execute(sql`
      SELECT id, lower(coalesce(meta_category, category)) AS category FROM wa_templates
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((id) => sql`${id}::bigint`),
        sql`, `,
      )})`);
    const rows = res.rows as Array<{ category: string | null }>;
    return (
      rows.length < ids.length ||
      rows.some((r) => purposeOfCategory(r.category) === 'marketing_messaging')
    );
  }

  private async deadlineOf(
    orgId: number,
    c: CampaignRow,
    settings: CampaignSettings,
  ): Promise<Date | null> {
    if (c.expiresAt) return c.expiresAt;
    // The platform's default end date is the WhatsApp 24-hour window; a mail has none, so only the operator's own date ends it.
    if (isEmailProvider(c.provider)) return null;
    if (!settings.autoExpiryEnabled || c.provider === 'baileys') return null;
    const intentionallyPaced =
      c.scheduleType === 'recurring' ||
      (c.dailyLimit ?? 0) > 0 ||
      (c.windowStart !== null && c.windowEnd !== null);
    if (intentionallyPaced) return null;
    const first = await this.db.txAs({ orgId }, (t) => this.repo.firstSentAt(t, orgId, c.id));
    return first ? new Date(first.getTime() + settings.defaultExpiryHours * 3_600_000) : null;
  }

  private async setup(orgId: number, c: CampaignRow) {
    return this.db.txAs({ orgId }, async (t) => {
      const sender = await this.senders.resolveForDispatch(t, orgId, {
        provider: c.provider,
        deviceId: c.deviceId,
      });
      if (!sender) return { failed: 'no sender' };
      if (!sender.phoneDigits)
        return {
          failed: sender.engine === 'email' ? 'sender has no address' : 'sender has no number',
        };
      const adapter = this.engines.get(sender.engine);
      if (!adapter) return { failed: `no sender adapter for engine ${sender.engine}` };

      const a = await this.contentFor(t, orgId, c, 'A');
      if (!a) return { failed: 'template not found' };
      const b = c.abTesting ? ((await this.contentFor(t, orgId, c, 'B')) ?? a) : a;

      let opened: OpenedSender;
      try {
        opened = await adapter.open(orgId, sender);
      } catch (err) {
        return { failed: `sender could not be opened: ${String(err)}` };
      }
      const pacing = await this.pacingSettings.get(t, orgId);
      // The warm-up profile belongs to a WhatsApp number; a mailbox's id would read another table's row.
      const warm = sender.engine === 'email' ? null : await this.warmer.gap(t, sender);
      const base = await this.merge.baseContext(t, orgId);
      return {
        sender,
        opened,
        bundles: { a, b } as Bundles,
        pacing,
        warm,
        base,
        marketing: await this.isMarketing(t, orgId, c),
      };
    });
  }

  /** The content of one variant. Null when a template campaign's template is gone. */
  private async contentFor(
    t: Parameters<TemplateDirectory['find']>[0],
    orgId: number,
    c: CampaignRow,
    variant: 'A' | 'B',
  ): Promise<VariantContent | null> {
    const plain = (v: string | null) => {
      if (!v) return '';
      try {
        return this.crypto.decrypt(v);
      } catch {
        return '';
      }
    };
    const mediaUrl = c.customImage ?? c.customVideo ?? c.customDocument;
    const col = mediaUrl ? mediaColumnFor(mediaUrl) : null;
    const media = mediaUrl && col ? { kind: MEDIA_KIND[col], url: mediaUrl } : null;

    if (c.type === 'template') {
      const id = variant === 'B' ? (c.templateIdB ?? c.templateId) : c.templateId;
      const tpl = id === null ? undefined : await this.templates.findById(t, orgId, id);
      if (!tpl) return null;
      return {
        template: tpl,
        text: tpl.templateBody,
        variableMap: tpl.variableMap,
        header: tpl.header,
        footer: tpl.footer,
        buttons: Array.isArray(tpl.buttons) ? tpl.buttons : [],
        quickReplies: [],
        media: null,
        overrides: sanitizeOverrides(
          overridesForVariant({
            useB: variant === 'B',
            aTemplateId: c.templateId,
            bTemplateId: c.templateIdB ?? c.templateId,
            overridesA: sanitizeOverrides(c.templateOverrides),
            overridesB: sanitizeOverrides(c.templateOverridesB),
          }),
        ),
      };
    }
    const typedB = plain(c.customMessageB).trim();
    return {
      template: null,
      text: variant === 'B' && typedB !== '' ? typedB : plain(c.customMessage),
      variableMap: c.variableMap,
      header: plain(c.customHeader) || null,
      footer: plain(c.customFooter) || null,
      buttons: c.customButtons ?? [],
      quickReplies: c.customQuickReplies ?? [],
      media,
      overrides: null,
    };
  }

  // ---------------------------------------------------------------- the loop

  private async loop(o: {
    orgId: number;
    c: CampaignRow;
    maxAttempts: number;
    settings: CampaignSettings;
    deadline: Date | null;
    sender: { engine: string; id: number; phoneDigits: string };
    opened: OpenedSender;
    bundles: Bundles;
    pacing: PacingSettings;
    warm: { min: number; max: number } | null;
    base: Omit<MergeContext, 'contact'>;
    /** A MARKETING campaign is held for the quiet hours; one that sends only utility templates is not (BL-177). */
    marketing: boolean;
    locks: Array<[string, string]>;
  }): Promise<CampaignRunResult> {
    const { orgId, c, maxAttempts } = o;
    // Providers that take the rate themselves and need no human-like gap: SMS is sent one message at a time with no pacing.
    const official =
      o.sender.engine === 'waba' ||
      o.sender.engine === 'twilio' ||
      o.sender.engine === 'sms' ||
      o.sender.engine === 'email';
    const tMin = c.throttleMinSec ?? 0;
    const tMax = c.throttleMaxSec ?? 0;
    const randomDelay = tMin > 0 && tMax >= tMin;
    const batchOn = (c.batchSize ?? 0) > 0 ? true : o.pacing.enableBatches;
    const batchSize = (c.batchSize ?? 0) > 0 ? c.batchSize! : o.pacing.batchSize;
    const batchGapMin = c.batchPauseMin ?? o.pacing.batchGapMinutes;
    const dailyLimit = c.dailyLimit ?? 0;
    const zone = c.timezone ?? 'UTC';

    let paceIdx = 0;
    let sentThisRun = 0;
    let sinceCounters = 0;
    let stop: Stop = null;
    let halted = false;
    let expired = false;
    let rateWaitMs = 0;
    // Recipients the quiet hours keep back, and the first instant one of them opens (BL-177).
    let heldCount = 0;
    let quietUntil: Date | null = null;

    batches: for (;;) {
      const batch = await this.db.txAs({ orgId }, (t) =>
        this.repo.claim(t, orgId, c.id, c.retryFailed ? maxAttempts : 0, BATCH),
      );
      if (batch.length === 0) break;

      // One statement for the slice: whose local time is inside the workspace's quiet hours.
      const windows =
        o.marketing && this.sendWindow
          ? await this.sendWindow.checkMany(
              orgId,
              'message',
              batch.map((x) => x.contactId),
            )
          : null;

      for (const [i, r] of batch.entries()) {
        const putBack = (rest: readonly ClaimedRecipient[]) =>
          this.db.txAs({ orgId }, async (t) => {
            for (const x of rest)
              await this.repo.release(t, orgId, x.id, x.attempts > 0 ? 'failed' : 'queued');
          });

        // The operator cancelled or paused, or the end date passed: put the rest of the slice back and stop.
        const live = await this.db.txAs({ orgId }, (t) => this.repo.liveStatus(t, orgId, c.id));
        if (live !== 'running') {
          halted = true;
          await putBack(batch.slice(i));
          break batches;
        }
        if (o.deadline && o.deadline.getTime() <= this.runtime.now().getTime()) {
          expired = true;
          await putBack(batch.slice(i));
          break batches;
        }
        if (
          c.windowStart &&
          c.windowEnd &&
          !withinSendWindow(this.runtime.now(), zone, c.windowStart, c.windowEnd)
        ) {
          stop = 'window';
          await putBack(batch.slice(i));
          break batches;
        }
        if (dailyLimit > 0 && sentThisRun >= dailyLimit) {
          stop = 'cap';
          await putBack(batch.slice(i));
          break batches;
        }

        // Held, not denied: back to the queue with the instant it may go; the rest of the audience carries on.
        const hold = windows?.held.get(r.contactId);
        if (hold) {
          await this.db.txAs({ orgId }, (t) => this.repo.hold(t, orgId, r.id, hold));
          heldCount++;
          const at = new Date(hold.until);
          if (quietUntil === null || at.getTime() < quietUntil.getTime()) quietUntil = at;
          continue;
        }

        // The gap before every recipient after the first. Official engines need none: Meta and Twilio limit themselves.
        if (paceIdx > 0) {
          let gap: number;
          if (randomDelay) gap = (tMin + this.runtime.random() * (tMax - tMin)) * 1000;
          else if (official) gap = 0;
          else gap = nextGapMs(o.pacing, null, this.runtime.random);
          if (!official && batchOn && batchGapMin > 0 && paceIdx % batchSize === 0) {
            gap += batchCooldownMs(
              { ...o.pacing, batchGapMinutes: batchGapMin },
              this.runtime.random,
            );
          }
          // A warming number's own gap is a floor, whatever the campaign's pacing says.
          if (o.warm) gap = Math.max(gap, nextGapMs(o.pacing, o.warm, this.runtime.random));
          await this.rest(gap, o.locks, orgId, c.id);
        }
        paceIdx++;

        const sent = await this.sendOne(o, r, sentThisRun);
        if (typeof sent === 'object') {
          // The sender's own cap is spent: this recipient and the rest go back, and the campaign continues when a slot frees.
          stop = 'rate';
          rateWaitMs = sent.throttledMs;
          await putBack(batch.slice(i));
          break batches;
        }
        if (sent === 'wallet') {
          // The wallet cannot pay for the next message: this recipient and the rest go back, the campaign pauses (a top-up and Resume continue it).
          stop = 'wallet';
          await putBack(batch.slice(i));
          break batches;
        }
        if (sent) sentThisRun++;
        if (++sinceCounters >= COUNTER_EVERY) {
          sinceCounters = 0;
          await this.db.txAs({ orgId }, (t) => this.repo.recount(t, orgId, c.id));
        }
      }
    }

    // Everyone who could go has gone: with only held recipients left the campaign sleeps until the first of them opens.
    if (stop === null && heldCount > 0) stop = 'quiet';
    return this.finish({ ...o, stop, halted, expired, rateWaitMs, quietUntil });
  }

  /** One recipient. Returns true when it counted toward the daily limit (a real attempt, not bad data). */
  private async sendOne(
    o: Parameters<CampaignDispatchService['loop']>[0],
    r: ClaimedRecipient,
    sentThisRun: number,
  ): Promise<boolean | 'wallet' | { throttledMs: number }> {
    const { orgId, c, maxAttempts, settings } = o;
    const content = pickVariant(o.bundles, c.abTesting, r.variant);
    const mail = o.sender.engine === 'email';
    // A mail goes to the contact's address, anything else to their number.
    const to = mail ? normalizeAddress(r.email) : assemblePhone(r.phone, r.countryCode);

    const permanent = async (error: string) =>
      this.db.txAs({ orgId }, async (t) => {
        await this.repo.markFailed(t, orgId, r.id, {
          attempts: maxAttempts,
          nextAttemptAt: null,
          error,
        });
        await this.events.contactStatus(t, c.id, c.uuid, c.name, r.contactId, 'failed', { error });
      });
    const transient = async (error: string) =>
      this.db.txAs({ orgId }, async (t) => {
        // A broadcast made by the wizard leaves Meta's frequency cap (131049) to its own retry job: 24 hours apart until the end date
        // the person chose, or not at all when they did not switch retries on. Retrying it here at 6 and 12 hours would defeat that.
        // A campaign made without "Retry failed messages" treats its first failure as final too.
        const out =
          !c.retryFailed || (c.wizard !== null && isEcosystemThrottle(error))
            ? { attempts: maxAttempts, nextAttemptAt: null, final: true }
            : retryOutcome({
                attemptsBefore: r.attempts,
                maxAttempts,
                backoffSec: settings.retryBackoffSec,
                error,
                now: this.runtime.now(),
              });
        await this.repo.markFailed(t, orgId, r.id, {
          attempts: out.attempts,
          nextAttemptAt: out.nextAttemptAt,
          error,
        });
        if (out.final) {
          await this.events.contactStatus(t, c.id, c.uuid, c.name, r.contactId, 'failed', {
            error,
          });
        }
      });

    if (!to) {
      await permanent(mail ? NO_EMAIL_ADDRESS : 'No mobile number on contact');
      return false;
    }
    if (mail && !isMailableAddress(to)) {
      await permanent(INVALID_EMAIL);
      return false;
    }

    // The merge: this recipient's own values, then the body, header, footer and buttons as they will go out.
    let ctx: MergeContext;
    try {
      const contact = await this.db.txAs({ orgId }, (t) =>
        this.merge.contactFor(t, orgId, r.contactId),
      );
      ctx = { ...o.base, contact };
    } catch (err) {
      await transient(err instanceof Error ? err.message : String(err));
      return false;
    }
    const pull = (k: string) => resolveToken(k, ctx).value;
    const fill = (s: string | null) =>
      s === null || s === '' ? s : tidy(resolveBodyTokens(s, content.variableMap, pull));
    let text = fill(content.text) ?? '';
    const isTemplate = content.template !== null;
    if (!isTemplate && text.trim() === '') {
      await permanent('Empty message body after template/variable resolution');
      return false;
    }

    // Click tracking in the text of a custom message: every link becomes this recipient's own short link. A mail has none (Reference).
    if (!isTemplate && c.trackingEnabled && !mail) {
      try {
        text = await this.db.txAs({ orgId }, (t) =>
          this.tracker.wrapText(t, orgId, text, {
            campaignId: c.id,
            contactId: r.contactId,
            phone: to,
          }),
        );
      } catch (err) {
        // Tracking is an analytics nicety: it never stops a send.
        this.logger.warn(
          { orgId, campaign: c.uuid, err: String(err) },
          '[CAMP] link tracking skipped',
        );
      }
    }

    // Free under the plan's monthly messages, else the wallet must cover this message: if not, the run stops (nothing is failed).
    // SMS and email are never charged to the wallet, so an empty wallet does not stop them.
    if (!isWalletFree(o.sender.engine)) {
      const allowed = await this.billing.consume({ orgId, to, usedThisMonth: sentThisRun });
      if (!allowed) return 'wallet';
    }

    try {
      let providerMessageId: string | null;
      if (isTemplate) {
        const tpl = content.template!;
        const components =
          o.sender.engine === 'waba'
            ? await this.components(o, content, tpl, r, to, ctx)
            : undefined;
        const res = await o.opened.send({
          to,
          templateName: components ? components.name : tpl.templateName,
          language: tpl.language,
          clientReference: `camp-${c.id}-${r.contactId}`,
          ...(components ? { components: components.components } : {}),
        });
        providerMessageId = res.providerMessageId;
      } else {
        if (!o.opened.sendText) {
          await permanent(
            o.sender.engine === 'waba'
              ? PERMANENT_SENDER_MESSAGES.waba
              : PERMANENT_SENDER_MESSAGES.other,
          );
          return true;
        }
        const res = await o.opened.sendText(
          mail
            ? {
                to,
                text,
                clientReference: `camp-${c.id}-${r.contactId}`,
                // The Header field is the subject of a mail, and the campaign's name when it is blank.
                header: cleanSubject(fill(subjectSource(content.header, c.name))),
                footer: null,
              }
            : {
                to,
                text,
                clientReference: `camp-${c.id}-${r.contactId}`,
                header: fill(content.header),
                footer: fill(content.footer),
                buttons: this.resolveButtons(content.buttons, content.variableMap, pull),
                quickReplies: this.resolveButtons(content.quickReplies, content.variableMap, pull),
                media: content.media,
              },
        );
        providerMessageId = res.providerMessageId;
      }
      await this.db.txAs({ orgId }, async (t) => {
        await this.repo.markSent(t, orgId, r.id, providerMessageId);
        await this.events.contactStatus(t, c.id, c.uuid, c.name, r.contactId, 'sent', {
          providerMessageId,
        });
        // The unofficial engine cannot report delivery, so its send is what the wallet charges on.
        await this.events.deliveryReported(
          t,
          orgId,
          c.id,
          r.contactId,
          'pending',
          'sent',
          providerMessageId,
          o.sender.engine,
        );
      });
      // After the send is recorded, and never failing it: the inbox bubble is best effort. A mail writes its own thread (the mailbox's).
      if (!mail) await this.mirror.mirror(orgId, c.id, r.contactId, 'sent', providerMessageId);
    } catch (err) {
      if (err instanceof SenderThrottled) return { throttledMs: err.retryAfterMs };
      if (err instanceof SenderRefused) {
        await permanent(err.message);
        return false;
      }
      await transient(err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  private resolveButtons(list: unknown[], map: unknown, pull: (k: string) => string): unknown[] {
    return list.map((b) => {
      if (!b || typeof b !== 'object') return b;
      const out: Record<string, unknown> = { ...(b as Record<string, unknown>) };
      for (const f of ['text', 'title', 'url', 'value']) {
        if (typeof out[f] === 'string') out[f] = resolveBodyTokens(out[f] as string, map, pull);
      }
      return out;
    });
  }

  /** The Cloud API template object for one recipient: the shared builder (see campaign-payload.ts), so a retry and a test send match. */
  private async components(
    o: Parameters<CampaignDispatchService['loop']>[0],
    content: VariantContent,
    tpl: TemplateRecord,
    r: ClaimedRecipient,
    to: string,
    ctx: MergeContext,
  ): Promise<{ name: string; components: unknown[] }> {
    return buildTemplatePayload(
      { db: this.db, templates: this.templates, tracker: this.tracker },
      {
        orgId: o.orgId,
        campaign: { id: o.c.id, trackingEnabled: o.c.trackingEnabled },
        wizardVariables: wizardVariablesOf(o.c.wizard, r.variant),
        tpl,
        overrides: content.overrides,
        contactId: r.contactId,
        to,
        ctx,
      },
    );
  }

  // ---------------------------------------------------------------- flows

  /** TW-CAMP-025: one flow session per recipient. Blocked until the flow runtime exists: the recipients fail with the reason. */
  private async runFlow(
    orgId: number,
    c: CampaignRow,
    maxAttempts: number,
    key: string,
    token: string,
  ): Promise<CampaignRunResult> {
    for (;;) {
      const batch = await this.db.txAs({ orgId }, (t) =>
        this.repo.claim(t, orgId, c.id, c.retryFailed ? maxAttempts : 0, BATCH),
      );
      if (batch.length === 0) break;
      for (const r of batch) {
        const live = await this.db.txAs({ orgId }, (t) => this.repo.liveStatus(t, orgId, c.id));
        if (live !== 'running') {
          await this.db.txAs({ orgId }, (t) =>
            this.repo.release(t, orgId, r.id, r.attempts > 0 ? 'failed' : 'queued'),
          );
          return 'halted';
        }
        const flowId = r.variant === 'B' && c.flowIdB !== null ? c.flowIdB : c.flowId;
        const res = await this.db.txAs({ orgId }, async (t) => {
          if (flowId === null) return { ok: false, error: 'No flow is set on this campaign.' };
          return this.flows.start(t, orgId, {
            flowId,
            contactId: r.contactId,
            campaignId: c.id,
            variant: r.variant,
          });
        });
        await this.db.txAs({ orgId }, async (t) => {
          if (res.ok) {
            await this.repo.markSent(t, orgId, r.id, null);
            await this.events.contactStatus(t, c.id, c.uuid, c.name, r.contactId, 'sent');
          } else {
            const error = res.error ?? 'The flow could not be started.';
            await this.repo.markFailed(t, orgId, r.id, {
              attempts: maxAttempts,
              nextAttemptAt: null,
              error,
            });
            await this.events.contactStatus(t, c.id, c.uuid, c.name, r.contactId, 'failed', {
              error,
            });
          }
        });
        await this.lease.renew(key, token);
      }
    }
    await this.db.txAs({ orgId }, async (t) => {
      await this.repo.recount(t, orgId, c.id);
      await this.repo.setStatus(t, orgId, c.id, 'completed', { completed: true });
      await this.events.statusChanged(t, orgId, c.id, 'running');
    });
    return 'finished';
  }

  // ---------------------------------------------------------------- the end of a run

  private async finish(
    o: Parameters<CampaignDispatchService['loop']>[0] & {
      stop: Stop;
      halted: boolean;
      expired: boolean;
      rateWaitMs: number;
      quietUntil?: Date | null;
    },
  ): Promise<CampaignRunResult> {
    const { orgId, c, maxAttempts, settings } = o;
    const left = await this.db.txAs({ orgId }, (t) =>
      this.repo.remaining(t, orgId, c.id, c.retryFailed ? maxAttempts : 0),
    );
    if (o.stop === 'wallet') {
      await this.db.txAs({ orgId }, async (t) => {
        await this.repo.recount(t, orgId, c.id);
        await this.repo.setStatus(t, orgId, c.id, 'paused');
        await this.events.statusChanged(t, orgId, c.id, 'running');
      });
      this.logger.warn(
        { orgId, campaign: c.uuid },
        '[CAMP] paused: wallet cannot cover the next message',
      );
      return 'halted';
    }
    const live = await this.db.txAs({ orgId }, (t) => this.repo.liveStatus(t, orgId, c.id));
    if (o.halted || live === 'cancelled' || live === 'paused') {
      await this.db.txAs({ orgId }, (t) => this.repo.recount(t, orgId, c.id));
      return 'halted';
    }
    if (o.expired || (o.deadline && o.deadline.getTime() <= this.runtime.now().getTime())) {
      await this.endExpired(orgId, c, maxAttempts, settings.defaultExpiryHours);
      return 'expired';
    }

    const now = this.runtime.now();
    const recurring = c.scheduleType === 'recurring';
    let result: CampaignRunResult = 'finished';
    // The wallet stop returned above, so what is left is a daily cap or a send window.
    const stop = o.stop;

    await this.db.txAs({ orgId }, async (t) => {
      await this.repo.recount(t, orgId, c.id);
      const previous = 'running';
      if (stop && left.remaining > 0 && !recurring) {
        // The sender's own cap frees a slot at a known time (a minute of margin, since the schedule is kept to the minute).
        const slot =
          stop === 'rate'
            ? this.slotAt(new Date(now.getTime() + o.rateWaitMs + 60_000), c.timezone ?? 'UTC')
            : stop === 'quiet'
              ? // The schedule is kept to the minute: the minute the first held recipient opens in, with a margin so the run is never early.
                this.slotAt(new Date((o.quietUntil ?? now).getTime() + 59_000), c.timezone ?? 'UTC')
              : nextRunSlot(c, stop, now);
        await this.repo.setSchedule(t, orgId, c.id, { scheduleType: 'scheduled', ...slot });
        await this.repo.setStatus(t, orgId, c.id, 'scheduled');
        result = 'rearmed';
      } else if (!stop && left.retryable > 0 && !recurring) {
        // Retries are waiting: scheduled again at the earliest due time, else after one backoff.
        const at = left.nextRetryAt ?? new Date(now.getTime() + settings.retryBackoffSec * 1000);
        const slot = this.slotAt(at, c.timezone ?? 'UTC');
        await this.repo.setSchedule(t, orgId, c.id, { scheduleType: 'scheduled', ...slot });
        await this.repo.setStatus(t, orgId, c.id, 'scheduled');
        result = 'rearmed';
      } else {
        await this.repo.setStatus(t, orgId, c.id, 'completed', { completed: true });
        // A recurring campaign then moves to its next date with every recipient queued again.
        if (recurring) {
          const next = advanceRecurring(c);
          if (next) {
            await this.repo.setSchedule(t, orgId, c.id, next);
            await this.repo.requeueAll(t, orgId, c.id);
            await this.repo.setStatus(t, orgId, c.id, 'scheduled', { reopen: true });
            result = 'rearmed';
          }
        }
      }
      await this.events.statusChanged(t, orgId, c.id, previous);
    });
    this.logger.log({ orgId, campaign: c.uuid, result, stop: o.stop }, '[CAMP] run finished');
    return result;
  }

  private slotAt(at: Date, zone: string): { sendDate: string; sendTime: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
    return {
      sendDate: `${get('year')}-${get('month')}-${get('day')}`,
      sendTime: `${get('hour')}:${get('minute')}`,
    };
  }

  /** The campaign passed its end date: what was not sent never will be, and the campaign is finished. */
  private async endExpired(
    orgId: number,
    c: CampaignRow,
    maxAttempts: number,
    hours: number,
  ): Promise<void> {
    await this.db.txAs({ orgId }, async (t) => {
      await this.repo.expireUnsent(t, orgId, c.id, maxAttempts, hours);
      const n = await this.repo.recount(t, orgId, c.id);
      // Sent nothing while recipients failed: a failed campaign, not a clean completion.
      const status = n.sent === 0 && n.failed > 0 ? 'failed' : 'completed';
      await this.repo.setStatus(t, orgId, c.id, status, { completed: true });
      await this.events.statusChanged(t, orgId, c.id, 'running');
    });
  }

  /** The run cannot start (no sender, no adapter, no template): the campaign fails and its recipients stay queued. */
  private async failRun(orgId: number, c: CampaignRow, reason: string): Promise<void> {
    this.logger.warn({ orgId, campaign: c.uuid, reason }, '[CAMP] run failed');
    await this.db.txAs({ orgId }, async (t) => {
      await this.repo.setStatus(t, orgId, c.id, 'failed');
      await this.events.statusChanged(t, orgId, c.id, 'running');
    });
  }

  /** Waits `ms`, keeping every lock and the campaign's own "alive" mark fresh so a long rest is not mistaken for a dead run. */
  private async rest(
    ms: number,
    locks: Array<[string, string]>,
    orgId: number,
    campaignId: number,
  ): Promise<void> {
    if (ms <= 0) return;
    let left = ms;
    do {
      await this.runtime.sleep(Math.min(Math.max(left, 0), HEARTBEAT_MS));
      for (const [k, tok] of locks) await this.lease.renew(k, tok);
      await this.db.txAs({ orgId }, (t) => this.repo.touch(t, orgId, campaignId));
      left -= HEARTBEAT_MS;
    } while (left > 0);
  }
}
