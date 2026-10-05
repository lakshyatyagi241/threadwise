import type {
  MarketAppStatus,
  MarketHealth,
  MarketRequestStatus,
  MarketVersionStatus,
} from '@crm/contracts';

/** The tones `Badge` offers. */
export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger';

/** A listing: only `published` is live; `in_review` waits for a decision; `killed` is the emergency stop. */
export const APP_STATUS_TONE: Record<MarketAppStatus, ChipTone> = {
  draft: 'neutral',
  in_review: 'warning',
  published: 'success',
  hidden: 'neutral',
  killed: 'danger',
};

export const VERSION_STATUS_TONE: Record<MarketVersionStatus, ChipTone> = {
  draft: 'neutral',
  in_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  published: 'success',
  retired: 'neutral',
};

export const REQUEST_STATUS_TONE: Record<MarketRequestStatus, ChipTone> = {
  open: 'neutral',
  planned: 'warning',
  building: 'warning',
  shipped: 'success',
  declined: 'danger',
};

export const HEALTH_TONE: Record<MarketHealth, ChipTone> = {
  unknown: 'neutral',
  healthy: 'success',
  degraded: 'warning',
  error: 'danger',
  needs_reauth: 'danger',
};

export const appStatusTone = (s: MarketAppStatus): ChipTone => APP_STATUS_TONE[s];
export const versionStatusTone = (s: MarketVersionStatus): ChipTone => VERSION_STATUS_TONE[s];
export const requestStatusTone = (s: MarketRequestStatus): ChipTone => REQUEST_STATUS_TONE[s];
