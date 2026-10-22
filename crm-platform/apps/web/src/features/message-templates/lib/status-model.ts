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

/** The shapes the API can build and send again; a carousel or catalog imported from Meta is shown but not edited here. */
export const BUILDABLE_TYPES: readonly string[] = ['standard', 'media', 'auth'];

/**
 * Everything but a disabled template or one Meta no longer lists can be edited (TPL_NOT_EDITABLE): a draft, one in review or
 * rejected is saved over, a live (approved or paused) one is edited in place on Meta, as Reference does.
 */
export const canEdit = (s: TplStatus, templateType: string = 'standard'): boolean =>
  s !== 'disabled' && s !== 'deleted' && BUILDABLE_TYPES.includes(templateType);

/** An approved or paused template is edited in place on Meta: its name and language no longer change. */
export const isLive = (s: TplStatus, metaTemplateId: string | null): boolean =>
  (s === 'approved' || s === 'paused') && metaTemplateId !== null;

/**
 * An approved template keeps its name on Meta, so a copy is how its name changes: Duplicate opens a new template filled in from it,
 * named `<name>_copy`, which is saved and submitted as a template of its own.
 */
export const canDuplicate = (s: TplStatus, templateType: string = 'standard'): boolean =>
  s === 'approved' && BUILDABLE_TYPES.includes(templateType);

/** The library's status tabs (Reference's effective status): `all`, then the three groups the API filters on. */
export const STATUS_TABS = ['all', 'approved', 'pending', 'rejected'] as const;
export type StatusTab = (typeof STATUS_TABS)[number];

export const SORTS = ['newest', 'oldest', 'name-asc', 'name-desc'] as const;

/** The dot beside a status: green approved, amber in review, coral rejected; the tab a status counts under follows the API. */
export function statusGroupOf(s: TplStatus): Exclude<StatusTab, 'all'> | null {
  if (s === 'approved') return 'approved';
  if (s === 'pending' || s === 'draft') return 'pending';
  if (s === 'rejected' || s === 'paused' || s === 'disabled') return 'rejected';
  return null;
}

/** Meta's rejection codes that Reference explains in plain words; any other code falls back to Meta's own reason. */
export const REJECTION_CODES: readonly string[] = [
  'ABUSIVE_CONTENT',
  'INVALID_FORMAT',
  'PROMOTIONAL',
  'TAG_CONTENT_MISMATCH',
  'SCAM',
];

/** Retry submit: a draft that never reached Meta, or a rejected one after the fix. */
export const canSubmit = (s: TplStatus): boolean => s === 'draft' || s === 'rejected';

/** The detail page follows a template that is waiting for Meta's review. */
export const isAwaitingReview = (s: TplStatus): boolean => s === 'pending';

/** Refresh needs a template Meta knows about. A draft has never been sent. */
export const canRefresh = (s: TplStatus, metaTemplateId: string | null): boolean =>
  s !== 'draft' || metaTemplateId !== null;

/** The poll interval of the detail page while Meta reviews (TW-TPL-026). */
export const DETAIL_POLL_MS = 30_000;
