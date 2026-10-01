import { Global, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuthProvidersModule } from '../../infra/providers/auth-registration-security/auth-providers.module';
import { OTP_SENDER_PORT } from '../../infra/providers/auth-registration-security/otp-sender.port';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { AccountService } from './account/account.service';
import { PlanFeatureGate } from './account/plan-feature-gate';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClerkService } from './clerk.service';
import { AccountController } from './controllers/account.controller';
import { OnboardingController } from './controllers/onboarding.controller';
import {
  PlatformAuthController,
  PlatformSecurityController,
  PlatformSettingsController,
} from './controllers/platform.controller';
import { RegistrationController } from './controllers/registration.controller';
import { LoginAlertService } from './flows/login-alert.service';
import { LoginService } from './flows/login.service';
import { OnboardingService } from './flows/onboarding.service';
import { RecoveryService } from './flows/recovery.service';
import { SignupService } from './flows/signup.service';
import { SocialAuthService } from './flows/social-auth.service';
import { UserTokensService } from './flows/user-tokens.service';
import { WorkspaceSwitchService } from './flows/workspace-switch.service';
import { AccountGateGuard } from './guards/account-gate.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OperatorGuard } from './guards/operator.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { MailService } from './mail/mail.service';
import { SecurityHeadersMiddleware } from './middleware-security-headers';
import { AuthSettingsService } from './platform/auth-settings.service';
import { ConfiguredOtpSender } from './platform/configured-otp-sender';
import { OperatorAuthService } from './platform/operator-auth.service';
import { OtpSenderRegistryService } from './platform/otp-sender-registry.service';
import { OtpTemplateService } from './platform/otp-template.service';
import { PlatformSettingsService } from './platform/platform-settings.service';
import { RegistrationOtpService } from './platform/registration-otp.service';
import { PlatformStore } from './platform/platform-store';
import { SecurityCenterService } from './platform/security-center.service';
import { SecurityPolicyService } from './platform/security-policy.service';
import { TenantDirectory } from './platform/tenant-directory';
import { SessionService } from './sessions/session.service';
import { EpochService } from './sessions/epoch.service';
import { AccountGateService } from './security/account-gate.service';
import { AuthAuditService } from './security/auth-audit.service';
import { CaptchaService } from './security/captcha.service';
import { EmergencyHaltService } from './security/emergency-halt.service';
import { HtmlSanitizerService } from './security/html-sanitizer.service';
import { MfaService } from './security/mfa.service';
import { PasswordService } from './security/password.service';
import { RateLimitService } from './security/rate-limit.service';
import { SendPolicyService } from './security/send-policy.service';
import { UploadPolicyService } from './security/upload-policy.service';
import { WebhookSecretRegistry } from './security/webhook-secret-registry';
import { TokenService } from './token.service';

/**
 * Authentication, sessions, account security and the platform operator layer
 * (ADR-0007, ADR-0019).
 *
 * Global because the guards are registered app-wide in app.module.ts, and
 * because the send-path services (SendPolicyService, EmergencyHaltService) and
 * the upload/HTML guards are used by other domains. Secrets are passed per
 * sign/verify call rather than configured once here: access and refresh tokens
 * use different keys (see TokenService).
 */
@Global()
@Module({
  imports: [JwtModule.register({}), AuthProvidersModule, PlansCoreModule],
  controllers: [
    AuthController,
    RegistrationController,
    AccountController,
    OnboardingController,
    PlatformAuthController,
    PlatformSecurityController,
    PlatformSettingsController,
  ],
  providers: [
    // identity primitives
    AuthService,
    TokenService,
    ClerkService,
    CryptoService,
    JwtAuthGuard,
    PermissionsGuard,
    AccountGateGuard,
    OperatorGuard,
    // sessions
    SessionService,
    EpochService,
    // flows
    LoginService,
    LoginAlertService,
    SignupService,
    RecoveryService,
    SocialAuthService,
    OnboardingService,
    WorkspaceSwitchService,
    UserTokensService,
    // account
    AccountService,
    PlanFeatureGate,
    MailService,
    // security services
    AuthAuditService,
    AccountGateService,
    CaptchaService,
    MfaService,
    PasswordService,
    RateLimitService,
    EmergencyHaltService,
    SendPolicyService,
    UploadPolicyService,
    HtmlSanitizerService,
    WebhookSecretRegistry,
    // platform layer
    PlatformStore,
    TenantDirectory,
    PlatformSettingsService,
    SecurityPolicyService,
    AuthSettingsService,
    OperatorAuthService,
    SecurityCenterService,
    // sign-up OTP delivery: the sender registry, the real sender behind OTP_SENDER_PORT,
    // the activation rule and the template flow (TW-AUTH-006/007)
    OtpSenderRegistryService,
    ConfiguredOtpSender,
    { provide: OTP_SENDER_PORT, useExisting: ConfiguredOtpSender },
    RegistrationOtpService,
    OtpTemplateService,
  ],
  exports: [
    AuthService,
    TokenService,
    ClerkService,
    JwtAuthGuard,
    PermissionsGuard,
    AccountGateGuard,
    // the operator guard and what it needs, for other domains' /v2/platform controllers (PLAN)
    OperatorGuard,
    OperatorAuthService,
    SessionService,
    EpochService,
    AccountGateService,
    PasswordService,
    AuthAuditService,
    SendPolicyService,
    EmergencyHaltService,
    UploadPolicyService,
    HtmlSanitizerService,
    SecurityPolicyService,
    PlatformSettingsService,
    WebhookSecretRegistry,
    OtpTemplateService,
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
