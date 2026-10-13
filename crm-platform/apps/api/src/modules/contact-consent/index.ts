export { ContactConsentModule } from './contact-consent.module';
export {
  ContactConsentService,
  type RecordEventInput,
  type RecordOutcome,
} from './consent.service';
export { ConsentSettingsService } from './consent-settings.service';
export { ConsentPolicyService, hasGrantedConsentSql } from './consent-policy.service';
export {
  ConsentGate,
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
