/**
 * Public surface of the AI keys domain (AIADM). Other modules import from here, never from the files behind it.
 *
 * Every AI-using domain does the same three things around a vendor call:
 *   1. `AiTokenMeter.guard(orgId)` before it, when the call would use the platform's key
 *   2. `AiKeyResolver.resolve(orgId, provider)` to get the key and which side pays
 *   3. `AiTokenMeter.record(orgId, { ..., billedAgainst: source })` after it
 * and passes its requested output size through `AiKeyResolver.capMaxTokens(provider, n)`.
 */
export { AiKeysUsageAdminModule } from './ai-keys-usage-admin.module';
export { AiKeyResolver, type ResolvedKey } from './ai-key-resolver.service';
export { AiTokenMeter, type TokenUsage } from './ai-token-meter.service';
export { AiModelsService } from './ai-models.service';
