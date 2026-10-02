import type { TplMetaCategory, TplStatus } from '@crm/contracts';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/** Order of the status filter and the legend. `deleted` is a row Meta no longer lists (kept after a sync). */
export const STATUSES: readonly TplStatus[] = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
  'deleted',
];

export const CATEGORIES: readonly TplMetaCategory[] = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

const STATUS_TONE: Record<TplStatus, Tone> = {
  draft: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paused: 'warning',
  disabled: 'danger',
  deleted: 'neutral',
};

export const statusTone = (s: TplStatus): Tone => STATUS_TONE[s];

export function categoryTone(c: TplMetaCategory | null): Tone {
  if (c === 'MARKETING') return 'warning';
  if (c === 'UTILITY') return 'success';
  return 'neutral';
}

/** Meta's quality score: GREEN good, YELLOW at risk, RED blocks sends. UNKNOWN or empty is neutral. */
export function qualityTone(score: string | null): Tone {
  switch ((score ?? '').toUpperCase()) {
    case 'GREEN':
      return 'success';
    case 'YELLOW':
      return 'warning';
    case 'RED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Only a template Meta has not approved yet, or one it rejected, can be edited in place (TPL_NOT_EDITABLE). */
export const canEdit = (s: TplStatus): boolean =>
  s === 'draft' || s === 'pending' || s === 'rejected';

/** Retry submit: a draft that never reached Meta, or a rejected one after the fix. */
export const canSubmit = (s: TplStatus): boolean => s === 'draft' || s === 'rejected';

/** The detail page follows a template that is waiting for Meta's review. */
export const isAwaitingReview = (s: TplStatus): boolean => s === 'pending';

/** Refresh needs a template Meta knows about. A draft has never been sent. */
export const canRefresh = (s: TplStatus, metaTemplateId: string | null): boolean =>
  s !== 'draft' || metaTemplateId !== null;

/** The poll interval of the detail page while Meta reviews (TW-TPL-026). */
export const DETAIL_POLL_MS = 15_000;
