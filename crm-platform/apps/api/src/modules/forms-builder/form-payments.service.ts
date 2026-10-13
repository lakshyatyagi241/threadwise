import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  minorToMajor,
  type FormDefinition,
  type FormPaymentAttempt,
  type PublicFormNext,
  type PublicFormSubmissionStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { HtmlSanitizerService } from '../auth';
import {
  GatewayLinkService,
  GatewayPaymentRegistry,
  WorkspaceGatewayResolver,
  supportsPaymentLinks,
  type GatewayPaymentContext,
  type GatewayPaymentOutcome,
  type GatewayPaymentSettler,
} from '../checkout-orders-merchant-payments';
import { ContactActivitiesRepository, ContactsRepository } from '../crm';
import { runAsSystemIn } from './form-context';
import { notFound, type FormRoute } from './form-lookup.service';
import {
  FORM_PAYMENT_REFERENCE_PREFIX,
  FORM_PAYMENT_TTL_HOURS,
  computeAmount,
  formPaymentReference,
  paymentUuidFromReference,
} from './form-payment-rules';
import type { StoredAnswer } from './form-rules';
import { FormPaymentsRepository, type PaymentRow } from './form-payments.repository';
import { FormsRepository, type FormRow } from './forms.repository';
import { readDefinition } from './forms.mapper';
import type { SubmissionRow } from './form-submissions.repository';

const PAYMENT_MODULE = 'web_form_payments';
const SUBMISSION_MODULE = 'web_form_submissions';
const EVENT_MODULE = 'forms';
const MS_PER_HOUR = 3_600_000;

/** What the gateway page is told about the payer, read from the answers the visitor gave. */
export interface Payer {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export const toAttempt = (
  p: PaymentRow,
  gatewayName: string = p.gatewaySlug,
): FormPaymentAttempt => ({
  id: p.uuid,
  reference: p.reference,
  gateway: gatewayName,
  amountMinor: p.amountMinor.toString(),
  currency: p.currency,
  status: p.status,
  settledVia: p.settledVia,
  providerRef: p.providerRef,
  paidAt: p.paidAt ? p.paidAt.toISOString() : null,
  expiresAt: p.expiresAt.toISOString(),
  createdAt: p.createdAt.toISOString(),
});

/**
 * Payments inside a form (docs/specs/forms-builder-app.md section 10).
 *
 *   submit  -> the answers are validated, the SERVER computes the amount from the frozen version, the CRM is written, an attempt row is
 *              stored `pending` and the submission is `awaiting_payment` (one transaction)
 *   commit  -> the hosted payment link is minted on the workspace's gateway (network I/O, never inside a transaction) and the visitor is
 *              sent to it
 *   webhook -> the gateway's verified notification reaches `settle` by the `FRM-` prefix: the attempt and the submission become `paid`
 *
 * The page the visitor returns to is NEVER proof of payment: it reads the status this service wrote from the notification. This class is
 * also the registered settler; registering happens in `onModuleInit`, next to the store's `WAORD-` and invoicing's `INV-`.
 */
@Injectable()
export class FormPaymentsService implements GatewayPaymentSettler, OnModuleInit {
  readonly prefix = FORM_PAYMENT_REFERENCE_PREFIX;
  private readonly logger = new Logger(FormPaymentsService.name);
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FormPaymentsRepository,
    private readonly forms: FormsRepository,
    private readonly resolver: WorkspaceGatewayResolver,
    private readonly links: GatewayLinkService,
    private readonly registry: GatewayPaymentRegistry,
    private readonly sanitizer: HtmlSanitizerService,
    private readonly contacts: ContactsRepository,
    private readonly activities: ContactActivitiesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  // --- at submit ---------------------------------------------------------------------------------------------------------------------

