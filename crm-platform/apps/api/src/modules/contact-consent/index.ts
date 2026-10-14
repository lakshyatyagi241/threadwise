export { ContactConsentModule } from './contact-consent.module';
export {
  ContactConsentService,
  type RecordEventInput,
  type RecordOutcome,
} from './consent.service';
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
  type ConsentFacts,
} from './consent-gate.rules';
