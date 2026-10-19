import type { CampaignAiGenerateResponse, PreviousSendOption } from '@crm/contracts';
import { problems, type BuilderForm, type ButtonRow, type Problem } from './builder-model';
import { EMPTY_PREVIOUS, previousEstimate } from './previous-sends';

/** The five steps of the campaign builder (TW-CAMP-002 to 010), in Reference's order. */
export const WIZARD_STEPS = ['setup', 'compose', 'recipients', 'schedule', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Which step each problem is fixed on, so "Next" can name what is missing and Review can send the person back to it. */
const STEP_OF: Record<Problem, WizardStep> = {
  name: 'setup',
  sender: 'setup',
  message: 'compose',
  template: 'compose',
  flow: 'compose',
  media: 'compose',
  subject: 'compose',
  audience: 'recipients',
  date: 'schedule',
  time: 'schedule',
  window: 'schedule',
  throttle: 'schedule',
  expiry: 'schedule',
};

export const stepOf = (p: Problem): WizardStep => STEP_OF[p];

/** What still stops a step from being passed. */
export const stepProblems = (f: BuilderForm, step: WizardStep, o: { draft?: boolean } = {}) =>
  problems(f, o).filter((p) => STEP_OF[p] === step);

/** The first step with a problem, or null when the whole form is ready. */
export function firstBrokenStep(f: BuilderForm): WizardStep | null {
  const all = problems(f);
  return WIZARD_STEPS.find((s) => all.some((p) => STEP_OF[p] === s)) ?? null;
}

/** The three ways Reference offers to pick who gets the campaign. Only one is shown at a time. */
export const RECIPIENT_MODES = ['audience', 'csv', 'manual'] as const;
export type RecipientMode = (typeof RECIPIENT_MODES)[number];

/** The mode an existing campaign opens on: the one that holds its recipients. */
export function initialRecipientMode(f: BuilderForm): RecipientMode {
  if (
    f.contactIds.length + f.groupIds.length + f.tagIds.length + f.segmentIds.length === 0 &&
    f.csvText.trim() !== ''
  )
    return 'csv';
  if (
    f.contactIds.length + f.groupIds.length + f.tagIds.length + f.segmentIds.length === 0 &&
    f.manualNumbers.trim() !== ''
  )
    return 'manual';
  return 'audience';
}

/** Switching mode drops what the other modes held, so the count on screen is what is sent. */
export function withRecipientMode(f: BuilderForm, mode: RecipientMode): Partial<BuilderForm> {
  const clear: Partial<BuilderForm> = {};
  if (mode !== 'audience')
    Object.assign(clear, { contactIds: [], groupIds: [], tagIds: [], segmentIds: [] });
  if (mode !== 'audience') clear.previousSends = EMPTY_PREVIOUS;
  if (mode !== 'csv') clear.csvText = '';
  if (mode !== 'manual') clear.manualNumbers = '';
  return clear;
}

/** Lines of numbers typed or pasted: one per line, or separated by commas or semicolons. */
export const countNumbers = (text: string): number =>
  text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '').length;

/** Data rows of an uploaded CSV (the header row is not a recipient). */
export const countCsvRows = (csv: string): number => {
  const rows = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  return Math.max(0, rows.length - 1);
};

export interface RecipientTotals {
  groups: number;
  contacts: number;
  numbers: number;
  /** Up to this many from the picked previous sends, for the chosen outcome (people in two sends count twice). */
  previous: number;
  total: number;
}

/**
 * The recipients as the review step counts them: members of the picked groups and tags, the individually picked contacts, and the
 * typed or uploaded numbers, plus what the picked previous sends held. An estimate (a contact in two groups is counted twice); the server de-duplicates when it builds the queue.
 */
export function recipientTotals(
  f: BuilderForm,
  sizes: {
    groups: Record<string, number>;
    tags: Record<string, number>;
    previous?: readonly PreviousSendOption[];
  },
): RecipientTotals {
  const groups =
    f.groupIds.reduce((n, id) => n + (sizes.groups[id] ?? 0), 0) +
    f.tagIds.reduce((n, id) => n + (sizes.tags[id] ?? 0), 0);
  const contacts = f.contactIds.length;
  const numbers = countNumbers(f.manualNumbers) + countCsvRows(f.csvText);
  const previous = previousEstimate(f.previousSends, sizes.previous ?? []);
  return { groups, contacts, numbers, previous, total: groups + contacts + numbers + previous };
}

const MAX_BUTTONS = 3;

/**
 * Pastes what "Build with AI" wrote into the builder: the name (only while it is still empty, so a name the person typed is kept),
 * the message, the footer, the call-to-action link and the quick replies (three buttons at most, the link first). The campaign is
 * a custom message from then on.
 */
export function applyAiCopy(
  f: BuilderForm,
  copy: CampaignAiGenerateResponse['campaign'],
): BuilderForm {
  const buttons: ButtonRow[] = [];
  if (copy.buttonText !== '' && copy.buttonUrl !== '')
    buttons.push({ type: 'url', text: copy.buttonText, value: copy.buttonUrl });
  for (const r of copy.quickReplies) {
    if (buttons.length >= MAX_BUTTONS) break;
    if (r.trim() !== '') buttons.push({ type: 'quick_reply', text: r, value: r });
  }
  return {
    ...f,
    type: 'custom',
    name: f.name.trim() === '' ? copy.campaignName : f.name,
    customMessage: copy.message,
    customFooter: copy.footer,
    buttons,
  };
}

/**
 * An email campaign sends only to contacts with an address; the others are stamped skipped when it runs. What the screen can tell:
 * the individually picked contacts whose address is empty (the list it loaded carries the address), and every typed or uploaded
 * number (no address). Groups, tags and segments are counted by the server when the queue is built, so they are not in `known`.
 */
export function emailSkipped(
  f: BuilderForm,
  contacts: readonly { id: string; email: string | null }[],
): { contacts: number; numbers: number; total: number } {
  const noAddress = new Set(contacts.filter((c) => (c.email ?? '').trim() === '').map((c) => c.id));
  const picked = f.contactIds.filter((id) => noAddress.has(id)).length;
  const numbers = countNumbers(f.manualNumbers) + countCsvRows(f.csvText);
  return { contacts: picked, numbers, total: picked + numbers };
}
