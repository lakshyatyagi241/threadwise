import {
  FORM_SUBMISSION_REASONS,
  FORM_SUBMISSION_STATUSES,
  type ExportFormSubmissionsInput,
  type FormAnswer,
  type FormSubmissionReason,
  type FormSubmissionStatus,
} from '@crm/contracts';
import type { SubmissionFilters } from '../api/forms';

/** Pure rules of the Submissions screen: what a status looks like, what a person may do with it, and how filters reach the API. */

export type SubmissionTab = 'all' | 'needs_attention' | 'spam';
export const SUBMISSION_TABS: readonly SubmissionTab[] = ['all', 'needs_attention', 'spam'];

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONES: Record<FormSubmissionStatus, BadgeTone> = {
  received: 'neutral',
  created: 'success',
  updated: 'success',
  needs_review: 'warning',
  awaiting_payment: 'warning',
  paid: 'success',
  failed: 'danger',
  spam: 'neutral',
};

/** Colour only reinforces the status word, which is always printed next to it. */
export function statusTone(status: FormSubmissionStatus): BadgeTone {
  return TONES[status];
}

export function isStatus(value: string | null | undefined): value is FormSubmissionStatus {
  return (FORM_SUBMISSION_STATUSES as readonly string[]).includes(value ?? '');
}

export function tabFromParam(value: string | null | undefined): SubmissionTab {
  return (SUBMISSION_TABS as readonly string[]).includes(value ?? '')
    ? (value as SubmissionTab)
    : 'all';
}

/** Whether the status is one that has a reason worth printing. */
export function hasReason(status: FormSubmissionStatus): boolean {
  return status === 'needs_review' || status === 'spam' || status === 'failed';
}

/** The message key of a reason code; a code this build does not know falls back to `unknown` rather than showing the raw code. */
export function reasonKey(
  reason: string | null | undefined,
): FormSubmissionReason | 'unknown' | null {
  if (!reason) return null;
  return (FORM_SUBMISSION_REASONS as readonly string[]).includes(reason)
    ? (reason as FormSubmissionReason)
    : 'unknown';
}

/**
 * Only a submission that waits on a person, broke, or was held as spam can be re-run, and only while its answers still exist. For a
 * spam one this is the "not spam" action: the API runs it through the CRM like any other.
 */
export function canRetry(status: FormSubmissionStatus, answersRemoved: boolean): boolean {
  return (status === 'needs_review' || status === 'failed' || status === 'spam') && !answersRemoved;
}

/** Erasing is for answers that still exist; the tombstone stays. */
export function canDelete(answersRemoved: boolean): boolean {
  return !answersRemoved;
}

export type AnswerView =
  { type: 'empty' } | { type: 'boolean'; value: boolean } | { type: 'text'; text: string };

/** What an answer shows as. The text is always rendered as text by the caller, never as markup. */
export function answerView(value: FormAnswer['value']): AnswerView {
  if (value === null || value === undefined) return { type: 'empty' };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (Array.isArray(value)) {
    return value.length === 0 ? { type: 'empty' } : { type: 'text', text: value.join(', ') };
  }
  if (typeof value === 'number') return { type: 'text', text: String(value) };
  return value.trim() === '' ? { type: 'empty' } : { type: 'text', text: value };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(day: string): [number, number, number] | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d);
  // Rejects 2026-02-31, which the Date constructor would roll into March.
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d
    ? [y, mo, d]
    : null;
}

/** `YYYY-MM-DD` from a date input to the start of that day in the browser's time zone, as an ISO datetime. */
export function startOfDayIso(day: string | null | undefined): string | undefined {
  const p = day ? parseDay(day) : null;
  return p ? new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).toISOString() : undefined;
}

/** The last millisecond of that day in the browser's time zone, so "to" includes the whole day. */
export function endOfDayIso(day: string | null | undefined): string | undefined {
  const p = day ? parseDay(day) : null;
  return p ? new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999).toISOString() : undefined;
}

export interface SubmissionView {
  tab: SubmissionTab;
  status: FormSubmissionStatus | '';
  q: string;
  /** `YYYY-MM-DD` as typed in the date inputs. */
  from: string;
  to: string;
}

export const EMPTY_VIEW: SubmissionView = { tab: 'all', status: '', q: '', from: '', to: '' };

export function viewFromParams(params: { get(name: string): string | null }): SubmissionView {
  const status = params.get('status');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return {
    tab: tabFromParam(params.get('tab')),
    status: isStatus(status) ? status : '',
    q: params.get('q') ?? '',
    from: parseDay(from) ? from : '',
    to: parseDay(to) ? to : '',
  };
}

/** Only what differs from the default goes in the URL, so a clean view has a clean link. */
export function viewToParams(view: SubmissionView): URLSearchParams {
  const p = new URLSearchParams();
  if (view.tab !== 'all') p.set('tab', view.tab);
  if (view.status) p.set('status', view.status);
  if (view.q.trim()) p.set('q', view.q.trim());
  if (view.from) p.set('from', view.from);
  if (view.to) p.set('to', view.to);
  return p;
}

export function isFiltered(view: SubmissionView): boolean {
  return view.tab !== 'all' || !!view.status || !!view.q.trim() || !!view.from || !!view.to;
}

/** The list query for a view. The `all` tab sends no `tab` at all. */
export function listFilters(view: SubmissionView): SubmissionFilters {
  const from = startOfDayIso(view.from);
  const to = endOfDayIso(view.to);
  return {
    ...(view.tab !== 'all' ? { tab: view.tab } : {}),
    ...(view.status ? { status: view.status } : {}),
    ...(view.q.trim() ? { q: view.q.trim() } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

/**
 * The export takes a status, a range and a contact, not a search or the "needs attention" group (two statuses). The spam tab is
 * exactly the `spam` status, so it exports; "needs attention" without a status cannot be expressed, and is not offered.
 */
export function exportInput(view: SubmissionView): ExportFormSubmissionsInput | null {
  if (view.tab === 'needs_attention' && !view.status) return null;
  const status = view.status || (view.tab === 'spam' ? 'spam' : undefined);
  const from = startOfDayIso(view.from);
  const to = endOfDayIso(view.to);
  return {
    ...(status ? { status } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

/** A safe download name: the server's when it sent one (stripped of any path), else one made from the form's name. */
export function csvFileName(
  served: string | null | undefined,
  formName: string | null | undefined,
  today: Date = new Date(),
): string {
  const clean = (served ?? '').replace(/[\\/\0]/g, '').trim();
  if (clean) return clean.toLowerCase().endsWith('.csv') ? clean : `${clean}.csv`;
  const slug = (formName ?? '')
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${slug || 'form'}-submissions-${today.toISOString().slice(0, 10)}.csv`;
}
