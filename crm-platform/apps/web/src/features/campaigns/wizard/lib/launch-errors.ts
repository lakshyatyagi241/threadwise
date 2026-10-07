import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { stepOfPath } from './issues';
import type { WizardView } from './state';

export type LaunchFailure =
  /** The wallet cannot cover it: show the balance state, go to step 3. */
  | { kind: 'wallet'; step: 3 }
  /** The draft is incomplete: `steps` own the problems (the first is opened), `codes` are the issue codes. */
  | {
      kind: 'incomplete';
      step: WizardView;
      steps: WizardView[];
      issues: Array<{ path: string; code: string }>;
    }
  /** The contacts, the template or its number failed the eligibility check at the launch: show the check again on step 3. */
  | { kind: 'eligibility'; step: 3; groups: Array<'contacts' | 'template'> }
  /** The draft changed elsewhere (409): reload it. */
  | { kind: 'conflict' }
  /** Already launched. */
  | { kind: 'launched' }
  | { kind: 'other'; message: string; requestId?: string };

/** Reads a failed launch by its stable `code` (never its text) into what the wizard does next. */
export function classifyLaunchError(e: unknown): LaunchFailure {
  if (!(e instanceof ApiError))
    return { kind: 'other', message: e instanceof Error ? e.message : '' };
  if (e.isRowVersionConflict) return { kind: 'conflict' };
  if (e.code === ERROR_CODES.CAMP_WIZARD_LAUNCHED) return { kind: 'launched' };
  if (e.code === ERROR_CODES.WALLET_EMPTY) return { kind: 'wallet', step: 3 };
  if (e.code === ERROR_CODES.CAMP_WIZARD_INCOMPLETE) {
    const issues = e.fieldErrors.map((f) => ({ path: f.path, code: f.message }));
    const steps = [...new Set(issues.map((i) => stepOfPath(i.path)))].sort(
      (a, b) => a - b,
    ) as WizardView[];
    return { kind: 'incomplete', step: steps[0] ?? 1, steps, issues };
  }
  if (
    e.code === ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED ||
    e.code === ERROR_CODES.CAMP_NO_RECIPIENTS
  ) {
    const groups = [
      ...new Set(
        e.fieldErrors.flatMap((f) =>
          f.path === 'eligibility.contacts'
            ? ['contacts' as const]
            : f.path === 'eligibility.template'
              ? ['template' as const]
              : [],
        ),
      ),
    ];
    if (groups.length > 0) return { kind: 'eligibility', step: 3, groups };
  }
  return { kind: 'other', message: e.message, requestId: e.requestId };
}
