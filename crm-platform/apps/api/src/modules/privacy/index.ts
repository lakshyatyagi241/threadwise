export { PrivacyModule } from './privacy.module';
export {
  PersonalDataErasureService,
  ALL_TIERS,
  CONTACT_DELETE_TIERS,
  STAFF_ERASE_TIERS,
} from './engine/erasure.service';
export { SubjectResolver } from './engine/subject-resolver';
export {
  PERSONAL_DATA_REGISTRY,
  registeredSpecs,
  registeredTables,
  registryDigest,
} from './registry';
export { defineHolder } from './registry/define';
export type {
  HolderManifest,
  PersonalDataHolder,
  ResolvedSubject,
  TableSpec,
  Tier,
} from './registry/types';
export {
  LegalHoldGuard,
  LEGAL_HOLD_BLOCKED_MESSAGE,
  legalHoldActive,
  isLegalHoldDbError,
  type HoldedOperation,
} from './legal-holds/legal-hold.guard';
export {
  sqlContactNotHeld,
  sqlLeadNotHeld,
  sqlOrgHasNoHold,
  sqlWorkspaceNotHeld,
} from './legal-holds/legal-hold.sql';
