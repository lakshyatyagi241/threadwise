import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConsentGate, ConsentPolicyService } from '../contact-consent';
import { DatabaseService } from '../../infra/db/database.service';
import { MergeTagService, resolveToken, type MergeContext } from '../crm';
import {
  EngineSenderRegistry,
  LinkTracker,
  PACING_SETTINGS,
  PacingRuntime,
  SENDER_DIRECTORY,
  SenderLease,
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

type Stop = 'cap' | 'window' | 'wallet' | null;

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
      await this.repo.screenRecipients(
        t,
        orgId,
        campaignId,
        // With the gate present it decides the grant requirement below; the repository keeps the flag, duplicates and counts.
        this.consentGate ? false : ((await this.consentPolicy?.requiresConsent(orgId)) ?? false),
      );
      if (this.consentGate) {
        const ids = await this.repo.screenCandidates(t, orgId, campaignId);
        const verdict = await this.consentGate.checkMany(
          orgId,
          ids.map((r) => r.contactId),
          'whatsapp',
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
    const { sender, opened, bundles, pacing, warm, base } = setup;

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

  private async deadlineOf(
    orgId: number,
    c: CampaignRow,
    settings: CampaignSettings,
  ): Promise<Date | null> {
    if (c.expiresAt) return c.expiresAt;
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
      if (!sender.phoneDigits) return { failed: 'sender has no number' };
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
      const warm = await this.warmer.gap(t, sender);
      const base = await this.merge.baseContext(t, orgId);
      return { sender, opened, bundles: { a, b } as Bundles, pacing, warm, base };
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
    locks: Array<[string, string]>;
  }): Promise<CampaignRunResult> {
    const { orgId, c, maxAttempts } = o;
    // Providers that take the rate themselves and need no human-like gap: SMS is sent one message at a time with no pacing.
    const official =
      o.sender.engine === 'waba' || o.sender.engine === 'twilio' || o.sender.engine === 'sms';
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

    batches: for (;;) {
      const batch = await this.db.txAs({ orgId }, (t) =>
        this.repo.claim(t, orgId, c.id, maxAttempts, BATCH),
      );
      if (batch.length === 0) break;

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

    return this.finish({ ...o, stop, halted, expired });
  }

  /** One recipient. Returns true when it counted toward the daily limit (a real attempt, not bad data). */
  private async sendOne(
    o: Parameters<CampaignDispatchService['loop']>[0],
    r: ClaimedRecipient,
    sentThisRun: number,
  ): Promise<boolean | 'wallet'> {
    const { orgId, c, maxAttempts, settings } = o;
    const content = pickVariant(o.bundles, c.abTesting, r.variant);
    const to = assemblePhone(r.phone, r.countryCode);

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
        const out =
          c.wizard !== null && isEcosystemThrottle(error)
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
      await permanent('No mobile number on contact');
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

    // Click tracking in the text of a custom message: every link becomes this recipient's own short link.
    if (!isTemplate && c.trackingEnabled) {
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
    const allowed = await this.billing.consume({ orgId, to, usedThisMonth: sentThisRun });
    if (!allowed) return 'wallet';

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
        const res = await o.opened.sendText({
          to,
          text,
          clientReference: `camp-${c.id}-${r.contactId}`,
          header: fill(content.header),
          footer: fill(content.footer),
          buttons: this.resolveButtons(content.buttons, content.variableMap, pull),
          quickReplies: this.resolveButtons(content.quickReplies, content.variableMap, pull),
          media: content.media,
        });
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
      // After the send is recorded, and never failing it: the inbox bubble is best effort.
      await this.mirror.mirror(orgId, c.id, r.contactId, 'sent', providerMessageId);
    } catch (err) {
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
        this.repo.claim(t, orgId, c.id, maxAttempts, BATCH),
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
    },
  ): Promise<CampaignRunResult> {
    const { orgId, c, maxAttempts, settings } = o;
    const left = await this.db.txAs({ orgId }, (t) =>
      this.repo.remaining(t, orgId, c.id, maxAttempts),
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
        const slot = nextRunSlot(c, stop, now);
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
