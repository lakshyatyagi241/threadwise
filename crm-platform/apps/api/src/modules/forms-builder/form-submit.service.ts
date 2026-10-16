import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  canonicalizeLocalPhone,
  consentChannels,
  ERROR_CODES,
  formAgeField,
  formRateLimitsSchema,
  isPlausibleBirthDate,
  judgeAgeAnswer,
  type FormConsentChannel,
  type FormDefinition,
  type PublicFormSubmitInput,
  type PublicFormSubmitResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { ownersAvailable } from '../../common/leave-owner-pool';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CaptchaService, HtmlSanitizerService } from '../auth';
import {
  CompaniesService,
  ContactActivitiesRepository,
  ContactsRepository,
  ContactsService,
  TagsRepository,
  missingRequired,
  normaliseCompanyDomain,
} from '../crm';
import { coerceCustomValue, normaliseLeadEmail, pickOwner } from '../leads';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { createHash } from 'node:crypto';
import {
  ContactConsentService,
  ContactPrivacyService,
  MinorDetectionService,
} from '../contact-consent';
import { resolveConsent, type ConsentOutcome } from './form-consent';
import { computeAmount } from './form-payment-rules';
import { FormPaymentsService, type Payer } from './form-payments.service';
import type { PaymentRow } from './form-payments.repository';
import { runAsSystemIn } from './form-context';
import { notFound, type FormRoute } from './form-lookup.service';
import { hashIp, newReceiptToken } from './form-key';
import { FormsPlan } from './form-plan';
import {
  AGE_KEYS,
  ageAnswerOf,
  cleanGuardian,
  companyHostFromEmail,
  contactDisplayName,
  freeTexts,
  guardianOf,
  judgeFormAge,
  mapAnswers,
  validateSubmission,
  type MappedSubmission,
  type StoredAnswer,
} from './form-rules';
import { scoreSubmission } from './form-spam';
import { FormThrottle } from './form-throttle';
import { readDefinition } from './forms.mapper';
import { FormsRepository, type FormRow } from './forms.repository';
import {
  FormSubmissionsRepository,
  type ClaimInput,
  type SubmissionRow,
} from './form-submissions.repository';

const NO_PAYER: Payer = { name: null, email: null, phone: null };
const SUBMISSION_MODULE = 'web_form_submissions';
const CONTACTS = 'contacts';
const EVENT_MODULE = 'forms';
const MS_PER_DAY = 86_400_000;

/** What the sender's request carries that the pipeline needs: no body, no headers, nothing the sender can use to name a tenant. */
export interface PublicRequestMeta {
  ip?: string;
  userAgent?: string;
  /** The `Origin` header, when a browser sent one. */
  origin?: string;
  /** The browser sent the Global Privacy Control signal (`Sec-GPC: 1`). Recorded as a Do Not Sell or Share opt-out when the workspace has `ccpa_us` on. */
  gpc?: boolean;
}

/** What the sender's browser signalled beyond the answers. Today only the Global Privacy Control. */
interface Signals {
  gpc: boolean;
}
const NO_SIGNALS: Signals = { gpc: false };

type Outcome =
  | {
      kind: 'ok';
      status: 'created' | 'updated';
      contactId: number;
      contactUuid: string;
      companyId: number | null;
      created: boolean;
      /** A note for the staff screen (a required property was missing); the submission still counts. */
      warning?: string;
    }
  | { kind: 'review'; reason: 'no_contact_point' | 'invalid_phone' | 'plan_limit_reached' };

const REVIEW_TEXT = {
  no_contact_point: 'The submission has neither a usable email address nor a phone number.',
  invalid_phone: 'The phone number could not be read as one, and there is no email.',
  plan_limit_reached:
    "The workspace's plan has reached its contact limit. Upgrade the plan, then retry the submission.",
  submissions_cap:
    "The workspace's plan has reached its monthly form submission limit. Upgrade the plan, then retry the submission.",
} as const;

const clip = (v: string | undefined, max: number): string | null => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};
const httpUrl = (v: string | undefined, max: number): string | null => {
  const t = clip(v, max);
  return t && /^https?:\/\//i.test(t) ? t : null;
};

/**
 * The submission pipeline (docs/specs/forms-builder-app.md 9): the public door's `POST /v2/public/forms/:key/submit`, and the re-run of a
 * stored submission from the admin screen.
 *
 *   edge checks (address budget, key, plan, origin, form budgets, honeypot, CAPTCHA, validation, contact budget, spam score, cap)
 *     -> ONE transaction as the system actor of the workspace the key proved:
 *        claim (store the submission under its idempotency key) -> contact (identity-first dedupe, quota) -> blanks filled, never
 *        overwritten -> custom properties coerced to their types -> company found or made -> tags -> owner -> attribution -> consent ->
 *        timeline entry -> the submission's outcome -> audit and outbox
 *     -> after commit, by outbox consumers in the worker: in-app and email notifications.
 *
 * Same primitives and rules as the lead pipeline (`LeadIngestService`), a different entry point: a form writes contact, company and
 * submission together, which the lead pipeline structurally cannot. A submission that cannot become a contact is KEPT (`needs_review`),
 * never dropped; an unexpected error rolls the transaction back, is recorded `failed` in a transaction of its own, and the visitor's retry
 * with the same idempotency key takes it over. The visitor is told nothing about the CRM: not whether a contact existed, was created or
 * was updated, and not whether the submission was spam or needs review.
 */
