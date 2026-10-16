/**
 * Public surface of the leads module (the lead pipeline).
 *
 * A domain that only SENDS leads (a marketplace connector, a channel) imports `LeadIngestModule` from here, injects `LEAD_INGEST` /
 * `LEAD_SOURCE_DIRECTORY` by token, and takes the types from the two leaf port files, which import nothing:
 *   `leads/lead-ingest.port.ts` and `leads/lead-source-directory.port.ts`.
 * Everything else stays inside the module.
 */
export { LeadsModule } from './leads.module';
export { LeadIngestModule } from './lead-ingest.module';
export { LeadsWorkerModule } from './leads-worker.module';
export { LeadPullModule } from './lead-pull.module';
export { LEAD_INGEST } from './lead-ingest.port';
export type {
  LeadConsent,
  LeadIngestPort,
  LeadIngestResult,
  NormalisedLead,
} from './lead-ingest.port';
export { LEAD_PULL_REGISTRY } from './lead-pull.port';
export type {
  LeadPullCapabilities,
  LeadPullProgress,
  LeadPullProvider,
  LeadPullRegistryPort,
  LeadPullRequest,
  LeadPullResult,
  LeadPullSource,
} from './lead-pull.port';
export { LEAD_SOURCE_DIRECTORY } from './lead-source-directory.port';
export type { ConnectorSourceInput, LeadSourceDirectoryPort } from './lead-source-directory.port';
// Shared rules the Forms add-on reuses so a web form and a lead source dedupe, coerce and rotate owners the same way.
export { coerceCustomValue, normaliseLeadEmail } from './lead-mapping';
export { pickOwner } from './lead-assignment';
