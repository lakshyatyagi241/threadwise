import type { WizardDraft } from '@crm/contracts';
import { localDateTimeToUtc } from '../campaign-rules';
import type { NewCampaign } from '../campaigns.repository';

/** What the new campaign row needs for the columns the wizard does not care about yet (the launch fills the real ones in). */
export const blankCampaignFor = (o: {
  name: string;
  provider: string;
  deviceId: number | null;
  templateId: number | null;
  createdBy: number | null;
  /** What the campaign builder's options set (see `campaignColumnsOf`). */
  extra?: Partial<NewCampaign>;
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
  retryFailed: true,
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
  ...o.extra,
});

/** The classic campaign columns a guided draft's builder options map to: A/B, link tracking, auto-end and Smart Delivery. */
export type CampaignOptionColumns = Pick<
  NewCampaign,
  | 'abTesting'
  | 'abSplit'
  | 'templateIdB'
  | 'trackingEnabled'
  | 'retryFailed'
  | 'expiresAt'
  | 'throttleMinSec'
  | 'throttleMaxSec'
  | 'batchSize'
  | 'batchPauseMin'
  | 'dailyLimit'
  | 'windowStart'
  | 'windowEnd'
> & {
  /** How many follow-up steps the draft has (0 to 3); the worker only looks at campaigns that have some. */
  followUpCount: number;
};

/**
 * The same columns the classic create endpoint writes for these options (so the dispatcher, the pacing and the end-date sweep
 * treat a guided campaign exactly like a classic one). `templateIdB` is variant B's template id, resolved by the caller.
 */
export function campaignColumnsOf(
  draft: WizardDraft,
  templateIdB: number | null,
): CampaignOptionColumns {
  const p = draft.pacing;
  const ab = draft.abTesting && templateIdB !== null;
  return {
    abTesting: ab,
    abSplit: draft.abSplit,
    templateIdB: ab ? templateIdB : null,
    trackingEnabled: draft.trackLinks,
    retryFailed: draft.retryFailed,
    expiresAt: draft.autoEnd ? localDateTimeToUtc(draft.autoEnd.at, draft.autoEnd.timezone) : null,
    throttleMinSec: p.throttleMinSec ?? null,
    throttleMaxSec: p.throttleMaxSec ?? null,
    batchSize: p.batchSize ?? null,
    batchPauseMin: p.batchPauseMin ?? null,
    dailyLimit: p.dailyLimit ?? null,
    windowStart: p.windowStart ?? null,
    windowEnd: p.windowEnd ?? null,
    followUpCount: draft.followUps.length,
  };
}
