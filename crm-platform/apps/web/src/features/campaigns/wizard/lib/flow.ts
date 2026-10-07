import type { WizardDraft } from '@crm/contracts';
import { stepIssues, type IssueContext, type StepIssue } from './issues';
import { clampStep, type WizardView } from './state';

/** What the footer's primary button does at a step, given what stops it. */
export type NextDecision =
  { kind: 'blocked' } | { kind: 'launch' } | { kind: 'go'; step: WizardView };

export function decideNext(view: WizardView, issues: readonly StepIssue[]): NextDecision {
  if (issues.length > 0) return { kind: 'blocked' };
  return view === 4 ? { kind: 'launch' } : { kind: 'go', step: clampStep(view + 1) };
}

/** What Back does: one step down, never below the first. */
export const previousStep = (view: WizardView): WizardView => clampStep(view - 1);

export type Preflight =
  | { kind: 'ok' }
  /** `step` owns the first problem: the wizard opens it and shows `issues`. */
  | { kind: 'issues'; step: WizardView; issues: StepIssue[] };

/**
 * Every step is checked again before the confirm dialog: a resumed draft can have gone stale (a template deleted, a wallet that
 * moved). A step still waiting for the wallet check is not a problem of the draft.
 */
export function launchPreflight(draft: WizardDraft, ctx: IssueContext): Preflight {
  for (const step of [1, 2, 3, 4] as const) {
    const issues = stepIssues(step, draft, ctx).filter((i) => i.code !== 'checking_balance');
    if (issues.length > 0) return { kind: 'issues', step, issues };
  }
  return { kind: 'ok' };
}

/** A step that can be opened from the stepper: any step already reached. */
export const canOpenStep = (target: WizardView, reached: number): boolean => target <= reached;
