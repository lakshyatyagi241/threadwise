export { ContactConsentModule } from './contact-consent.module';
export {
  ContactConsentService,
  type RecordEventInput,
  type RecordOutcome,
} from './consent.service';
export {
  ContactPrivacyService,
  type PrivacyChangeInput,
  type PrivacyChangeOutcome,
} from './contact-privacy.service';
export { isGpcSignal } from './contact-privacy.rules';
export { MinorDetectionService, type MinorEvaluation } from './minor-detection.service';
export { ConsentUnsubscribeService, type UnsubscribeLink } from './consent-unsubscribe.service';
export { ConsentSettingsService } from './consent-settings.service';
export { ConsentPolicyService, hasGrantedConsentSql } from './consent-policy.service';
export {
  ConsentGate,
  purposeOfCategory,
  type GateManyOptions,
  type GateManyResult,
  type GateOptions,
} from './consent-gate.service';
export {
  decideConsent,
  failureResult,
  messagePurpose,
  isAllowed,
  isHeldAsMinor,
  type ConsentFacts,
} from './consent-gate.rules';
export {
  consentSkipNote,
  consentSkipReason,
  countSkipReasons,
  gateRecipients,
  type GatedRecipients,
  type SkippedRecipient,
} from './consent-gate.recipients';
export { CONSENT_GATE_ALLOWLIST, SEND_PRIMITIVES } from './consent-gate.allowlist';
export { ConsentIntakeService, type IntakeGrantInput } from './consent-intake.service';
export { ConsentNoticeService } from './consent-notice.service';
export {
  hasProof,
  intakeEvidence,
  isSubscribedStatus,
  planIntakeGrants,
  type IntakePlan,
  type StatusMap,
} from './consent-intake.rules';
