/**
 * Public surface of the auth domain. Other modules import from here, never from
 * the files behind it (architecture rule: no cross-module internals).
 */
export { AuthModule } from './auth.module';
export { AllowWhileGated, OperatorRoles } from './guards/auth-gates';
export { OperatorGuard } from './guards/operator.guard';
export { AuthAuditService, type SecurityEventInput } from './security/auth-audit.service';
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
export { SessionService } from './sessions/session.service';
export { TokenService, type TokenClaims } from './token.service';
export { AuthMaintenanceService } from './maintenance/auth-maintenance.service';
export { OtpTemplateRefreshService } from './maintenance/otp-template-refresh.service';
