/**
 * Public surface of the auth domain. Other modules import from here, never from
 * the files behind it (architecture rule: no cross-module internals).
 */
export { AuthModule } from './auth.module';
export { AllowWhileGated, OperatorRoles } from './guards/auth-gates';
export { OperatorGuard } from './guards/operator.guard';
export { ImpersonationGuard } from './guards/impersonation.guard';
export { ImpersonationService } from './platform/impersonation.service';
export { AuthAuditService, type SecurityEventInput } from './security/auth-audit.service';
export { CaptchaService } from './security/captcha.service';
export { RateLimitService } from './security/rate-limit.service';
export { EmergencyHaltService } from './security/emergency-halt.service';
export {
  WebhookSecretRegistry,
  type WebhookSecretRotator,
} from './security/webhook-secret-registry';
export { SendGuardModule } from './security/send-guard.module';
export { HtmlSanitizerService } from './security/html-sanitizer.service';
export { PasswordService } from './security/password.service';
export { SendPolicyService, type ScreenContext } from './security/send-policy.service';
export { UploadPolicyService, type UploadKind } from './security/upload-policy.service';
export { SecurityPolicyService } from './platform/security-policy.service';
export { PlatformSettingsService } from './platform/platform-settings.service';
export { PlatformStore } from './platform/platform-store';
export { TenantDirectory } from './platform/tenant-directory';
export { SessionService } from './sessions/session.service';
export { TokenService, type TokenClaims } from './token.service';
export { AuthMaintenanceService } from './maintenance/auth-maintenance.service';
export { OtpTemplateRefreshService } from './maintenance/otp-template-refresh.service';
export { AccountGateService } from './security/account-gate.service';
export {
  OrgSuspensionService,
  isOperatorImpersonation,
  orgSuspendedError,
} from './security/org-suspension.service';
export { LoginService } from './flows/login.service';
export { UserTokensService, type TokenKind } from './flows/user-tokens.service';
export { MailService } from './mail/mail.service';
export {
  UnofficialWhatsappSwitch,
  unofficialDisabled,
  UNOFFICIAL_WHATSAPP_KEY,
} from './platform/unofficial-whatsapp-switch';
