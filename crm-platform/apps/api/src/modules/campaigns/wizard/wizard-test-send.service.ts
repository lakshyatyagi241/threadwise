import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  WIZARD_TEST_MAX_RECIPIENTS,
  parseTestRecipients,
  wizardStepIssues,
  type WizardTestLog,
  type WizardTestResult,
  type WizardTestSendRequest,
  type WizardTestSendResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { QUEUES } from '../../../infra/queue/queues';
import { WabaApiError } from '../../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { emitDeliveryReported, deliveryProviderOf } from '../../../kernel/outbox/delivery-report';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { MergeTagService } from '../../crm';
import { SendWindowService, scheduleWake, type WakeQueue } from '../../compliance-center';
import { purposeOfCategory } from '../../contact-consent';
import {
  EngineSenderRegistry,
  LinkTracker,
  PacingRuntime,
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  type DeliveryReceipt,
  type SenderDirectory,
  type TemplateDirectory,
  type WalletGate,
} from '../../broadcasts';
import { buildTemplatePayload, wizardVariablesOf } from '../campaign-payload';
import { WizardAudienceService } from './wizard-audience.service';
import { draftOf } from './wizard-drafts.service';
import { templateCategory } from './wizard-read.service';
import { fillText, resolveMapping, templateSlots } from './wizard-rules';
import { WizardRunService } from './wizard-run.service';
import { WizardRepository, type TestSendRow } from './wizard.repository';

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 9 };

/** The campaign queue job that sends a test the quiet hours held back, at the opening (BL-191). */
export const TEST_SEND_RELEASE_JOB = 'test-send-release';
export interface TestSendReleaseJob {
  orgId: number;
  testSendId: number;
}

type TemplateCategory = ReturnType<typeof templateCategory>;
type Prepared = Awaited<ReturnType<WizardTestSendService['prepare']>>;
type Ready = Awaited<ReturnType<WizardTestSendService['ready']>>;