@Injectable()
export class FormSubmitService {
  private readonly logger = new Logger(FormSubmitService.name);
  private readonly ipSecret: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly forms: FormsRepository,
    private readonly subs: FormSubmissionsRepository,
    private readonly throttle: FormThrottle,
    private readonly plan: FormsPlan,
    private readonly captcha: CaptchaService,
    private readonly sanitizer: HtmlSanitizerService,
    private readonly contacts: ContactsService,
    private readonly contactRepo: ContactsRepository,
    private readonly companies: CompaniesService,
    private readonly tags: TagsRepository,
    private readonly activities: ContactActivitiesRepository,
    private readonly entitlements: PlanEntitlementService,
    private readonly payments: FormPaymentsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly consentLedger: ContactConsentService,
    private readonly privacy: ContactPrivacyService,
    private readonly minors: MinorDetectionService,
    config: ConfigService<Env, true>,
  ) {
    this.ipSecret = `forms-ip:${config.get('JWT_ACCESS_SECRET', { infer: true })}`;
  }

  // --- the public door -------------------------------------------------------------------------------------------------------------

  /** `route` is what `FormLookupService.open` proved: the controller opens the door first so it can answer CORS even to a refused post. */
  async submit(
    route: FormRoute,
    body: PublicFormSubmitInput,
    meta: PublicRequestMeta,
  ): Promise<PublicFormSubmitResponse> {
    const orgId = route.orgId;

    const loaded = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      form: await this.forms.findById(tx, orgId, route.formId),
      version:
        route.publishedVersionId === null
          ? undefined
          : await this.forms.findVersionById(tx, orgId, route.publishedVersionId),
    }));
    const { form, version } = loaded;
    if (!form || form.status !== 'published' || !version) throw notFound();
    const def = readDefinition(version.definition);
    const limits = formRateLimitsSchema.parse(form.rateLimits);

    await this.throttle.checkSubmit(form.id, meta.ip, limits);

    // The honeypot first, before anything costs money: a bot that filled it is answered with a success and nothing is stored.
    if (form.honeypot && (body.hp ?? '').trim() !== '') {
      await this.countBlocked(orgId);
      return this.responseFor(def, newReceiptToken());
    }
    if (form.captchaMode !== 'off') await this.captcha.assert(body.captchaToken, 'form');

    const now = new Date();
    const validated = validateSubmission(def, body.answers, body.hidden, now);
    const consent = resolveConsent(def, body.consent, now);
    const issues = [
      ...validated.issues,
      ...(consent.missing ? [{ fieldId: 'consent', code: 'required' }] : []),
    ];
    // A form that takes payment: the SERVER works out the amount from this frozen version and the validated answers (a number the
    // browser sent is never read), and needs a gateway that can make a link now: otherwise the form is closed, never free.
    let gatewaySlug = '';
    if (def.payment.enabled) {
      if (validated.issues.length === 0) {
        const amount = computeAmount(def, validated.values);
        if (!amount.ok) {
          issues.push({ fieldId: def.payment.fieldId ?? 'payment', code: 'invalid_amount' });
        }
      }
      if (issues.length === 0) gatewaySlug = await this.payments.assertGateway(orgId);
    }
    if (issues.length > 0) {
      throw new AppError(
        ERROR_CODES.FORMS_VALIDATION,
        'Please check the form and try again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        issues.map((i) => ({ path: i.fieldId, message: i.code })),
      );
    }

    // The age gate (BL-211): judged on the validated answers, BEFORE anything is stored. A refused visitor leaves no trace at all.
    const ageExtras = await this.judgeAge(orgId, def, validated.values, body, now);
    const stored: Record<string, StoredAnswer> = { ...validated.values, ...ageExtras };

    const mapped = mapAnswers(def, validated.values);
    const contactKey =
      mapped.contact.builtin.email?.toLowerCase() ?? mapped.contact.builtin.phone ?? null;
    await this.throttle.checkContact(form.id, contactKey, limits);

    const verdict = scoreSubmission({
      texts: freeTexts(def, validated.values),
      honeypotEnabled: false,
      elapsedMs: body.elapsedMs,
    });
    const used = await this.acceptedThisMonth(orgId, now);
    const cap = await this.plan.submissionsCap(orgId);
    const capReached = !verdict.spam && cap > 0 && used >= cap;

    const claim: ClaimInput = {
      formId: form.id,
      versionId: version.id,
      idempotencyKey: body.idempotencyKey,
      receiptToken: newReceiptToken(),
      status: verdict.spam ? 'spam' : 'received',
      reason: verdict.spam ? 'spam_score' : null,
      answers: stored,
      utm: Object.fromEntries(
        (['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const).flatMap(
          (k) => {
            const v = clip(body.hidden[k], 255);
            return v ? [[k, v]] : [];
          },
        ),
      ),
      referrer: httpUrl(body.hidden.referrer, 500),
      pageUrl: httpUrl(body.hidden.page_url, 500),
      ipHash: hashIp(meta.ip, this.ipSecret, now),
      userAgent: clip(meta.userAgent, 255),
      consent: consent.stored,
      spamScore: verdict.score,
      answersExpiresAt:
        form.retentionDays === null
          ? null
          : new Date(now.getTime() + form.retentionDays * MS_PER_DAY),
    };

    try {
      const done = await runAsSystemIn(orgId, () =>
        this.db.txAs({ orgId, userId: null }, async (tx) => {
          const c = await this.subs.claim(tx, orgId, claim);
          if (c.kind === 'repeat') {
            // The same page load again: a payment still open gets its link back (re-made when it lapsed).
            const open = (await this.payments.attemptsFor(tx, orgId, [c.row.id])).get(
              c.row.id,
            )?.[0];
            return {
              res: this.responseFor(def, c.row.receiptToken),
              pay:
                c.row.status === 'awaiting_payment' && open?.status === 'pending'
                  ? { payment: open, payer: NO_PAYER }
                  : null,
              receipt: c.row.receiptToken,
            };
          }
          if (c.kind === 'claimed') {
            await this.audit.record(tx, {
              module: SUBMISSION_MODULE,
              recordId: c.row.id,
              action: 'insert',
            });
          }
          const plain = {
            res: this.responseFor(def, c.row.receiptToken),
            pay: null,
            receipt: c.row.receiptToken,
          };
          if (claim.status === 'spam') return plain;
          if (capReached) {
            await this.review(tx, orgId, form, c.row, 'submissions_cap');
            return plain;
          }
          const opened = await this.processInTx(
            tx,
            orgId,
            form,
            def,
            c.row,
            stored,
            consent,
            gatewaySlug,
            { gpc: meta.gpc === true },
          );
          return { ...plain, pay: opened };
        }),
      );
      if (!done.pay) return done.res;
      // After commit: the hosted link is network I/O, never inside the transaction.
      const url =
        done.pay.payment.linkUrl && done.pay.payment.expiresAt.getTime() > Date.now()
          ? done.pay.payment.linkUrl
          : await this.payments.mintLink(
              orgId,
              done.pay.payment.uuid,
              form.publicKey,
              done.receipt,
              done.pay.payer,
              form.name,
            );
      return url
        ? {
            submissionToken: done.receipt,
            next: { type: 'pay', url },
          }
        : done.res;
    } catch (err) {
      await this.recordFailure(orgId, form, claim, err);
      throw new AppError(
        ERROR_CODES.INTERNAL,
        'We could not save your response. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // --- the admin's re-run ------------------------------------------------------------------------------------------------------------

  /**
   * Re-runs a stored submission under the form's CURRENT mapping (the live version, else the version it was made against): the answers
   * are the ones the visitor sent, keyed by field id, so a fixed mapping or a freed plan limit lets it through now. Runs in the caller's
   * transaction and request context, so the audit rows name the person who retried.
   */
  async reprocess(
    tx: Tx,
    orgId: number,
    form: FormRow,
    sub: SubmissionRow,
  ): Promise<SubmissionRow> {
    const versionId = form.publishedVersionId ?? sub.versionId;
    const version = await this.forms.findVersionById(tx, orgId, versionId);
    if (!version) throw notFound();
    const def = readDefinition(version.definition);
    // The channels are the ones of the wording the visitor saw (the submission's own version), not of a later republish.
    const seen =
      sub.versionId === versionId
        ? version
        : ((await this.forms.findVersionById(tx, orgId, sub.versionId)) ?? version);
    const seenChannels = consentChannels(readDefinition(seen.definition).consent);
    await this.subs.markRetry(tx, orgId, sub.id);
    const consent: ConsentOutcome = sub.consent
      ? {
          stored: { ...sub.consent, shownVersion: null },
          missing: false,
          marketingOptIn: sub.consent.given && def.consent.marketing,
          serviceAgreed: sub.consent.given && !def.consent.marketing,
          channels: seenChannels,
        }
      : {
          stored: null,
          missing: false,
          marketingOptIn: false,
          serviceAgreed: false,
          channels: [],
        };
    // A staff re-run of a form that takes payment opens its attempt as well (staff then get the link from the submission screen).
    const gatewaySlug = def.payment.enabled ? await this.payments.assertGateway(orgId) : '';
    await this.processInTx(
      tx,
      orgId,
      form,
      def,
      sub,
      sub.answers as Record<string, StoredAnswer>,
      consent,
      gatewaySlug,
    );
    return (await this.subs.findById(tx, orgId, sub.id))!;
  }

  // --- the transaction that decides the outcome ---------------------------------------------------------------------------------------

  private async processInTx(
    tx: Tx,
    orgId: number,
    form: FormRow,
    def: FormDefinition,
    sub: SubmissionRow,
    values: Record<string, StoredAnswer>,
    consent: ConsentOutcome,
    gatewaySlug: string,
    signals: Signals = NO_SIGNALS,
  ): Promise<{ payment: PaymentRow; payer: Payer } | null> {
    const mapped = mapAnswers(def, values);
    const outcome = await this.writeCrm(
      tx,
      orgId,
      form,
      def,
      sub,
      mapped,
      values,
      consent,
      signals,
    );
    if (outcome.kind === 'review') {
      await this.review(tx, orgId, form, sub, outcome.reason);
      return null;
    }
    const contact = (await this.contactRepo.findById(tx, orgId, outcome.contactId))!;
    const recipients = await this.recipients(tx, orgId, form, contact.ownerId);
    await this.subs.finish(tx, orgId, sub.id, {
      status: outcome.status,
      reason: null,
      error: outcome.warning ?? null,
      contactId: outcome.contactId,
      companyId: outcome.companyId,
    });
    await this.audit.record(tx, {
      module: SUBMISSION_MODULE,
      recordId: sub.id,
      action: 'update',
      delta: { status: { old: sub.status, new: outcome.status } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: EVENT_MODULE,
      aggregateId: sub.id,
      eventType: 'form.submitted',
      orgId,
      payload: {
        formId: form.uuid,
        formName: form.name,
        submissionId: sub.uuid,
        contactId: outcome.contactUuid,
        contactName: contact.name,
        created: outcome.created,
        status: outcome.status,
        ownerId: recipients.ownerUuid,
        notify: recipients.userUuids,
        notifyEmails: recipients.emails,
      },
    });
    const payment = await this.payments.openAttemptIn(
      tx,
      orgId,
      form,
      def,
      sub,
      values,
      gatewaySlug,
    );
    return payment
      ? {
          payment,
          payer: {
            name: contactDisplayName(mapped.contact).name,
            email: mapped.contact.builtin.email ?? null,
            phone: mapped.contact.builtin.phone ?? null,
          },
        }
      : null;
  }

  /** Stores the submission as `needs_review`: kept with its answers, shown in "Needs attention", retried after a fix. */
  private async review(
    tx: Tx,
    orgId: number,
    form: FormRow,
    sub: SubmissionRow,
    reason: keyof typeof REVIEW_TEXT,
  ): Promise<void> {
    await this.subs.finish(tx, orgId, sub.id, {
      status: 'needs_review',
      reason,
      error: REVIEW_TEXT[reason],
    });
    await this.audit.record(tx, {
      module: SUBMISSION_MODULE,
      recordId: sub.id,
      action: 'update',
      delta: {
        status: { old: sub.status, new: 'needs_review' },
        reason: { old: null, new: reason },
      },
    });
    await this.outbox.emit(tx, {
      aggregateModule: EVENT_MODULE,
      aggregateId: sub.id,
      eventType: 'form.needs_review',
      orgId,
      payload: {
        formId: form.uuid,
        formName: form.name,
        submissionId: sub.uuid,
        reason,
        ownerId: null,
        notify: (await this.recipients(tx, orgId, form, null)).userUuids,
      },
    });
  }

  /** An unexpected error: the outcome transaction already rolled back, so the failure is recorded in a transaction of its own. */
  private async recordFailure(
    orgId: number,
    form: FormRow,
    claim: ClaimInput,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof AppError ? err.code : 'INTERNAL';
    this.logger.error({ err, orgId, form: form.uuid }, 'form submission failed');
    try {
      await runAsSystemIn(orgId, () =>
        this.db.txAs({ orgId, userId: null }, async (tx) => {
          await this.subs.recordFailure(tx, orgId, { ...claim, error: `${code}: ${message}` });
          await this.outbox.emit(tx, {
            aggregateModule: EVENT_MODULE,
            aggregateId: form.id,
            eventType: 'form.submission_failed',
            orgId,
            payload: { formId: form.uuid, formName: form.name, reason: 'internal_error' },
          });
        }),
      );
    } catch (inner) {
      this.logger.error(
        { err: inner, orgId, form: form.uuid },
        'could not record a failed form submission',
      );
    }
  }

  // --- the age gate (BL-211, spec 11.10) -------------------------------------------------------------------------------------------

  /**
   * Judges the visitor's age answer against the form's gate. Returns the answers the server adds beside theirs (the outcome and, for
   * `guardian`, the guardian's details). Refuses with a neutral message when the gate says `block` (nothing is stored), and asks for a
   * guardian when it says `guardian`. A gate that is off, and an adult, add nothing but the declaration's evidence.
   */
  private async judgeAge(
    orgId: number,
    def: FormDefinition,
    values: Record<string, StoredAnswer>,
    body: PublicFormSubmitInput,
    now: Date,
  ): Promise<Record<string, StoredAnswer>> {
    const gate = def.ageGate;
    if (!gate.enabled) return {};
    const workspaceAge =
      gate.minAge ??
      (await this.db.txAs({ orgId, userId: null }, (tx) => this.privacy.minorAge(tx, orgId)));
    const confirmed = body.ageConfirmed === true;
    const judged = judgeFormAge(def, values, confirmed, workspaceAge, now);
    if (!judged) return {};
    const extras: Record<string, StoredAnswer> = {};
    if (gate.mode === 'declaration' && confirmed) extras[AGE_KEYS.confirmed] = true;
    if (judged.verdict.kind === 'invalid') {
      // The question was left out or cannot be read: the same "required" a blank field gets.
      throw new AppError(
        ERROR_CODES.FORMS_VALIDATION,
        'Please check the form and try again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: formAgeField(def)?.id ?? 'age', message: 'required' }],
      );
    }
    if (judged.verdict.kind === 'adult') return extras;
    // Nobody has stated an age yet: an unticked declaration box is an unanswered required question, not a refusal (ticking it passes).
    if (gate.mode === 'declaration' && gate.whenUnder === 'block') {
      throw new AppError(
        ERROR_CODES.FORMS_VALIDATION,
        'Please check the form and try again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'age_confirmed', message: 'required' }],
      );
    }
    if (gate.whenUnder === 'block') {
      throw new AppError(
        ERROR_CODES.FORMS_AGE_BLOCKED,
        'We are not able to accept this submission.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (gate.whenUnder === 'guardian') {
      const guardian = cleanGuardian(body.guardian, def.settings.phoneCountryCode);
      if (!guardian) {
        throw new AppError(
          ERROR_CODES.FORMS_GUARDIAN_REQUIRED,
          'Please add the name and the email or phone of a parent or guardian.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      extras[AGE_KEYS.guardianName] = guardian.name;
      if (guardian.email) extras[AGE_KEYS.guardianEmail] = guardian.email;
      if (guardian.phone) extras[AGE_KEYS.guardianPhone] = guardian.phone;
    }
    extras[AGE_KEYS.outcome] = 'under';
    extras[AGE_KEYS.minAge] = judged.minAge;
    return extras;
  }

  /**
   * The gate let an under-age visitor through (`flag` or `guardian`): flag the contact as a minor from the answer (the same verdict the
   * gate gave, recomputed from the stored answers so a staff re-run agrees), and note the guardian on the timeline. Best effort in a
   * savepoint: the visitor's submission is never lost over the flag.
   */
  private async recordUnderAge(
    tx: Tx,
    orgId: number,
    form: FormRow,
    def: FormDefinition,
    sub: SubmissionRow,
    contactId: number,
    values: Record<string, StoredAnswer>,
  ): Promise<void> {
    try {
      await tx.transaction(async (sp) => {
        const minAge = Number(values[AGE_KEYS.minAge]);
        const answer = ageAnswerOf(def, values, values[AGE_KEYS.confirmed] === true);
        if (!answer || !Number.isInteger(minAge)) return;
        const verdict = judgeAgeAnswer(answer, minAge, sub.createdAt);
        if (verdict.kind !== 'under') return;
        const guardian = guardianOf(values);
        await this.minors.flagFromAnswer(sp as Tx, orgId, contactId, {
          source: verdict.mode === 'declaration' ? 'declaration' : 'dob',
          minorUntil: verdict.minorUntil,
          evidence: { formId: form.uuid, submissionId: sub.uuid },
          note: guardian
            ? 'A parent or guardian was named on the form. Their consent is not recorded until a person records it.'
            : null,
          now: sub.createdAt,
        });
        if (guardian) {
          await this.activities.insert(sp as Tx, orgId, {
            contactId,
            activityType: 'guardian_details',
            title: `Parent or guardian named on ${form.name}`,
            body: [guardian.name, guardian.email, guardian.phone].filter(Boolean).join(' - '),
            source: 'system',
            actorId: null,
          });
        }
      });
    } catch (err) {
      this.logger.warn({ err: String(err), form: form.uuid }, 'could not flag the minor');
    }
  }

  // --- contact, company, tags, owner -------------------------------------------------------------------------------------------------

  private async writeCrm(
    tx: Tx,
    orgId: number,
    form: FormRow,
    def: FormDefinition,
    sub: SubmissionRow,
    mapped: MappedSubmission,
    values: Record<string, StoredAnswer>,
    consent: ConsentOutcome,
    signals: Signals,
  ): Promise<Outcome> {
    const name = contactDisplayName(mapped.contact);
    const email = normaliseLeadEmail(mapped.contact.builtin.email ?? null);
    const phoneRaw = mapped.contact.builtin.phone ?? null;
    const phone = canonicalizeLocalPhone(phoneRaw, def.settings.phoneCountryCode);
    if (!phone && !email)
      return { kind: 'review', reason: phoneRaw ? 'invalid_phone' : 'no_contact_point' };

    const stage = def.after.lifecycleStage;
    const found = await this.resolveContact(tx, orgId, {
      phone: phone?.e164 ?? null,
      email,
      name: name.name,
      label: `Form: ${form.name}`.slice(0, 120),
      stage: stage && (await this.forms.stageUsable(tx, orgId, stage)) ? stage : undefined,
      origin: { formId: form.uuid, submissionId: sub.uuid },
    });
    if (found.kind === 'review') return found;

    const row = (await this.contactRepo.findById(tx, orgId, found.contactId))!;
    // A contact that already has an owner keeps them (and costs the rotation no turn); only an unowned one is assigned.
    const owner = row.ownerId === null ? await this.chooseOwner(tx, orgId, form) : null;
    const contactTypes = await this.forms.propertyTypes(
      tx,
      orgId,
      'contacts',
      Object.keys(mapped.contact.custom),
    );
    const extras = await this.forms.contactExtras(tx, orgId, row.id);
    const filled = await this.fillContact(tx, orgId, row, {
      mapped,
      name,
      email,
      phone: phone?.e164 ?? null,
      label: `Form: ${form.name}`.slice(0, 120),
      owner: owner?.id ?? null,
      customTypes: contactTypes,
      extras,
      created: found.created,
      now: sub.createdAt,
    });
    // A date of birth the submission wrote brings the minor flag in line with it (BL-211); a form's own stricter reading follows below.
    if (filled.dobChanged) {
      await this.minors.evaluateInTx(tx, orgId, found.contactId, sub.createdAt, {
        dobChanged: true,
      });
    }
    // An under-age visitor the gate let through (`flag` or `guardian`): the contact is flagged, the guardian's details are kept on the
    // timeline, and the marketing agreement of THIS submission is not recorded.
    const under = values[AGE_KEYS.outcome] === 'under';
    if (under) await this.recordUnderAge(tx, orgId, form, def, sub, found.contactId, values);

    await this.applyTags(tx, orgId, found.contactId, def.after.tags);
    const companyId = await this.linkCompany(
      tx,
      orgId,
      def,
      mapped,
      email,
      row.id,
      row.companyId,
      row.ownerId ?? owner?.id ?? null,
    );
    await this.forms.insertAttribution(tx, orgId, {
      contactId: found.contactId,
      label: 'Form',
      campaign: sub.utm.utm_campaign ?? null,
      form: form.name.slice(0, 255),
      capturedAt: sub.createdAt,
    });
    if (consent.marketingOptIn && !under) {
      await this.subscribe(
        tx,
        orgId,
        form,
        sub,
        found.contactId,
        found.uuid,
        email,
        phone?.e164 ?? null,
        consent.channels,
      );
    } else if (consent.serviceAgreed) {
      await this.recordServiceAgreement(
        tx,
        orgId,
        form,
        sub,
        found.contactId,
        email,
        phone?.e164 ?? null,
        consent.channels,
      );
    }

    if (signals.gpc) await this.recordGpc(tx, orgId, form, sub, found.contactId);

    await this.activities.insert(tx, orgId, {
      contactId: found.contactId,
      activityType: 'form_submission',
      title: `Submitted ${form.name}`,
      body: `/forms/${form.uuid}/submissions/${sub.uuid}`,
      source: 'system',
      actorId: null,
    });
    await this.contactRepo.bumpLastActivity(tx, orgId, found.contactId);

    const finalRow = (await this.contactRepo.findById(tx, orgId, found.contactId))!;
    const missing = missingRequired(
      await this.contactRepo.requiredRules(tx, orgId),
      finalRow.data ?? {},
    );
    return {
      kind: 'ok',
      status: found.created ? 'created' : 'updated',
      contactId: found.contactId,
      contactUuid: found.uuid,
      companyId,
      created: found.created,
      warning:
        found.created && missing.length > 0
          ? `Required properties are missing on the new contact: ${missing.map((m) => m.label).join(', ')}.`.slice(
              0,
              500,
            )
          : undefined,
    };
  }

  /**
   * The browser sent the Global Privacy Control signal with this submission: record the contact's Do Not Sell or Share opt-out, but
   * only when the workspace has the `ccpa_us` profile on (the service checks). Best effort in a savepoint: a failure here never loses
   * the visitor's submission. It writes no marketing grant and changes nothing about the consent line.
   */
  private async recordGpc(
    tx: Tx,
    orgId: number,
    form: FormRow,
    sub: SubmissionRow,
    contactId: number,
  ): Promise<void> {
    try {
      await tx.transaction(async (sp) => {
        await this.privacy.recordGpc(sp as Tx, orgId, contactId, {
          keyBase: `form:${sub.uuid}`,
          evidence: { formId: form.uuid, submissionId: sub.uuid },
        });
      });
    } catch (err) {
      this.logger.warn({ err: String(err), form: form.uuid }, 'could not record the GPC opt-out');
    }
  }

  /**
   * Identity-first dedupe, in the order `ContactsService.create` uses (email, then phone), then the stored normalised values (a contact
   * that predates identities), then `resolveOrCreateByIdentity` for a number or an address nobody holds: it serialises two submissions
   * with the same number and enforces the plan's contact cap.
   */
  private async resolveContact(
    tx: Tx,
    orgId: number,
    q: {
      phone: string | null;
      email: string | null;
      name: string | null;
      label: string;
      stage: string | undefined;
      origin: { formId: string; submissionId: string };
    },
  ): Promise<
    | { kind: 'ok'; contactId: number; uuid: string; created: boolean }
    | { kind: 'review'; reason: 'plan_limit_reached' | 'invalid_phone' | 'no_contact_point' }
  > {
    const viaEmail = q.email
      ? await this.contactRepo.findByIdentity(tx, orgId, 'email', q.email)
      : undefined;
    const viaPhone = q.phone
      ? await this.contactRepo.findByIdentity(tx, orgId, 'phone', q.phone)
      : undefined;
    let id = viaEmail ?? viaPhone;
    if (id === undefined && q.email) {
      const legacy = await tx.execute(
        sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND normalized_email = ${q.email} ORDER BY id LIMIT 1`,
      );
      const hit = legacy.rows[0] as { id: number | string } | undefined;
      if (hit) id = Number(hit.id);
    }
    if (id !== undefined) {
      const res = await tx.execute(
        sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
      );
      const uuid = (res.rows[0] as { uuid: string } | undefined)?.uuid;
      if (uuid) return { kind: 'ok', contactId: id, uuid, created: false };
    }
    const resolved = await this.contacts.resolveOrCreateByIdentity(tx, orgId, {
      kind: q.phone ? 'phone' : 'email',
      value: q.phone ?? q.email!,
      name: q.name,
      source: q.label,
      lifecycleStage: q.stage,
      eventPayload: {
        ...(q.email ? { email: q.email } : {}),
        origin: 'form',
        formId: q.origin.formId,
        submissionId: q.origin.submissionId,
      },
    });
    switch (resolved.outcome) {
      case 'created':
      case 'found':
        return {
          kind: 'ok',
          contactId: resolved.contactId,
          uuid: resolved.uuid,
          created: resolved.outcome === 'created',
        };
      case 'quota_reached':
        return { kind: 'review', reason: 'plan_limit_reached' };
      case 'unusable':
        return { kind: 'review', reason: q.phone ? 'invalid_phone' : 'no_contact_point' };
    }
  }

  /**
   * What a submission adds to its contact. A contact the submission just created takes every value; one that already existed keeps
   * everything a person may have curated (a name, an email, a custom value, an owner) and only has its blanks filled, so a form that
   * arrives with less than the CRM already knows never makes the contact worse. A phone or an address that belongs to ANOTHER contact is
   * not stolen: the identity is only added when nobody else holds it.
   */
  private async fillContact(
    tx: Tx,
    orgId: number,
    row: NonNullable<Awaited<ReturnType<ContactsRepository['findById']>>>,
    v: {
      mapped: MappedSubmission;
      name: { name: string | null; first: string | null; last: string | null };
      email: string | null;
      phone: string | null;
      label: string;
      owner: number | null;
      customTypes: Map<string, string>;
      extras: {
        title: string | null;
        address: string | null;
        message: string | null;
        middleName: string | null;
      };
      created: boolean;
      now: Date;
    },
  ): Promise<{ dobChanged: boolean }> {
    const patch: Record<string, unknown> = {};
    const blank = (x: string | null | undefined): boolean =>
      x === null || x === undefined || x.trim() === '';
    const b = v.mapped.contact.builtin;

    if (blank(row.name) && v.name.name) patch.name = v.name.name;
    if (blank(row.firstName) && v.name.first) patch.firstName = v.name.first;
    if (blank(row.lastName) && v.name.last) patch.lastName = v.name.last;
    if (blank(v.extras.middleName) && b.middle_name) patch.middleName = b.middle_name.slice(0, 191);
    if (blank(row.source)) patch.source = v.label;
    if (v.owner !== null && row.ownerId === null) patch.ownerId = v.owner;
    if (blank(v.extras.title) && b.title) patch.title = b.title.slice(0, 191);
    if (blank(v.extras.address) && b.address) patch.address = b.address.slice(0, 500);
    if (blank(v.extras.message) && b.message) patch.message = b.message.slice(0, 5000);
    // The younger date of birth wins (BL-211): a blank is filled; a different date is kept only if it is later, so a form can make a
    // contact a minor but never an adult again. A date that cannot be a birth date is ignored.
    const dob = b.date_of_birth;
    if (dob && isPlausibleBirthDate(dob, v.now) && (!row.dateOfBirth || dob > row.dateOfBirth)) {
      patch.dateOfBirth = dob;
    }

    if (v.email) {
      const holder = await this.contactRepo.findByIdentity(tx, orgId, 'email', v.email);
      if (holder === undefined || holder === row.id) {
        await this.contactRepo.addIdentity(tx, orgId, row.id, 'email', v.email);
        if (blank(row.email)) patch.email = v.email;
      }
    }
    if (v.phone) {
      const holder = await this.contactRepo.findByIdentity(tx, orgId, 'phone', v.phone);
      if (holder === undefined || holder === row.id) {
        await this.contactRepo.addIdentity(tx, orgId, row.id, 'phone', v.phone);
        if (blank(row.phone)) patch.phone = v.phone;
      }
    }

    const custom: Record<string, unknown> = {};
    for (const [key, text] of Object.entries(v.mapped.contact.custom)) {
      const type = v.customTypes.get(key);
      if (!type) continue;
      const value = coerceCustomValue(type, text);
      if (value === undefined) continue;
      const have = row.data?.[key];
      if (have === undefined || have === null || have === '') custom[key] = value;
    }
    if (Object.keys(custom).length > 0) patch.data = { ...(row.data ?? {}), ...custom };

    if (Object.keys(patch).length === 0) return { dobChanged: false };
    await this.contactRepo.updateFieldsById(tx, orgId, row.id, { ...patch, updatedBy: null });
    if (!v.created) {
      await this.audit.record(tx, {
        module: CONTACTS,
        recordId: row.id,
        action: 'update',
        delta: Object.fromEntries(
          Object.keys(patch)
            .filter((k) => k !== 'data')
            .map((k) => [
              k,
              { old: (row as unknown as Record<string, unknown>)[k] ?? null, new: patch[k] },
            ]),
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: CONTACTS,
        aggregateId: row.id,
        eventType: 'contact.updated',
        orgId,
        payload: { uuid: row.uuid, via: 'form' },
      });
    }
    return { dobChanged: patch.dateOfBirth !== undefined };
  }

  private async applyTags(
    tx: Tx,
    orgId: number,
    contactId: number,
    names: readonly string[],
  ): Promise<void> {
    for (const name of names) {
      let tag = await this.tags.findByName(tx, orgId, name);
      if (!tag) {
        // A submission is not refused over a label: past the plan's tag cap the tag is simply not made.
        const cap = await this.entitlements.limit(orgId, 'tags');
        if (cap > 0 && (await this.tags.countAll(tx, orgId)) >= cap) continue;
        await this.tags.insertIfAbsent(tx, orgId, { name, color: '#2563EB' });
        tag = await this.tags.findByName(tx, orgId, name);
      }
      if (tag) await this.tags.attach(tx, orgId, [contactId], [tag.id], null);
    }
  }

  /**
   * The company of the submission (spec 9.3): found by website, else by exact name, filled and linked; made when there is none. Skipped
   * when the form does not use companies (`match: none`), when the submission names no company, and for a contact that already belongs
   * to a company (a contact is never moved by a form).
   */
  private async linkCompany(
    tx: Tx,
    orgId: number,
    def: FormDefinition,
    mapped: MappedSubmission,
    email: string | null,
    contactId: number,
    currentCompanyId: number | null,
    ownerId: number | null,
  ): Promise<number | null> {
    const mode = def.mapping.company.match;
    if (mode === 'none' || currentCompanyId !== null) return currentCompanyId;
    const c = mapped.company;
    const host =
      normaliseCompanyDomain(c.builtin.domain) ??
      (mode === 'email_domain' ? companyHostFromEmail(email) : null);
    const name = c.builtin.name?.trim() || null;
    if (!host && !name) return null;
    const types = await this.forms.propertyTypes(tx, orgId, 'companies', Object.keys(c.custom));
    const custom: Record<string, unknown> = {};
    for (const [key, text] of Object.entries(c.custom)) {
      const type = types.get(key);
      const value = type ? coerceCustomValue(type, text) : undefined;
      if (value !== undefined) custom[key] = value;
    }
    const company = await this.companies.resolveForSubmission(tx, orgId, {
      name,
      host,
      email: clip(c.builtin.email, 191),
      phone: clip(c.builtin.phone, 32),
      industry: clip(c.builtin.industry, 100),
      sizeRange: clip(c.builtin.size_range, 40),
      address: clip(c.builtin.address, 500),
      notes: clip(c.builtin.notes, 2000),
      custom,
      ownerId,
      match: true,
    });
    if (!company) return null;
    await this.contactRepo.updateFieldsById(tx, orgId, contactId, {
      companyId: company.id,
      updatedBy: null,
    });
    return company.id;
  }

  /** The user a submission goes to under the form's rule, or null. Round robin consumes a turn only when a user can take it. */
  private async chooseOwner(
    tx: Tx,
    orgId: number,
    form: FormRow,
  ): Promise<{ id: number; uuid: string } | null> {
    const rule = form.ownerRule as {
      mode?: 'unassigned' | 'fixed' | 'round_robin';
      userIds?: string[];
    };
    const mode = rule.mode ?? 'unassigned';
    // People on leave today are never picked (BL-112): a fixed person is replaced by their delegate, a rotation skips them.
    const active = await ownersAvailable(
      tx,
      orgId,
      mode === 'unassigned' ? [] : await this.forms.activeUsers(tx, orgId, rule.userIds ?? []),
      mode,
    );
    if (mode !== 'round_robin' || active.length === 0) return pickOwner({ mode }, active, 0).pick;
    return pickOwner({ mode }, active, await this.forms.takeTurn(tx, orgId, form.id)).pick;
  }

  /** Who is told about a submission: the contact's owner (when the form says so), the extra users, and the extra email addresses. */
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

  /**
   * A ticked marketing box subscribes the contact (spec 9.5, decision D10): the channel's status becomes `subscribed` where it has none,
   * and `contact.opt_in` is announced once, only on a real change. A contact that unsubscribed stays unsubscribed, and an unticked box
   * never changes anything.
   */
  private async subscribe(
    tx: Tx,
    orgId: number,
    form: FormRow,
    sub: SubmissionRow,
    contactId: number,
    contactUuid: string,
    email: string | null,
    phone: string | null,
    channels: readonly FormConsentChannel[],
  ): Promise<void> {
    const row = (await this.contactRepo.findById(tx, orgId, contactId))!;
    if (row.isUnsubscribed) return;
    // The consent ledger keeps the proof: the exact line the visitor ticked (text cut to 300 characters plus the hash of the whole
    // text and its version), the form and the submission. Never the visitor's IP. A form cannot override a STOP (respectWithdrawn).
    const given = sub.consent;
    for (const channel of [
      ...(phone && channels.includes('whatsapp') ? (['whatsapp'] as const) : []),
      ...(phone && channels.includes('sms') ? (['sms'] as const) : []),
      ...(email && channels.includes('email') ? (['email'] as const) : []),
    ]) {
      await this.consentLedger.recordInTx(tx, orgId, {
        contactId,
        channel,
        action: 'granted',
        source: 'form',
        evidence: {
          consentText: given?.text.slice(0, 300),
          consentVersion: given ? String(given.version) : undefined,
          consentHash: given ? createHash('sha256').update(given.text).digest('hex') : undefined,
          formId: form.uuid,
          submissionId: sub.uuid,
        },
        occurredAt: given ? new Date(given.at) : undefined,
        idempotencyKey: `form:${sub.uuid}:${channel}`,
        respectWithdrawn: true,
      });
    }
    const patch: Record<string, unknown> = {};
    if (email && channels.includes('email') && !row.emailSubscriptionStatus)
      patch.emailSubscriptionStatus = 'subscribed';
    if (phone && channels.includes('whatsapp') && !row.whatsappSubscriptionStatus)
      patch.whatsappSubscriptionStatus = 'subscribed';
    if (phone && channels.includes('sms') && !row.smsSubscriptionStatus)
      patch.smsSubscriptionStatus = 'subscribed';
    if (Object.keys(patch).length === 0) return;
    await this.contactRepo.updateFieldsById(tx, orgId, contactId, { ...patch, updatedBy: null });
    await this.audit.record(tx, {
      module: CONTACTS,
      recordId: contactId,
      action: 'update',
      delta: Object.fromEntries(
        Object.keys(patch).map((k) => [k, { old: null, new: 'subscribed' }]),
      ),
    });
    await this.outbox.emit(tx, {
      aggregateModule: CONTACTS,
      aggregateId: contactId,
      eventType: 'contact.opt_in',
      orgId,
      payload: {
        contactId: contactUuid,
        optedIn: true,
        action: 'subscribed',
        source: 'form',
        formId: form.uuid,
        submissionId: sub.uuid,
      },
    });
  }

  /**
   * A ticked consent line that is NOT marketing (BL-171, privacy spec 4.3.2): the person agreed to be contacted about their request.
   * The ledger keeps that as evidence, with the exact line they ticked (text cut to 300 characters, the hash of the whole text, the
   * version), the form and the submission, but only for SERVICE messages (purpose `utility`): it is never a marketing grant, changes no
   * subscription label and announces no opt-in. WhatsApp and email follow what the form collected; SMS only when the form declares that its
   * wording covers SMS. A person who stopped service messages on a channel is not turned back on (`respectWithdrawn`).
   */
  private async recordServiceAgreement(
    tx: Tx,
    orgId: number,
    form: FormRow,
    sub: SubmissionRow,
    contactId: number,
    email: string | null,
    phone: string | null,
    channels: readonly FormConsentChannel[],
  ): Promise<void> {
    const given = sub.consent;
    if (!given) return;
    for (const channel of [
      ...(phone && channels.includes('whatsapp') ? (['whatsapp'] as const) : []),
      ...(phone && channels.includes('sms') ? (['sms'] as const) : []),
      ...(email && channels.includes('email') ? (['email'] as const) : []),
    ]) {
      await this.consentLedger.recordInTx(tx, orgId, {
        contactId,
        channel,
        purpose: 'utility',
        action: 'granted',
        source: 'form',
        evidence: {
          consentText: given.text.slice(0, 300),
          consentVersion: String(given.version),
          consentHash: createHash('sha256').update(given.text).digest('hex'),
          formId: form.uuid,
          submissionId: sub.uuid,
        },
        note: 'Agreed to be contacted about their request (not marketing)',
        occurredAt: new Date(given.at),
        idempotencyKey: `form:${sub.uuid}:utility:${channel}`,
        respectWithdrawn: true,
      });
    }
  }

  // --- small reads ---------------------------------------------------------------------------------------------------------------------

  private async acceptedThisMonth(orgId: number, now: Date): Promise<number> {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.subs.countAccepted(tx, orgId, from, to),
    );
  }

  private async countBlocked(orgId: number): Promise<void> {
    try {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.forms.bumpSpamBlocked(tx, orgId, new Date()),
      );
    } catch (err) {
      this.logger.warn({ err }, 'could not count a blocked form submission');
    }
  }

  /** The answer to the sender: a thank-you message (sanitised again here, on the way out) or a redirect. Never a hint about the CRM. */
  private responseFor(def: FormDefinition, token: string): PublicFormSubmitResponse {
    const s = def.settings;
    return {
      submissionToken: token,
      next:
        s.successMode === 'redirect' && s.redirectUrl
          ? { type: 'redirect', url: s.redirectUrl }
          : { type: 'message', message: this.sanitizer.sanitize(s.successMessage) },
    };
  }
}
