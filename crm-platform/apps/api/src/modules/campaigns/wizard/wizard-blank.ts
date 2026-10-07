import type { NewCampaign } from '../campaigns.repository';

/** What the new campaign row needs for the columns the wizard does not care about yet (the launch fills the real ones in). */
export const blankCampaignFor = (o: {
  name: string;
  provider: string;
  deviceId: number | null;
  templateId: number | null;
  createdBy: number | null;
}): NewCampaign => ({
  name: o.name,
  type: 'template',
  status: 'draft',
  provider: o.provider,
  deviceId: o.deviceId,
  abTesting: false,
  abSplit: 50,
  customMessage: null,
  customMessageB: null,
  customHeader: null,
  customFooter: null,
  customButtons: null,
  customQuickReplies: null,
  variableMap: null,
  customImage: null,
  customVideo: null,
  customDocument: null,
  templateId: o.templateId,
  templateIdA: null,
  templateIdB: null,
  templateOverrides: null,
  templateOverridesB: null,
  flowId: null,
  flowIdB: null,
  useAttributes: false,
  trackingEnabled: true,
  scheduleType: 'now',
  sendDate: null,
  sendTime: null,
  timezone: 'UTC',
  repeatInterval: null,
  repeatUntil: null,
  expiresAt: null,
  throttleMinSec: null,
  throttleMaxSec: null,
  batchSize: null,
  batchPauseMin: null,
  dailyLimit: null,
  windowStart: null,
  windowEnd: null,
  totalRecipients: 0,
  createdBy: o.createdBy,
});
