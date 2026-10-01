import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  authPagesPatchSchema,
  mfaEnableRequestSchema,
  mfaLoginRequestSchema,
  operatorLoginRequestSchema,
  otpSenderCreateSchema,
  otpSenderIdSchema,
  otpSenderPatchSchema,
  otpSenderRef,
  otpTemplateCreateRequestSchema,
  otpTestRequestSchema,
  refreshRequestSchema,
  registrationSettingsPatchSchema,
  securityEventListQuerySchema,
  securityPolicyPatchSchema,
  socialCaptchaSettingsPatchSchema,
  type AuthPagesPatch,
  type MfaEnableRequest,
  type MfaLoginRequest,
  type OperatorLoginRequest,
  type OtpSenderCreate,
  type OtpSenderDeleteResponse,
  type OtpSenderPatch,
  type OtpSendersResponse,
  type OtpTemplateCreateRequest,
  type OtpTestRequest,
  type RegistrationSettingsPatch,
  type SecurityEventListQuery,
  type SecurityPolicyPatch,
  type SocialCaptchaSettingsPatch,
} from '@crm/contracts';
import { z } from 'zod';
import { ActorKinds, Public } from '../../../common/decorators';
import { RequestContextStore } from '../../../common/context/request-context';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { AllowWhileGated, OperatorRoles } from '../guards/auth-gates';
import { OperatorGuard } from '../guards/operator.guard';
import { AuthSettingsService } from '../platform/auth-settings.service';
import { OperatorAuthService } from '../platform/operator-auth.service';
import { OtpSenderRegistryService } from '../platform/otp-sender-registry.service';
import { OtpTemplateService } from '../platform/otp-template.service';
import { RegistrationOtpService } from '../platform/registration-otp.service';
import { SecurityCenterService } from '../platform/security-center.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AccountGateService } from '../security/account-gate.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { clientMeta } from '../support/client-meta';