const toResult = (r: TestSendRow, charged: Map<string, number>): WizardTestResult => ({
  id: r.uuid,
  to: r.to,
  status: r.status as WizardTestResult['status'],
  providerMessageId: r.providerMessageId,
  errorCode: r.errorCode,
  errorMessage: r.errorMessage,
  chargedMinor: r.providerMessageId ? (charged.get(r.providerMessageId) ?? 0) : 0,
  heldUntil: r.status === 'held' && r.heldUntil ? r.heldUntil.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

/**
 * "Send a test WhatsApp message": the draft's template and variables, resolved for a real contact of the audience, sent to the numbers
 * the person typed through the SAME send port a run uses. The numbers are checked (E.164, at most ten), the wallet's launch rule is
 * asked first (a test costs credits like any message), every number gets a log row, and the charge happens the way a normal send's does:
 * the provider's delivery report reaches `handleReceipt`, which reports it to the wallet by message id, exactly once.
 *
 * Done in the request, on purpose: it is one person asking for at most ten messages and waiting for the per-number answer. Link
 * tracking is off, so a test never counts as a click on the broadcast.
 *
 * Quiet hours (BL-191): a test of a MARKETING template to a number whose local time is inside the workspace's quiet hours is HELD, not
 * denied. Its log row says `held` with the instant it goes, and a delayed job (campaign queue, job `test-send-release`) sends it at the
 * opening, reading the hours and the wallet again. A utility or authentication template is never held.
 */
@Injectable()
export class WizardTestSendService {
  private readonly logger = new Logger(WizardTestSendService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly audience: WizardAudienceService,
    private readonly runs: WizardRunService,
    private readonly merge: MergeTagService,
    private readonly engines: EngineSenderRegistry,
    private readonly tracker: LinkTracker,
    private readonly outbox: OutboxService,
    private readonly runtime: PacingRuntime,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    private readonly sendWindow: SendWindowService,
    @InjectQueue(QUEUES.CAMPAIGN) private readonly queue: Queue,
  ) {}

  async send(req: WizardTestSendRequest): Promise<WizardTestSendResponse> {
    const ctx = RequestContextStore.require();
    const { orgId } = ctx;

    const parsed = parseTestRecipients(req.recipients);
    if (parsed.valid.length === 0 || parsed.invalid.length > 0 || parsed.tooMany) {
      const details = [
        ...parsed.invalid.map((v) => ({ path: 'recipients', message: `invalid:${v}` })),
        ...(parsed.tooMany
          ? [{ path: 'recipients', message: `too_many:${WIZARD_TEST_MAX_RECIPIENTS}` }]
          : []),
        ...(parsed.valid.length === 0 && parsed.invalid.length === 0
          ? [{ path: 'recipients', message: 'required' }]
          : []),
      ];
      throw new AppError(
        ERROR_CODES.CAMP_TEST_RECIPIENTS_INVALID,
        `Use phone numbers like +919876543210, separated by commas (at most ${WIZARD_TEST_MAX_RECIPIENTS}).`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        details,
      );
    }

    const prep = await this.prepare(orgId, req.draftId);
    const category = templateCategory(prep.template.metaCategory, prep.template.category);

    // The wallet's launch rule, for exactly these messages: refused with 422 WALLET_EMPTY when the balance cannot cover them.
    await this.wallet.precheck(orgId, parsed.valid.length, {
      source: 'campaign',
      phones: parsed.valid,
      category,
    });

    const ready = await this.ready(orgId, prep, category);
    // Quiet hours (BL-191): a test of a MARKETING template is held like any marketing message; a utility or authentication one is not.
    const windows =
      purposeOfCategory(category) === 'marketing_messaging'
        ? await this.sendWindow.checkPhones(orgId, 'message', parsed.valid)
        : null;

    const ids: number[] = [];
    const heldRows: Array<{ id: number; until: Date }> = [];
    for (const [i, number] of parsed.valid.entries()) {
      const hold = windows?.get(number.replace(/\D+/g, ''));
      if (hold && hold.decision === 'hold') {
        const until = new Date(hold.until);
        const saved = await this.db.tx((tx) =>
          this.repo.insertTestSend(tx, orgId, {
            campaignId: prep.row.id,
            templateId: prep.template.id,
            provider: prep.dispatch.engine,
            to: number,
            status: 'held',
            providerMessageId: null,
            errorCode: null,
            errorMessage: null,
            renderedBody: ready.rendered,
            createdBy: ctx.userId,
            held: { until: hold.until, reason: hold.reason },
          }),
        );
        ids.push(saved.id);
        heldRows.push({ id: saved.id, until });
        continue;
      }
      const out = await this.deliver(orgId, prep, ready, category, number, `${i}`);
      const saved = await this.db.tx((tx) =>
        this.repo.insertTestSend(tx, orgId, {
          campaignId: prep.row.id,
          templateId: prep.template.id,
          provider: prep.dispatch.engine,
          to: number,
          status: out.wamid ? 'sent' : 'failed',
          providerMessageId: out.wamid,
          errorCode: out.errorCode,
          errorMessage: out.errorMessage,
          renderedBody: ready.rendered,
          createdBy: ctx.userId,
        }),
      );
      ids.push(saved.id);
    }
    for (const h of heldRows) await this.wake(orgId, h.id, h.until);
    const rows = await this.db.tx((tx) => this.repo.testSendsByIds(tx, orgId, ids));
    return { results: rows.map((r) => toResult(r, new Map())), renderedBody: ready.rendered };
  }

  /** The draft, its template, the sender it would go from and a sample contact to resolve the variables for. Throws what the person can fix. */
  async prepare(orgId: number, draftId: string) {
    return this.db.tx(async (tx) => {
      const row = await this.repo.campaignByUuid(tx, orgId, draftId);
      if (!row) throw AppError.notFound('Broadcast draft', draftId);
      const draft = draftOf(row);
      const template = draft.templateId
        ? await this.repo.templateByUuid(tx, orgId, draft.templateId)
        : undefined;
      if (!template) {
        throw new AppError(
          ERROR_CODES.CAMP_WIZARD_INCOMPLETE,
          'Pick a template first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'templateId', message: 'template_required' }],
        );
      }
      const slots = templateSlots({
        templateBody: template.body,
        header: template.header,
        variableMap: template.variableMap,
        buttons: template.buttons,
      });
      const issues = wizardStepIssues(3, draft, {
        slots: slots.map((s) => s.slot),
        now: this.runtime.now(),
      });
      if (issues.length > 0) {
        throw new AppError(
          ERROR_CODES.CAMP_WIZARD_INCOMPLETE,
          'Map every template variable first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          issues.map((i) => ({ path: i.path, message: i.code })),
        );
      }
      const via = await this.runs.sender(tx, orgId, template, draft.senderKey);
      const dispatch = await this.senders.resolveForDispatch(tx, orgId, {
        provider: via.provider,
        deviceId: via.deviceId,
      });
      if (!dispatch) {
        throw new AppError(
          ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
          'No WhatsApp number is connected to send this template.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const [sample] = await this.audience.sample(tx, orgId, draft.audience, 1);
      const base = await this.merge.baseContext(tx, orgId);
      const contact = sample ? await this.merge.contactFor(tx, orgId, sample.id) : undefined;
      return { row, draft, template, slots, dispatch, sample, mergeCtx: { ...base, contact } };
    });
  }

  /** The open sender, the template as the send port wants it and the text for the log. */
  async ready(orgId: number, prep: Prepared, category: TemplateCategory) {
    const { row, draft, template, slots, dispatch, mergeCtx } = prep;
    void row;
    void category;
    const adapter = this.engines.get(dispatch.engine);
    if (!adapter) {
      throw new AppError(
        ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
        `No sender is available for engine ${dispatch.engine}.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const opened = await adapter.open(orgId, dispatch).catch((err: unknown) => {
      // A number that cannot send (no credentials) is something the person can fix, not a server fault.
      throw new AppError(
        ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
        err instanceof Error ? err.message : 'The WhatsApp number cannot send right now.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    });
    const tpl = await this.db.tx((tx) => this.templates.findById(tx, orgId, template.id));
    if (!tpl) throw AppError.notFound('Template');

    const resolved = resolveMapping(slots, draft.variables, mergeCtx);
    const rendered = fillText(template.body, 'body', slots, resolved.values) ?? '';
    return { opened, tpl, rendered };
  }

  /** One message to one number through the send port. Never throws: a refusal is the answer (`wamid` null with the reason). */
  private async deliver(
    orgId: number,
    prep: Prepared,
    ready: Ready,
    category: TemplateCategory,
    number: string,
    reference: string,
  ): Promise<{ wamid: string | null; errorCode: string | null; errorMessage: string | null }> {
    const { row, dispatch, sample, mergeCtx } = prep;
    const to = number.replace(/\D+/g, '');
    try {
      const built = await buildTemplatePayload(
        { db: this.db, templates: this.templates, tracker: this.tracker },
        {
          orgId,
          campaign: { id: row.id, trackingEnabled: false },
          wizardVariables: wizardVariablesOf(row.wizard),
          tpl: ready.tpl,
          overrides: null,
          contactId: sample?.id ?? 0,
          to,
          ctx: mergeCtx,
          tracking: false,
        },
      );
      const out = await ready.opened.send({
        to,
        templateName: built.name,
        language: ready.tpl.language,
        category,
        clientReference: `camptest-${row.id}-${this.runtime.now().getTime()}-${reference}`,
        ...(dispatch.engine === 'waba' ? { components: built.components } : {}),
      });
      return { wamid: out.providerMessageId, errorCode: null, errorMessage: null };
    } catch (err) {
      const errorCode = err instanceof WabaApiError && err.code !== null ? String(err.code) : null;
      this.logger.warn(
        { orgId, to: `***${to.slice(-4)}`, errorCode },
        '[CAMP] a test send was refused',
      );
      return {
        wamid: null,
        errorCode,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Queues the release of a held test at its opening (the campaign queue, job `test-send-release`). */
  private async wake(orgId: number, id: number, until: Date): Promise<void> {
    await scheduleWake(
      this.queue as unknown as WakeQueue<TestSendReleaseJob>,
      TEST_SEND_RELEASE_JOB,
      { orgId, testSendId: id },
      `camp-test-${orgId}-${id}`,
      until,
      (err) =>
        this.logger.error(
          { orgId, testSendId: id, err },
          '[CAMP] could not queue the release of a held test send',
        ),
      this.runtime.now(),
    );
  }

  /**
   * The release of a test the quiet hours held (worker). The hours are read again (a recipient still inside them waits for their own
   * opening), the draft is prepared again as it is now, the wallet's launch rule is asked again, and the message goes through the same
   * send port. A draft that was changed so that it cannot be sent any more ends the test as failed, with the reason.
   */
  async release(orgId: number, id: number): Promise<'sent' | 'failed' | 'held' | 'skipped'> {
    const t = await this.db.txAs({ orgId }, (tx) => this.repo.heldTestSend(tx, orgId, id));
    if (!t || t.status !== 'held') return 'skipped';

    const window = await this.sendWindow.checkPhones(orgId, 'message', [t.to]);
    const hold = window.get(t.to.replace(/\D+/g, ''));
    if (hold && hold.decision === 'hold') {
      const until = new Date(hold.until);
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.holdTestSend(tx, orgId, id, { until: hold.until, reason: hold.reason }),
      );
      await this.wake(orgId, id, until);
      return 'held';
    }

    const fail = async (message: string, code: string | null = null) => {
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.finishHeldTestSend(tx, orgId, id, {
          status: 'failed',
          providerMessageId: null,
          errorCode: code,
          errorMessage: message,
        }),
      );
      return 'failed' as const;
    };
    try {
      const prep = await this.prepare(orgId, t.campaignUuid);
      const category = templateCategory(prep.template.metaCategory, prep.template.category);
      await this.wallet.precheck(orgId, 1, { source: 'campaign', phones: [t.to], category });
      const ready = await this.ready(orgId, prep, category);
      const out = await this.deliver(orgId, prep, ready, category, t.to, `r${id}`);
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.finishHeldTestSend(tx, orgId, id, {
          status: out.wamid ? 'sent' : 'failed',
          providerMessageId: out.wamid,
          errorCode: out.errorCode,
          errorMessage: out.errorMessage,
        }),
      );
      return out.wamid ? 'sent' : 'failed';
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'The test could not be sent.');
    }
  }

  /** The test log of a draft, newest first, with what the wallet charged for each message. */
  async log(uuid: string): Promise<WizardTestLog> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.campaignByUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Broadcast draft', uuid);
      const rows = await this.repo.testSends(tx, orgId, row.id, 50);
      const charged = await this.repo.chargesOf(
        tx,
        orgId,
        rows.flatMap((r) => (r.providerMessageId ? [r.providerMessageId] : [])),
      );
      return { data: rows.map((r) => toResult(r, charged)) };
    });
  }

  /**
   * A delivery report about a message: if it is one of our test sends, move the log row forward and report it to the wallet (which
   * charges on delivery, once per provider message id, and refunds a failure). False for any other message, so the caller offers it to
   * the next owner.
   */
  async handleReceipt(receipt: DeliveryReceipt): Promise<boolean> {
    if (!receipt.providerMessageId) return false;
    const found = await this.db.primary.execute(
      sql`SELECT * FROM camp_test_receipt_lookup(${receipt.providerMessageId})`,
    );
    const hit = found.rows[0] as
      { test_org_id: number | string; test_id: number | string } | undefined;
    if (!hit) return false;
    const orgId = Number(hit.test_org_id);
    const id = Number(hit.test_id);
    await RequestContextStore.run(
      { requestId: `camp-test-${id}`, orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        this.db.txAs({ orgId }, async (tx) => {
          const res = await tx.execute(sql`
            SELECT t.status, t.to_phone, t.campaign_id, t.provider_message_id, t.provider,
                   coalesce(nullif(lower(w.meta_category), ''), nullif(lower(w.category), ''), 'utility') AS category
            FROM camp_test_sends t
            LEFT JOIN wa_templates w ON w.org_id = t.org_id AND w.id = t.template_id
            WHERE t.org_id = ${orgId} AND t.id = ${id} FOR UPDATE OF t`);
          const t = res.rows[0] as
            | {
                status: string;
                to_phone: string;
                campaign_id: number | string;
                provider: string;
                category: string;
              }
            | undefined;
          if (!t || (STATUS_RANK[receipt.status] ?? 0) <= (STATUS_RANK[t.status] ?? 0)) return;
          if (t.status === 'delivered' && receipt.status === 'failed') return;
          await tx.execute(sql`
            UPDATE camp_test_sends SET status = ${receipt.status},
              error_code = CASE WHEN ${receipt.status === 'failed'} THEN ${receipt.errorCode ?? null} ELSE error_code END,
              error_message = CASE WHEN ${receipt.status === 'failed'} THEN ${(receipt.errorMessage ?? '').slice(0, 1024) || null} ELSE error_message END
            WHERE org_id = ${orgId} AND id = ${id}`);
          const provider = deliveryProviderOf(t.provider);
          if (provider) {
            await emitDeliveryReported(this.outbox, tx, {
              orgId,
              aggregateModule: 'campaigns',
              aggregateId: Number(t.campaign_id),
              report: {
                provider,
                providerMessageId: receipt.providerMessageId,
                status: receipt.status,
                recipient: t.to_phone,
                category: t.category,
                source: 'campaign',
              },
            });
          }
        }),
    );
    return true;
  }
}
