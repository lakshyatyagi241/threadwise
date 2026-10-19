import {
  wizardStepIssues,
  type WizardAudienceCount,
  type WizardCreditCheck,
  type WizardDraft,
  type WizardIssue,
} from '@crm/contracts';
import type { WizardView } from './state';

/** The contract's issue codes plus the few only the screen can see (an empty date box, the wallet, a zero audience). */
export type IssueCode =
  | WizardIssue['code']
  | 'schedule_required'
  | 'no_recipients'
  | 'insufficient_balance'
  | 'checking_balance'
  | 'balance_unavailable';

export interface StepIssue {
  path: string;
  code: IssueCode;
}

export interface IssueContext {
  slots: readonly string[];
  /** Variant B's placeholders (an A/B test). */
  slotsB?: readonly string[];
  /** The placeholders of each template of the sequence, in order. */
  slotsSequence?: ReadonlyArray<readonly string[]>;
  now: Date;
  /** The live count of step 2 (null until it answers). */
  count?: Pick<WizardAudienceCount, 'recipients'> | null;
  /** The wallet check of step 3 (null until it answers); `pending` while it is being asked. */
  credit?: Pick<WizardCreditCheck, 'sufficient' | 'recipients'> | null;
  creditPending?: boolean;
  /** The wallet check could not be done: the balance is unknown, so the broadcast does not go on. */
  creditFailed?: boolean;
}

/** The step a draft path belongs to (also how the launch's `errors[].path` finds the screen to open). */
export function stepOfPath(path: string): WizardView {
  const head = path.split('.')[0];
  if (head === 'name' || head === 'templateId' || head === 'templateIdB' || head === 'senderKey')
    return 1;
  if (head === 'audience') return 2;
  if (head === 'variables' || head === 'variablesB') return 3;
  // A sequence template's mapping is read with the other mappings (step 3); the template itself and the list belong to step 4.
  if (head === 'templateSequence' && path.split('.')[2] === 'variables') return 3;
  // 'followUps' (and 'followUps.<i>.action') belong to step 4 with the schedule and retries.
  return 4;
}

/** Date and time boxes the person cleared: the contract's check cannot see an empty text. */
function scheduleIncomplete(draft: WizardDraft): StepIssue[] {
  const s = draft.schedule;
  if (s.mode === 'scheduled') {
    return s.date && s.time && s.timezone
      ? []
      : [{ path: 'schedule.date', code: 'schedule_required' }];
  }
  if (s.mode === 'recurring') {
    return s.rule.startDate && s.rule.timeOfDay
      ? []
      : [{ path: 'schedule.rule.startDate', code: 'schedule_required' }];
  }
  return [];
}

/**
 * What stops a step: the shared validation (`wizardStepIssues`) plus what only the screen knows. An empty list means Next is open.
 * A zone name the runtime does not know makes the shared check throw; that is reported as an incomplete schedule.
 */
export function stepIssues(step: WizardView, draft: WizardDraft, ctx: IssueContext): StepIssue[] {
  let shared: StepIssue[] = [];
  const incomplete = step === 4 ? scheduleIncomplete(draft) : [];
  if (incomplete.length === 0) {
    try {
      shared = wizardStepIssues(step, draft, {
        slots: ctx.slots,
        slotsB: ctx.slotsB ?? [],
        slotsSequence: ctx.slotsSequence ?? [],
        now: ctx.now,
      });
    } catch {
      shared = [{ path: 'schedule', code: 'schedule_required' }];
    }
  }
  const out: StepIssue[] = [...incomplete, ...shared];
  if (step === 2 && ctx.count && ctx.count.recipients === 0 && shared.length === 0) {
    out.push({ path: 'audience', code: 'no_recipients' });
  }
  if (step === 3) {
    if (ctx.creditPending) out.push({ path: 'credit', code: 'checking_balance' });
    else if (ctx.creditFailed) out.push({ path: 'credit', code: 'balance_unavailable' });
    else if (ctx.credit) {
      if (ctx.credit.recipients === 0) out.push({ path: 'audience', code: 'no_recipients' });
      else if (!ctx.credit.sufficient) out.push({ path: 'credit', code: 'insufficient_balance' });
    }
  }
  return out;
}

export const unmappedSlots = (issues: readonly StepIssue[]): string[] =>
  issues
    .filter((i) => i.code === 'variable_unmapped')
    .map((i) => i.path.replace(/^variables\./, ''));

export const issueFor = (issues: readonly StepIssue[], path: string): StepIssue | undefined =>
  issues.find((i) => i.path === path);

/**
 * The issues of one sequence template's mapping, with the path rewritten to `variables.<slot>` so the entry's variables card reads them
 * as it reads the draft's own.
 */
export const sequenceMappingIssues = (issues: readonly StepIssue[], index: number): StepIssue[] =>
  issues
    .filter((i) => i.path.startsWith(`templateSequence.${index}.variables.`))
    .map((i) => ({
      ...i,
      path: i.path.replace(`templateSequence.${index}.variables.`, 'variables.'),
    }));
