/** Public surface of the broadcasts domain. Other domains import only from here. */
export { BroadcastsModule } from './broadcasts.module';
export { BroadcastsWorkerModule } from './broadcasts-worker.module';
export { BroadcastReceiptsService, type DeliveryReceipt } from './broadcast-receipts.service';
export { mapBaileysAck, mapTwilioStatus } from './receipt-rules';

/**
 * The shared sending kit, for the sibling messaging domain (campaigns): sender and template directories, engine senders, pacing,
 * the sender lease and daily cap, link tracking, the compose lookups and the pure rules they all share.
 */
export { BroadcastsComposeService } from './broadcasts-compose.service';
export {
  EngineSenderRegistry,
  type OpenedSender,
  type OutgoingMessage,
  type OutgoingText,
} from './engine-senders';
export { LinkTracker } from './tracking/link-tracker';
export {
  CapTally,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
  type PacingSettingsSource,
} from './send-safety';
export {
  DEFAULT_PACING,
  batchCooldownMs,
  batchingApplies,
  capRemaining,
  jitter,
  nextGapMs,
  nextUtcMidnight,
  type PacingSettings,
} from './pacing';
export { isKnownTimeZone, wallTimeToUtc } from './schedule';
export { mediaUrlProblem, templateRefusals } from './template-guards';
export { assemblePhone } from './recipient-phone';
export { DEFAULT_RETRY_POLICY, resolvePolicy, retryDelaySeconds } from './retry-policy';
export {
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  WARMER_GATE,
  type DispatchSender,
  type ResolvedSender,
  type SenderDirectory,
  type TemplateDirectory,
  type TemplateRecord,
  type WalletGate,
  type WarmerGate,
} from './_shims/tokens';
export { readableTemplateBody, resolveBodyTokens } from './inbox-mirror-rules';
export { buildRecipientVars } from './payload/template-vars';
export {
  applyOverrides,
  sanitizeOverrides,
  type TemplateOverrides,
} from './payload/template-overrides';