  /**
   * Before anything is stored: a form that takes payment needs a gateway that can make a hosted link NOW. Otherwise the form is closed
   * (never a free pass): 422 FORMS_PAYMENT_UNAVAILABLE, the visitor's answers are not stored.
   */
  async assertGateway(orgId: number): Promise<string> {
    const gw = await this.resolver.resolve(orgId);
    if (!gw || !supportsPaymentLinks(gw.slug)) {
      throw new AppError(
        ERROR_CODES.FORMS_PAYMENT_UNAVAILABLE,
        'This form cannot take payment right now. Please try again later.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return gw.slug;
  }

  /**
   * Stores the pending attempt for a submission whose CRM write succeeded (inside the submission's transaction) and marks the submission
   * `awaiting_payment`. Null when the form takes no payment. The amount comes from the frozen definition and the validated answers only.
   */
  async openAttemptIn(
    tx: Tx,
    orgId: number,
    form: FormRow,
    def: FormDefinition,
    sub: SubmissionRow,
    values: Record<string, StoredAnswer>,
    gatewaySlug: string,
  ): Promise<PaymentRow | null> {
    if (!def.payment.enabled) return null;
    const amount = computeAmount(def, values);
    if (!amount.ok) {
      // validated before the claim, so this is a stored submission re-run under a form whose rules changed: keep it for a person.
      throw new AppError(
        ERROR_CODES.FORMS_PAYMENT_STATE,
        `Cannot compute the amount: ${amount.reason}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const uuid = randomUUID();
    const payment = await this.repo.insert(tx, orgId, {
      uuid,
      reference: formPaymentReference(uuid),
      submissionId: sub.id,
      gatewaySlug,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      expiresAt: new Date(Date.now() + FORM_PAYMENT_TTL_HOURS * MS_PER_HOUR),
    });
    await this.repo.setSubmissionStatus(tx, orgId, sub.id, 'awaiting_payment');
    await this.audit.record(tx, {
      module: PAYMENT_MODULE,
      recordId: payment.id,
      action: 'insert',
    });
    await this.outbox.emit(tx, {
      aggregateModule: EVENT_MODULE,
      aggregateId: sub.id,
      eventType: 'form.payment_pending',
      orgId,
      payload: {
        formId: form.uuid,
        formName: form.name,
        submissionId: sub.uuid,
        paymentId: payment.uuid,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
      },
    });
    return payment;
  }

  /**
   * Mints the hosted link for a pending attempt, AFTER commit. Null when the gateway refused or cannot (the attempt stays pending: staff
   * can get a fresh link). Never throws for a provider failure.
   */
  async mintLink(
    orgId: number,
    paymentUuid: string,
    formKey: string,
    receiptToken: string,
    payer: Payer,
    formName: string,
  ): Promise<string | null> {
    try {
      const loaded = await this.db.txAs({ orgId, userId: null }, async (tx) => {
        const p = await this.repo.findByUuidForUpdate(tx, orgId, paymentUuid);
        return p;
      });
      if (!loaded || loaded.status !== 'pending') return null;
      const gateway = await this.resolver.resolve(orgId, null, { slug: loaded.gatewaySlug });
      if (!gateway) return null;
      const link = await this.links.mint(gateway, {
        reference: loaded.reference,
        amountMinor: loaded.amountMinor,
        currency: loaded.currency,
        description:
          `${formName} (${minorToMajor(loaded.amountMinor, loaded.currency)} ${loaded.currency})`.slice(
            0,
            255,
          ),
        customerName: payer.name,
        customerEmail: payer.email,
        customerPhone: payer.phone,
        callbackUrl: `${this.webUrl}/f/${encodeURIComponent(formKey)}/pay-return?s=${encodeURIComponent(receiptToken)}`,
        notes: { form: formKey },
      });
      if (!link) return null;
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.setLink(tx, orgId, loaded.id, link.url),
      );
      return link.url;
    } catch (err) {
      this.logger.error({ err, orgId, paymentUuid }, 'form payment link could not be made');
      return null;
    }
  }

  /** The page the visitor returns to: where the payment stands (read from what the webhook wrote), and what to show once it is paid. */
  async publicStatus(route: FormRoute, token: string): Promise<PublicFormSubmissionStatus> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw notFound();
    const { sub, def, latest } = await this.db.txAs(
      { orgId: route.orgId, userId: null },
      async (tx) => {
        const s = await this.repo.findSubmissionByReceipt(tx, route.orgId, route.formId, token);
        if (!s) return { sub: null, def: null, latest: null };
        const version = await this.forms.findVersionById(tx, route.orgId, s.versionId);
        const attempts = await this.repo.listBySubmission(tx, route.orgId, s.id);
        return {
          sub: s,
          def: version ? readDefinition(version.definition) : null,
          latest: attempts,
        };
      },
    );
    if (!sub || !def || !latest) throw notFound();
    const next = (): PublicFormNext => this.nextFor(def);
    if (latest.length === 0) return { payment: 'not_required', next: next(), payUrl: null };
    if (latest.some((a) => a.status === 'paid'))
      return { payment: 'paid', next: next(), payUrl: null };
    const open = latest.find((a) => a.status === 'pending' && a.expiresAt.getTime() > Date.now());
    if (open) return { payment: 'awaiting_payment', next: null, payUrl: open.linkUrl };
    return {
      payment: latest[0]!.status === 'failed' ? 'failed' : 'expired',
      next: null,
      payUrl: null,
    };
  }

  /** The thank-you the form's settings give: the message (sanitised) or the https redirect. */
  nextFor(def: FormDefinition): PublicFormNext {
    const s = def.settings;
    return s.successMode === 'redirect' && s.redirectUrl
      ? { type: 'redirect', url: s.redirectUrl }
      : { type: 'message', message: this.sanitizer.sanitize(s.successMessage) };
  }

  // --- the staff side ----------------------------------------------------------------------------------------------------------------

  /** Payment attempts of submissions, for the staff screen. */
  attemptsFor(tx: Tx, orgId: number, submissionIds: number[]): Promise<Map<number, PaymentRow[]>> {
    return this.repo.listBySubmissions(tx, orgId, submissionIds);
  }

  /**
   * A fresh payment link for a submission still awaiting payment (the first link failed, or expired). Opens a new attempt (the amount is
   * computed again from the frozen version the visitor saw) and mints it. Runs in the caller's transaction for the attempt; the link is
   * minted by the caller after commit.
   */
  async newAttemptIn(
    tx: Tx,
    orgId: number,
    form: FormRow,
    sub: SubmissionRow,
  ): Promise<PaymentRow> {
    if (sub.status !== 'awaiting_payment') throw this.stateError('not_awaiting_payment');
    if (sub.erasedAt !== null || sub.payloadPurgedAt !== null) {
      throw new AppError(
        ERROR_CODES.FORMS_SUBMISSION_PURGED,
        'The answers of this submission were removed, so the amount cannot be worked out again.',
        HttpStatus.GONE,
      );
    }
    const attempts = await this.repo.listBySubmission(tx, orgId, sub.id);
    if (attempts.some((a) => a.status === 'paid')) throw this.stateError('already_paid');
    const version = await this.forms.findVersionById(tx, orgId, sub.versionId);
    if (!version) throw notFound();
    const def = readDefinition(version.definition);
    const gatewaySlug = await this.assertGateway(orgId);
    const created = await this.openAttemptIn(
      tx,
      orgId,
      form,
      def,
      sub,
      sub.answers as Record<string, StoredAnswer>,
      gatewaySlug,
    );
    if (!created) throw this.stateError('payment_off');
    for (const a of attempts) {
      if (a.status === 'pending') {
        await tx.execute(
          sql`UPDATE web_form_payments SET status = 'expired' WHERE org_id = ${orgId} AND id = ${a.id}`,
        );
      }
    }
    return created;
  }

  /**
   * "Mark as paid": money arrived outside the gateway (a bank transfer, cash). An audited staff action in the caller's transaction and
   * request context, so the trail names the person.
   */
  async markPaidManuallyIn(
    tx: Tx,
    orgId: number,
    form: FormRow,
    sub: SubmissionRow,
  ): Promise<void> {
    if (sub.status !== 'awaiting_payment') throw this.stateError('not_awaiting_payment');
    const attempts = await this.repo.listBySubmission(tx, orgId, sub.id);
    const target = attempts.find((a) => a.status === 'pending') ?? attempts[0];
    if (!target) throw this.stateError('payment_off');
    const locked = await this.repo.findByUuidForUpdate(tx, orgId, target.uuid);
    if (!locked) throw notFound();
    await this.applyPaid(tx, orgId, form, locked, 'manual', null);
  }

  // --- the webhook ------------------------------------------------------------------------------------------------------------------

  /**
   * A verified notification for one of our references. The gateway module checked the signature with the right gateway's secret. Same
   * rules as the invoice and store settlers: look the attempt up inside this organization only, the amount and currency must equal what we
   * asked for (a provider that states no amount is refused: this is money), a replay changes nothing.
   */
  async settle(ctx: GatewayPaymentContext): Promise<GatewayPaymentOutcome> {
    const { tx, orgId, payment } = ctx;
    const uuid = paymentUuidFromReference(ctx.reference);
    if (!uuid) return { outcome: 'rejected:bad_reference' };
    const attempt = await this.repo.findByUuidForUpdate(tx, orgId, uuid);
    // Only an attempt made on THIS gateway: a notification of one gateway cannot settle another's.
    if (!attempt || attempt.gatewaySlug !== ctx.gateway.slug) {
      return { outcome: 'rejected:attempt_unknown' };
    }
    if (attempt.status === 'paid') return { outcome: 'duplicate' };
    if (
      payment.amountMinor === undefined ||
      payment.amountMinor !== attempt.amountMinor ||
      (payment.currency !== undefined && payment.currency.toUpperCase() !== attempt.currency)
    ) {
      await this.rejected(tx, orgId, attempt, 'amount_or_currency_mismatch', ctx);
      return { outcome: 'rejected:amount_mismatch' };
    }
    const form = await this.formOf(tx, orgId, attempt.submissionId);
    if (!form) return { outcome: 'rejected:form_missing' };
    await this.applyPaid(tx, orgId, form, attempt, 'gateway', payment.gatewayPaymentId ?? null);
    return { outcome: 'applied' };
  }

  /**
   * Marks an attempt paid and carries the submission with it. Money that really arrived is always recorded, even for an attempt that had
   * expired or a submission another attempt already paid: the second payment is flagged `duplicate_payment` for a manual refund.
   */
  private async applyPaid(
    tx: Tx,
    orgId: number,
    form: FormRow,
    attempt: PaymentRow,
    via: 'gateway' | 'manual',
    providerRef: string | null,
  ): Promise<void> {
    const sub = await this.repo.lockSubmission(tx, orgId, attempt.submissionId);
    if (!sub) return;
    await this.repo.markPaid(tx, orgId, attempt.id, via, providerRef);
    const duplicate = sub.alreadyPaid;
    await this.repo.setSubmissionStatus(tx, orgId, attempt.submissionId, 'paid', duplicate);
    await this.audit.record(tx, {
      module: PAYMENT_MODULE,
      recordId: attempt.id,
      action: 'update',
      delta: {
        status: { old: attempt.status, new: 'paid' },
        settledVia: { old: null, new: via },
      },
    });
    await this.audit.record(tx, {
      module: SUBMISSION_MODULE,
      recordId: attempt.submissionId,
      action: 'update',
      delta: { status: { old: sub.status, new: 'paid' } },
    });
    if (sub.contactId !== null) {
      await this.activities.insert(tx, orgId, {
        contactId: sub.contactId,
        activityType: 'form_payment',
        title: `Paid ${minorToMajor(attempt.amountMinor, attempt.currency)} ${attempt.currency} for ${form.name}`,
        body: `/forms/${form.uuid}/submissions/${sub.uuid}`,
        source: 'system',
        actorId: null,
      });
      await this.contacts.bumpLastActivity(tx, orgId, sub.contactId);
    }
    const contact =
      sub.contactId === null ? null : await this.contacts.findById(tx, orgId, sub.contactId);
    const people = await this.recipients(tx, orgId, form, contact?.ownerId ?? null);
    await this.outbox.emit(tx, {
      aggregateModule: EVENT_MODULE,
      aggregateId: attempt.submissionId,
      eventType: duplicate ? 'form.payment_duplicate' : 'form.payment_succeeded',
      orgId,
      payload: {
        formId: form.uuid,
        formName: form.name,
        submissionId: sub.uuid,
        paymentId: attempt.uuid,
        contactName: contact?.name ?? null,
        amountMinor: attempt.amountMinor.toString(),
        amount: minorToMajor(attempt.amountMinor, attempt.currency),
        currency: attempt.currency,
        via,
        ownerId: people.ownerUuid,
        notify: people.userUuids,
        notifyEmails: people.emails,
      },
    });
  }

  /** A verified notification that cannot be applied: kept on the audit trail and raised so a person can look at it. */
  private async rejected(
    tx: Tx,
    orgId: number,
    attempt: PaymentRow,
    reason: string,
    ctx: GatewayPaymentContext,
  ): Promise<void> {
    this.logger.warn(
      { payment: attempt.id, reason, gateway: ctx.gateway.slug },
      'form payment rejected',
    );
    await this.audit.record(tx, {
      module: PAYMENT_MODULE,
      recordId: attempt.id,
      action: 'update',
      delta: { rejected: { old: null, new: reason } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: EVENT_MODULE,
      aggregateId: attempt.submissionId,
      eventType: 'form.payment_rejected',
      orgId,
      payload: {
        reason,
        gateway: ctx.gateway.slug,
        amount: ctx.payment.amountMinor?.toString() ?? null,
        currency: ctx.payment.currency ?? null,
      },
    });
  }

  /** Who is told: the contact's owner when the form says so, the listed users who are still active, and the listed addresses (same rule as a submission). */
  private async recipients(
    tx: Tx,
    orgId: number,
    form: FormRow,
    ownerId: number | null,
  ): Promise<{ ownerUuid: string | null; userUuids: string[]; emails: string[] }> {
    const notify = form.notify as { owner?: boolean; userIds?: string[]; emails?: string[] };
    const ownerUuid = ownerId === null ? null : await this.forms.userUuid(tx, orgId, ownerId);
    const wanted = new Set<string>(notify.userIds ?? []);
    if (notify.owner !== false && ownerUuid) wanted.add(ownerUuid);
    const active = await this.forms.activeUsers(tx, orgId, [...wanted]);
    return { ownerUuid, userUuids: active.map((u) => u.uuid), emails: notify.emails ?? [] };
  }

  private async formOf(tx: Tx, orgId: number, submissionId: number) {
    const sub = await this.repo.lockSubmission(tx, orgId, submissionId);
    return sub ? this.forms.findById(tx, orgId, sub.formId) : null;
  }

  private stateError(reason: string): AppError {
    return new AppError(
      ERROR_CODES.FORMS_PAYMENT_STATE,
      `This submission has no open payment (${reason}).`,
      HttpStatus.CONFLICT,
    );
  }

  /** Runs an unrelated transaction body as the workspace's system actor (the worker's and the webhook's shape). */
  asSystem<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    return runAsSystemIn(orgId, fn);
  }
}
