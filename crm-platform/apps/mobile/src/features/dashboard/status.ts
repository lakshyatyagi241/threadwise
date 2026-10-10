import type { BadgeTone } from '@/components/ui/badge';

/** Reference's many campaign statuses folded into the five the person reads: the words are translated once for each group. */
export type CampaignStatus = 'sending' | 'scheduled' | 'paused' | 'failed' | 'completed';

const CAMPAIGN: Record<string, CampaignStatus> = {
  processing: 'sending',
  sending: 'sending',
  running: 'sending',
  active: 'sending',
  scheduled: 'scheduled',
  pending: 'scheduled',
  queued: 'scheduled',
  paused: 'paused',
  cancelled: 'paused',
  failed: 'failed',
  completed: 'completed',
  completed_with_errors: 'completed',
  done: 'completed',
  sent: 'completed',
};

/** `null` for a status the app does not know: the card then shows the raw word rather than hiding it. */
export const campaignStatus = (status: string): CampaignStatus | null => CAMPAIGN[status] ?? null;

export const CAMPAIGN_TONE: Record<CampaignStatus, BadgeTone> = {
  sending: 'success',
  scheduled: 'warning',
  paused: 'danger',
  failed: 'danger',
  completed: 'neutral',
};

export type TemplateStatus = 'approved' | 'inReview' | 'rejected';

const TEMPLATE: Record<string, TemplateStatus> = {
  approved: 'approved',
  public: 'approved',
  active: 'approved',
  pending: 'inReview',
  submitted: 'inReview',
  in_review: 'inReview',
  rejected: 'rejected',
  disabled: 'rejected',
};

export const templateStatus = (status: string): TemplateStatus | null => TEMPLATE[status] ?? null;

export const TEMPLATE_TONE: Record<TemplateStatus, BadgeTone> = {
  approved: 'success',
  inReview: 'warning',
  rejected: 'danger',
};