/** Operator sign-in. Public routes (no operator token exists yet); everything else is behind OperatorGuard. */
@ApiTags('platform')
@Controller({ path: 'platform/auth', version: '2' })
export class PlatformAuthController {
  constructor(private readonly operators: OperatorAuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Platform operator sign-in' })
  async login(@Body(zodPipe(operatorLoginRequestSchema)) body: OperatorLoginRequest) {
    return this.operators.login(body, clientMeta());
  }

  @Public()
  @Post('login/mfa')
  @ApiOperation({ summary: 'Complete operator sign-in with a code' })
  async loginMfa(@Body(zodPipe(mfaLoginRequestSchema)) body: MfaLoginRequest) {
    return this.operators.loginMfa(body, clientMeta());
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate an operator refresh token' })
  async refresh(@Body(zodPipe(refreshRequestSchema)) body: z.infer<typeof refreshRequestSchema>) {
    return this.operators.refresh(body.refreshToken);
  }

  @Post('logout')
  @ActorKinds('platform_operator')
  @UseGuards(OperatorGuard)
  @AllowWhileGated()
  async logout() {
    await this.operators.logout();
    return { ok: true };
  }

  @Get('session')
  @ActorKinds('platform_operator')
  @UseGuards(OperatorGuard)
  @AllowWhileGated()
  async session() {
    return this.operators.session();
  }

  @Post('mfa/setup')
  @ActorKinds('platform_operator')
  @UseGuards(OperatorGuard)
  @AllowWhileGated()
  async mfaSetup() {
    return this.operators.mfaSetup();
  }

  @Post('mfa/enable')
  @ActorKinds('platform_operator')
  @UseGuards(OperatorGuard)
  @AllowWhileGated()
  async mfaEnable(@Body(zodPipe(mfaEnableRequestSchema)) body: MfaEnableRequest) {
    return this.operators.mfaEnable(body.code);
  }
}

/** Security Center: policy, KPIs, event stream, danger zone. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/security', version: '2' })
export class PlatformSecurityController {
  constructor(private readonly center: SecurityCenterService) {}

  @Get()
  @ApiOperation({ summary: 'Policy, KPIs, risk queue, coverage and the enforcement matrix' })
  async overview() {
    return this.center.overview();
  }

  @Patch('policy')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Partial update of the security policy (one audit event with a diff)' })
  async patchPolicy(@Body(zodPipe(securityPolicyPatchSchema)) body: SecurityPolicyPatch) {
    return this.center.patchPolicy(body);
  }

  @Get('events')
  @ApiOperation({ summary: 'The security event stream (cursor paginated)' })
  async events(@Query(zodPipe(securityEventListQuerySchema)) query: SecurityEventListQuery) {
    return this.center.events(query);
  }

  @Post('danger/revoke-sessions')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Sign every user and operator out' })
  async revokeSessions() {
    return this.center.revokeAllSessions();
  }

  @Post('danger/force-password-reset')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Require every user to choose a new password at next sign-in' })
  async forceReset() {
    return this.center.forcePasswordReset();
  }

  @Post('danger/rotate-webhook-secrets')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Rotate webhook signing secrets (nothing to rotate until the API domain stores them)',
  })
  async rotateWebhooks() {
    return this.center.rotateWebhookSecrets();
  }

  @Post('danger/halt-sends')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Emergency stop: refuse every outbound message platform-wide' })
  async halt() {
    return this.center.setHalt(true);
  }

  @Post('danger/resume-sends')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Resume outbound messaging' })
  async resume() {
    return this.center.setHalt(false);
  }
}

/** Guest-page settings: registration policy, social login and captcha, auth page copy. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/settings', version: '2' })
export class PlatformSettingsController {
  constructor(
    private readonly settings: AuthSettingsService,
    private readonly policy: SecurityPolicyService,
    private readonly audit: AuthAuditService,
    private readonly gates: AccountGateService,
    private readonly senders: OtpSenderRegistryService,
    private readonly otp: RegistrationOtpService,
    private readonly templates: OtpTemplateService,
  ) {}

  private operatorId(): number {
    return RequestContextStore.require().actorId!;
  }

  private event(event: string, payload: Record<string, unknown>) {
    return this.audit.recordStandalone({
      event,
      status: 'info',
      actorType: 'platform_operator',
      actorId: this.operatorId(),
      payload,
    });
  }

  @Get('registration')
  @ApiOperation({
    summary: 'Registration policy, the sign-up OTP settings and whether the code step is active',
  })
  async registration() {
    return this.otp.settingsResponse();
  }

  @Patch('registration')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Update registration policy (partial)' })
  async patchRegistration(
    @Body(zodPipe(registrationSettingsPatchSchema)) body: RegistrationSettingsPatch,
  ) {
    const { before, after } = await this.otp.patchRegistration(body, this.operatorId());
    await this.gates.invalidateAll();
    await this.audit.recordStandalone({
      event: 'platform.settings.registration_updated',
      status: 'info',
      actorType: 'platform_operator',
      actorId: this.operatorId(),
      payload: { before, after },
    });
    return this.otp.settingsResponse(after);
  }

  // --- sign-up OTP: senders, template, test (TW-AUTH-006/007) ---------------------------------------------

  @Get('senders')
  @ApiOperation({
    summary: 'OTP senders (WhatsApp Business, Twilio, bridge); secrets are never returned',
  })
  async listSenders(): Promise<OtpSendersResponse> {
    return { senders: await this.senders.list(), devAllowed: this.senders.devAllowed };
  }

  @Post('senders')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Add an OTP sender; the secret is stored encrypted and write-only' })
  async createSender(@Body(zodPipe(otpSenderCreateSchema)) body: OtpSenderCreate) {
    const { sender, changed } = await this.senders.create(body, this.operatorId());
    await this.event('platform.settings.otp_sender_created', {
      sender: otpSenderRef(sender.kind, sender.id),
      label: sender.label,
      changedFields: changed,
    });
    return sender;
  }

  @Patch('senders/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Edit an OTP sender; a blank secret keeps the stored one, clearSecret removes it',
  })
  async patchSender(
    @Param('id', zodPipe(otpSenderIdSchema)) id: string,
    @Body(zodPipe(otpSenderPatchSchema)) body: OtpSenderPatch,
  ) {
    const { sender, changed } = await this.senders.update(id, body, this.operatorId());
    await this.event('platform.settings.otp_sender_updated', {
      sender: otpSenderRef(sender.kind, sender.id),
      changedFields: changed,
    });
    return sender;
  }

  @Delete('senders/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Remove an OTP sender and its secret; if sign-up used it, the selection is cleared',
  })
  async deleteSender(
    @Param('id', zodPipe(otpSenderIdSchema)) id: string,
  ): Promise<OtpSenderDeleteResponse> {
    const removed = await this.senders.remove(id, this.operatorId());
    const ref = otpSenderRef(removed.kind, removed.id);
    const selectionCleared = (await this.policy.registration()).otp.sender === ref;
    if (selectionCleared) {
      await this.policy.clearOtpSelection(this.operatorId());
      await this.gates.invalidateAll();
    }
    await this.event('platform.settings.otp_sender_deleted', {
      sender: ref,
      label: removed.label,
      selectionCleared,
    });
    return { ok: true, selectionCleared };
  }

  @Post('registration/otp-template')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Create and submit the OTP template: saves the OTP form, then submits to Meta (WhatsApp Business) or saves a local template',
  })
  async createOtpTemplate(
    @Body(zodPipe(otpTemplateCreateRequestSchema)) body: OtpTemplateCreateRequest,
  ) {
    return this.templates.createAndSubmit(body, this.operatorId());
  }

  @Post('registration/otp-template/refresh')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Re-read the OTP template review status from Meta' })
  async refreshOtpTemplate() {
    return this.templates.refresh(this.operatorId());
  }

  @Post('registration/otp-test')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Send a test code through the saved sender to a number you type (5 per hour per operator; the code is not returned)',
  })
  async testOtp(@Body(zodPipe(otpTestRequestSchema)) body: OtpTestRequest) {
    return this.otp.testSend(this.operatorId(), body);
  }

  @Get('social-captcha')
  @ApiOperation({ summary: 'Google, Facebook and reCAPTCHA settings (secrets are never returned)' })
  async socialCaptcha() {
    return this.settings.getSocialCaptchaSettings();
  }

  @Patch('social-captcha')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Update social login and captcha settings; blank secret keeps the stored one',
  })
  async patchSocialCaptcha(
    @Body(zodPipe(socialCaptchaSettingsPatchSchema)) body: SocialCaptchaSettingsPatch,
  ) {
    const changed = await this.settings.patchSocialCaptchaSettings(body, this.operatorId());
    // Booleans and key names only, never secret values.
    await this.audit.recordStandalone({
      event: 'platform.settings.social_login_updated',
      status: 'info',
      actorType: 'platform_operator',
      actorId: this.operatorId(),
      payload: { changed },
    });
    return this.settings.getSocialCaptchaSettings();
  }

  @Get('auth-pages')
  @ApiOperation({ summary: 'Sign-in, sign-up and forgot-password page copy and layout' })
  async authPages() {
    return this.settings.getAuthPages();
  }

  @Patch('auth-pages')
  @OperatorRoles('super_admin', 'support')
  @ApiOperation({
    summary: 'Update auth page copy, layout variant and media (empty value restores the default)',
  })
  async patchAuthPages(@Body(zodPipe(authPagesPatchSchema)) body: AuthPagesPatch) {
    const result = await this.settings.patchAuthPages(body, this.operatorId());
    await this.audit.recordStandalone({
      event: 'platform.settings.auth_pages_updated',
      status: 'info',
      actorType: 'platform_operator',
      actorId: this.operatorId(),
      payload: { variant: result.variant },
    });
    return result;
  }
}
