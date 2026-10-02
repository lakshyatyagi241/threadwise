import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  parseOtpSenderRef,
  OTP_TEMPLATE_OPTIONS_MAX,
  type OtpTemplateActionResponse,
  type OtpTemplateCreateRequest,
  type OtpTemplateOption,
  type OtpTemplateOptionsResponse,
  type OtpTemplateOutcome,
  type OtpTemplateState,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { MetaTemplateClient } from '../../../infra/providers/auth-registration-security/meta-template.client';
import {
  LOCAL_OTP_TEMPLATE_NAME,
  OTP_COPY_BUTTON_TEXT,
  OTP_TEMPLATE_LANGUAGE,
  WABA_OTP_TEMPLATE_NAME,
  localTemplateBody,
} from '../../../infra/providers/auth-registration-security/otp-payloads';
import {
  OtpSendError,
  type WabaOtpConfig,
} from '../../../infra/providers/auth-registration-security/otp-sender.port';
import { AccountGateService } from '../security/account-gate.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { OtpSenderRegistryService } from './otp-sender-registry.service';
import { RegistrationOtpService } from './registration-otp.service';
import { SecurityPolicyService } from './security-policy.service';

/**
 * The OTP message template (WD-AUTH-007): "Create & submit template", the
 * status refresh and the worker's poll.
 *
 * waba: an authentication template submitted to Meta; it is pending until Meta
 * approves it, and the code step stays off until then. Twilio and the bridge
 * need no review: their template is local text, usable at once.
 */
