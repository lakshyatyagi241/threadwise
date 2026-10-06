import type { Campaign, CampaignConfig, CampaignStatus, CampaignType } from '@crm/contracts';
import type { CampaignRow } from './campaigns.repository';
import { effectiveClicks } from './campaign-rules';

/** The campaign as the list shows it: counts come from the recipient rows, the tile click count is the greater of ours and Meta's. */
export function toCampaign(r: CampaignRow): Campaign {
  return {
    id: r.uuid,
    name: r.name,
    type: r.type as CampaignType,
    status: r.status as CampaignStatus,
    provider: r.provider,
    abTesting: r.abTesting,
    wizard: r.wizard !== null,
    scheduleType: r.scheduleType as Campaign['scheduleType'],
    sendDate: r.sendDate,
    sendTime: r.sendTime ? r.sendTime.slice(0, 5) : null,
    timezone: r.timezone,
    repeatInterval: r.repeatInterval as Campaign['repeatInterval'],
    expiresAt: r.expiresAt?.toISOString() ?? null,
    templateId: r.templateUuid,
    templateName: r.templateName,
    counts: {
      recipients: r.totalRecipients || r.counts.total,
      sent: r.counts.sent,
      delivered: r.counts.delivered,
      read: r.counts.read,
      replies: r.counts.responded,
      clicks: effectiveClicks(r.counts.clicked, r.metaClickedCount),
      failed: r.counts.failed,
    },
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    rowVersion: r.rowVersion,
  };
}

/** The whole configuration for the edit form. The three encrypted texts arrive already decrypted. */
export function toConfig(
  r: CampaignRow,
  extra: {
    senderKey: string | null;
    customMessage: string | null;
    customMessageB: string | null;
    customHeader: string | null;
    customFooter: string | null;
    mediaUrl: string | null;
    expiresAtLocal: string | null;
    recipientContactIds: string[];
  },
): CampaignConfig {
  return {
    ...toCampaign(r),
    senderKey: extra.senderKey,
    abSplit: r.abSplit,
    customMessage: extra.customMessage,
    customMessageB: extra.customMessageB,
    customHeader: extra.customHeader,
    customFooter: extra.customFooter,
    customButtons: r.customButtons,
    customQuickReplies: r.customQuickReplies,
    variableMap: r.variableMap,
    mediaUrl: extra.mediaUrl,
    templateIdA: r.templateAUuid,
    templateIdB: r.templateBUuid,
    templateOverrides: r.templateOverrides,
    templateOverridesB: r.templateOverridesB,
    flowId: r.flowUuid,
    flowIdB: r.flowBUuid,
    useAttributes: r.useAttributes,
    trackingEnabled: r.trackingEnabled,
    expiresAtLocal: extra.expiresAtLocal,
    repeatUntil: r.repeatUntil,
    throttleMinSec: r.throttleMinSec,
    throttleMaxSec: r.throttleMaxSec,
    batchSize: r.batchSize,
    batchPauseMin: r.batchPauseMin,
    dailyLimit: r.dailyLimit,
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    recipientContactIds: extra.recipientContactIds,
  };
}
