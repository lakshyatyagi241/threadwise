import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  findWorkspacesRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  signupResendEmailCodeRequestSchema,
  signupResendOtpRequestSchema,
  signupSetPasswordRequestSchema,
  signupStartRequestSchema,
  signupVerifyEmailCodeRequestSchema,
  signupVerifyOtpRequestSchema,
  socialCallbackRequestSchema,
  socialProviderSchema,
  socialStartQuerySchema,
  verifyEmailRequestSchema,
  type FindWorkspacesRequest,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
  type SignupRequest,
  type SignupResendEmailCodeRequest,
  type SignupResendOtpRequest,
  type SignupSetPasswordRequest,
  type SignupStartRequest,
  type SignupVerifyEmailCodeRequest,
  type SignupVerifyOtpRequest,
  type SocialCallbackRequest,
  type SocialStartQuery,
  type VerifyEmailRequest,
} from '@crm/contracts';
import { ActorKinds, Public } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RecoveryService } from '../flows/recovery.service';
import { SignupService } from '../flows/signup.service';
import { SocialAuthService } from '../flows/social-auth.service';
import { AllowWhileGated } from '../guards/auth-gates';
import { clientMeta } from '../support/client-meta';

const provider = (raw: string) => {
  const parsed = socialProviderSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Sign-in method');
  return parsed.data;
};

/** Guest-facing endpoints: sign-up, OTP, password recovery, email verification, social sign-in. */
@ApiTags('auth')
@Controller({ path: 'auth', version: '2' })
export class RegistrationController {
  constructor(
    private readonly signup: SignupService,
    private readonly recovery: RecoveryService,
    private readonly social: SocialAuthService,
  ) {}

  @Public()
  @Post('signup')
  @ApiOperation({
    summary: 'Create an organization and its first user',
    description:
      'With registration OTP active the response is `otp_required` and nothing is created until the code is confirmed.',
  })
  async register(@Body(zodPipe(signupRequestSchema)) body: SignupRequest) {
    return this.signup.signup(body, clientMeta());
  }

  @Public()
  @Post('signup/verify-otp')
  @ApiOperation({ summary: 'Confirm the WhatsApp code and create the account' })
  async verifyOtp(@Body(zodPipe(signupVerifyOtpRequestSchema)) body: SignupVerifyOtpRequest) {
    return this.signup.verifyOtp(body, clientMeta());
  }

  @Public()
  @Post('signup/resend-otp')
  @ApiOperation({ summary: 'Send a new code (cooldown applies)' })
  async resendOtp(@Body(zodPipe(signupResendOtpRequestSchema)) body: SignupResendOtpRequest) {
    return this.signup.resendOtp(body, clientMeta());
  }

  @Public()
  @Post('signup/start')
  @ApiOperation({ summary: 'Start email-verified sign-up: stage the account and email a code' })
  async signupStart(@Body(zodPipe(signupStartRequestSchema)) body: SignupStartRequest) {
    return this.signup.start(body, clientMeta());
  }

  @Public()
  @HttpCode(200)
  @Post('signup/verify-email-code')
  @ApiOperation({ summary: 'Confirm the emailed code for a staged sign-up' })
  async signupVerifyEmailCode(@Body(zodPipe(signupVerifyEmailCodeRequestSchema)) body: SignupVerifyEmailCodeRequest) {
    return this.signup.verifyEmailCode(body);
  }

  @Public()
  @Post('signup/resend-email-code')
  @ApiOperation({ summary: 'Send the sign-up code again (cooldown applies)' })
  async signupResendEmailCode(@Body(zodPipe(signupResendEmailCodeRequestSchema)) body: SignupResendEmailCodeRequest) {
    return this.signup.resendEmailCode(body);
  }

  @Public()
  @Post('signup/set-password')
  @ApiOperation({ summary: 'Choose a password and create the account after email verification' })
  async signupSetPassword(@Body(zodPipe(signupSetPasswordRequestSchema)) body: SignupSetPasswordRequest) {
    return this.signup.setPassword(body, clientMeta());
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'Email a password reset link (always answers the same)' })
  async forgot(@Body(zodPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest) {
    await this.recovery.forgotPassword(body);
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Choose a new password with the emailed token' })
  async reset(@Body(zodPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest) {
    await this.recovery.resetPassword(body);
    return { ok: true };
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({ summary: 'Confirm an email address with the emailed token (does not sign in)' })
  async verifyEmail(@Body(zodPipe(verifyEmailRequestSchema)) body: VerifyEmailRequest) {
    await this.recovery.verifyEmail(body);
    return { ok: true };
  }

  @Post('verify-email/resend')
  @ActorKinds('user')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Send the verification email again (throttled)' })
  async resendVerification() {
    return this.recovery.resendVerification();
  }

  @Public()
  @Post('find-workspaces')
  @ApiOperation({ summary: 'Email the workspaces that use this address (always answers the same)' })
  async findWorkspaces(@Body(zodPipe(findWorkspacesRequestSchema)) body: FindWorkspacesRequest) {
    await this.recovery.findWorkspaces(body);
    return { ok: true };
  }

  @Public()
  @Get('social/:provider/start')
  @ApiOperation({ summary: 'Get the provider consent URL for Google or Facebook sign-in' })
  async socialStart(
    @Param('provider') rawProvider: string,
    @Query(zodPipe(socialStartQuerySchema)) query: SocialStartQuery,
  ) {
    return this.social.start(provider(rawProvider), query);
  }

  @Public()
  @Post('social/:provider/callback')
  @ApiOperation({
    summary: 'Finish provider sign-in with the code and state from the redirect',
    description:
      'Failures carry `errors: [{ path: "provider", message: "google" | "facebook" }]`: AUTH_SOCIAL_FAILED (the exchange failed), AUTH_SOCIAL_NO_ACCOUNT (nothing in that workspace matches this sign-in), AUTH_SOCIAL_NO_EMAIL (a first-time identity that shares no email), AUTH_SOCIAL_STATE_INVALID, AUTH_SIGNUP_CLOSED (sign-up mode while registration is closed).',
  })
  async socialCallback(
    @Param('provider') rawProvider: string,
    @Body(zodPipe(socialCallbackRequestSchema)) body: SocialCallbackRequest,
  ) {
    return this.social.callback(provider(rawProvider), body, clientMeta());
  }
}
