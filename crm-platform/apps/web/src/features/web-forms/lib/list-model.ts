import type { FormStatus, FormSummary } from './types';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export const STATUS_TONE: Record<FormStatus, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  paused: 'warning',
  archived: 'neutral',
};

/** The views above the list. `all` hides archived forms (the server does too unless asked). */
export const LIST_VIEWS = ['all', 'published', 'draft', 'paused', 'archived'] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export const isListView = (v: string | null): v is ListView =>
  v !== null && (LIST_VIEWS as readonly string[]).includes(v);

export function filtersForView(
  view: ListView,
  q: string,
): {
  status?: FormStatus;
  q?: string;
  includeArchived?: boolean;
} {
  const query = q.trim();
  return {
    ...(view !== 'all' ? { status: view } : {}),
    ...(query ? { q: query } : {}),
  };
}

/** Submissions as a share of views, one decimal, or null before the form has any view (a rate of nothing is not 0%). */
export function conversionRate(f: Pick<FormSummary, 'views' | 'submissions'>): number | null {
  if (f.views <= 0) return null;
  return Math.min(100, Math.round((f.submissions / f.views) * 1000) / 10);
}

export type RowAction =
  | 'edit'
  | 'submissions'
  | 'copyLink'
  | 'embed'
  | 'duplicate'
  | 'pause'
  | 'resume'
  | 'restore'
  | 'archive'
  | 'delete';

/** Which row actions apply in each status (the API refuses the rest with FORMS_STATE_INVALID; this keeps them out of the menu). */
export function rowActions(status: FormStatus): RowAction[] {
  switch (status) {
    case 'draft':
      return ['edit', 'submissions', 'duplicate', 'archive', 'delete'];
    case 'published':
      return ['edit', 'submissions', 'copyLink', 'embed', 'duplicate', 'pause', 'archive'];
    case 'paused':
      return ['edit', 'submissions', 'copyLink', 'embed', 'duplicate', 'resume', 'archive'];
    case 'archived':
      return ['submissions', 'duplicate', 'restore', 'delete'];
  }
}

/** Whole-number total across the loaded rows, for the stats strip. */
export function totals(rows: readonly FormSummary[]): {
  forms: number;
  published: number;
  submissions: number;
  needsReview: number;
} {
  return rows.reduce(
    (t, f) => ({
      forms: t.forms + 1,
      published: t.published + (f.status === 'published' ? 1 : 0),
      submissions: t.submissions + f.submissions,
      needsReview: t.needsReview + f.needsReview,
    }),
    { forms: 0, published: 0, submissions: 0, needsReview: 0 },
  );
}

/** "3 minutes ago" in the app's language; the exact time goes in a `title`. */
export function relativeTime(
  iso: string | null,
  locale: string,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.round((then - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(seconds, 'second');
}

export const MAX_NAME = 120;

/** Name to propose for a new form: a template's name, or "Untitled form" in the app's language. */
export function suggestedName(template: { name: string } | null, fallback: string): string {
  return (template?.name ?? fallback).slice(0, MAX_NAME);
}