@Injectable()
export class OtpTemplateService {
  private readonly logger = new Logger(OtpTemplateService.name);

  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly registry: OtpSenderRegistryService,
    private readonly meta: MetaTemplateClient,
    private readonly otp: RegistrationOtpService,
    private readonly audit: AuthAuditService,
    private readonly gates: AccountGateService,
  ) {}

  private response = async (outcome: OtpTemplateOutcome): Promise<OtpTemplateActionResponse> => ({
    outcome,
    registration: await this.otp.settingsResponse(),
  });

  /**
   * The whole OTP form arrives: the sender is required, the knobs are saved in
   * the same request, then the template is created (local) or submitted to Meta.
   */
  async createAndSubmit(
    req: OtpTemplateCreateRequest,
    operatorId: number,
  ): Promise<OtpTemplateActionResponse> {
    const before = await this.policy.registration();
    const ref = req.otp.sender !== undefined ? req.otp.sender : before.otp.sender;
    if (!ref || !parseOtpSenderRef(ref)) {
      throw AppError.validation('Pick a sender channel first, then create the template.', [
        { path: 'otp.sender', message: 'Pick a sender channel first.' },
      ]);
    }
    await this.otp.assertSelectable(ref, 'otp.sender');
    if ((await this.registry.stateOf(ref)) === 'incomplete') {
      throw AppError.validation(
        'This sender is missing credentials. Finish it under Manage senders first.',
        [{ path: 'otp.sender', message: 'This sender is missing credentials.' }],
      );
    }

    // Save the knobs (and the sender) first: they belong to this request even if Meta says no.
    const saved = await this.otp.patchRegistration(
      { otp: { ...req.otp, sender: ref } },
      operatorId,
    );
    if (JSON.stringify(saved.before.otp) !== JSON.stringify(saved.after.otp)) {
      await this.gates.invalidateAll();
      await this.audit.recordStandalone({
        event: 'platform.settings.registration_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { before: saved.before, after: saved.after },
      });
    }

    const ttl = saved.after.otp.ttlMinutes;
    const now = new Date().toISOString();
    const existing =
      saved.after.otp.template && saved.after.otp.template.sender === ref
        ? saved.after.otp.template
        : null;

    if (parseOtpSenderRef(ref)!.kind !== 'waba') {
      const template: OtpTemplateState = {
        name: LOCAL_OTP_TEMPLATE_NAME,
        kind: 'local',
        sender: ref,
        language: OTP_TEMPLATE_LANGUAGE,
        body: localTemplateBody(ttl),
        metaTemplateId: null,
        status: 'local',
        codeExpirationMinutes: ttl,
        submittedAt: now,
        checkedAt: null,
        rejectedReason: null,
      };
      await this.policy.setOtpTemplate(template, operatorId);
      await this.auditTemplate('platform.settings.otp_template_saved', operatorId, {
        sender: ref,
        outcome: 'local_ready',
      });
      return this.response('local_ready');
    }

    const access = await this.wabaAccess(ref);
    let outcome: OtpTemplateOutcome;
    let template: OtpTemplateState;

    if (existing?.metaTemplateId) {
      if (existing.status === 'pending') return this.response('already_pending');
      if (existing.status === 'approved' && existing.codeExpirationMinutes === ttl) {
        return this.response('already_approved');
      }
      // Rejected, or approved with another expiry: send the corrected template back for review.
      await this.callMeta(operatorId, ref, 'submit', () =>
        this.meta.update(access, existing.metaTemplateId!, { ttlMinutes: ttl }),
      );
      template = {
        ...existing,
        status: 'pending',
        codeExpirationMinutes: ttl,
        submittedAt: now,
        checkedAt: null,
        rejectedReason: null,
      };
      outcome = 'resubmitted';
    } else {
      const submitted = await this.callMeta(operatorId, ref, 'submit', () =>
        this.meta.create(access, {
          name: WABA_OTP_TEMPLATE_NAME,
          language: OTP_TEMPLATE_LANGUAGE,
          ttlMinutes: ttl,
        }),
      );
      template = {
        name: WABA_OTP_TEMPLATE_NAME,
        kind: 'waba',
        sender: ref,
        language: OTP_TEMPLATE_LANGUAGE,
        body: null,
        metaTemplateId: submitted.id,
        status: submitted.status,
        codeExpirationMinutes: ttl,
        submittedAt: now,
        checkedAt: now,
        rejectedReason: submitted.rejectedReason,
        buttonLabel: OTP_COPY_BUTTON_TEXT,
      };
      outcome = 'submitted';
    }

    await this.policy.setOtpTemplate(template, operatorId);
    await this.auditTemplate('platform.settings.otp_template_submitted', operatorId, {
      sender: ref,
      outcome,
      status: template.status,
      metaTemplateId: template.metaTemplateId,
      expiresAfterMinutes: ttl,
    });
    return this.response(outcome);
  }

  /**
   * The data behind the "WABA auth template" dropdown (WD-AUTH-007 rule 5): the approved
   * authentication templates of the saved WhatsApp Business sender (up to 300, the way WaDesk lists
   * them), with the saved template always present and carrying its status even when it is not
   * approved or not on Meta's list (a plain save must never lose it). Local (Twilio, bridge) senders
   * have no Meta list: the saved local text is the only row.
   *
   * Meta being unreachable does not fail the call: the saved template is still returned and
   * `unavailableReason` says why the rest is missing.
   */
  async options(): Promise<OtpTemplateOptionsResponse> {
    const { otp } = await this.policy.registration();
    const sender = otp.sender;
    const saved = otp.template && sender && otp.template.sender === sender ? otp.template : null;

    let listed: OtpTemplateOption[] = [];
    let unavailableReason: string | null = null;
    if (sender && parseOtpSenderRef(sender)?.kind === 'waba') {
      try {
        const access = await this.wabaAccess(sender);
        const rows = await this.meta.listApprovedAuthentication(access);
        listed = rows.map((t) => ({
          id: t.id,
          name: t.name,
          language: t.language,
          kind: 'waba' as const,
          status: 'approved' as const,
          selected: false,
          buttonLabel: t.buttonLabel,
        }));
      } catch (err) {
        unavailableReason =
          err instanceof OtpSendError || err instanceof AppError
            ? err.message.slice(0, 240)
            : 'The template list could not be read.';
        if (!(err instanceof OtpSendError || err instanceof AppError)) {
          this.logger.warn({ err }, 'OTP template list failed');
        }
      }
    }

    const savedOption: OtpTemplateOption | null = saved
      ? {
          id: saved.metaTemplateId ?? saved.name,
          name: saved.name,
          language: saved.language,
          kind: saved.kind,
          status: saved.status,
          selected: true,
          buttonLabel: saved.kind === 'waba' ? (saved.buttonLabel ?? OTP_COPY_BUTTON_TEXT) : null,
        }
      : null;
    const rest = savedOption ? listed.filter((t) => t.id !== savedOption.id) : listed;
    const templates = savedOption ? [savedOption, ...rest] : rest;
    return {
      sender,
      templates: templates.slice(0, OTP_TEMPLATE_OPTIONS_MAX + 1),
      unavailableReason,
    };
  }

  /** Reads the template's review status back from Meta. */
  async refresh(operatorId: number | null): Promise<OtpTemplateActionResponse> {
    const { otp } = await this.policy.registration();
    const template = otp.template;
    if (!template || template.kind !== 'waba' || !template.metaTemplateId) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'There is no template submitted to Meta to refresh.',
        HttpStatus.CONFLICT,
      );
    }
    const access = await this.wabaAccess(template.sender);
    const result = await this.callMeta(operatorId, template.sender, 'check', () =>
      this.meta.status(access, template.metaTemplateId!),
    );
    const next: OtpTemplateState = {
      ...template,
      status: result.status,
      rejectedReason: result.rejectedReason,
      checkedAt: new Date().toISOString(),
    };
    await this.policy.setOtpTemplate(next, operatorId);
    if (next.status !== template.status) {
      await this.auditTemplate('platform.settings.otp_template_status_changed', operatorId, {
        sender: template.sender,
        from: template.status,
        to: next.status,
        metaTemplateId: template.metaTemplateId,
      });
    }
    return this.response('refreshed');
  }

  /** The worker's poll: only a template still waiting for review is worth asking about. */
  async refreshPending(): Promise<'skipped' | 'checked' | 'failed'> {
    const { otp } = await this.policy.registration();
    if (otp.template?.kind !== 'waba' || otp.template.status !== 'pending') return 'skipped';
    try {
      await this.refresh(null);
      return 'checked';
    } catch (err) {
      this.logger.warn(
        { reason: err instanceof AppError ? err.message : 'unexpected' },
        'OTP template status poll failed',
      );
      return 'failed';
    }
  }

  // --- helpers ------------------------------------------------------------------------------

  private async wabaAccess(ref: string): Promise<WabaOtpConfig> {
    const sender = await this.registry.resolve(ref);
    if (!sender || sender.kind !== 'waba') {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'The WhatsApp Business sender for this template is missing or incomplete.',
        HttpStatus.CONFLICT,
      );
    }
    return sender;
  }

  /** A Meta call whose failure becomes a readable, audited error (never carrying the token). */
  private async callMeta<T>(
    operatorId: number | null,
    ref: string,
    what: 'submit' | 'check',
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof OtpSendError)) throw err;
      await this.audit.recordStandalone({
        event: 'platform.settings.otp_template_failed',
        status: 'failure',
        actorType: operatorId ? 'platform_operator' : 'system',
        actorId: operatorId,
        payload: { sender: ref, reason: err.reason },
      });
      throw new AppError(
        ERROR_CODES.AUTH_OTP_TEMPLATE_FAILED,
        what === 'submit'
          ? `Meta did not take the template. ${err.message}`
          : `Could not check the template with Meta. ${err.message}`,
        HttpStatus.BAD_GATEWAY,
        [{ path: 'reason', message: err.reason }],
      );
    }
  }

  private auditTemplate(
    event: string,
    operatorId: number | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.recordStandalone({
      event,
      status: 'info',
      actorType: operatorId ? 'platform_operator' : 'system',
      actorId: operatorId,
      payload,
    });
  }
}
