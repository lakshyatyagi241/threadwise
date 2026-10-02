import {
  defaultStatusForStage,
  isStatusValidForStage,
  statusAfterStageMove,
  type StatusOptionResponse,
  type StatusScopeRule,
} from '@crm/contracts';
import { STAGE_GROUP, GROUP_ALIASES } from './stage-model';

/**
 * Lifecycle stage and contact status, linked lightly. A status option may be scoped to one stage (`stageOptionId`); an
 * unscoped one is valid in every stage, which is what every status of a workspace that never used scoping is. The rules
 * themselves (`isStatusValidForStage`, `defaultStatusForStage`, `statusAfterStageMove`) live in @crm/contracts: the API
 * enforces them on every contact write and these helpers only mirror them so the screens offer valid choices and say what a
 * stage move will do. Pure functions, no React.
 */

const isStatusGroup = (o: StatusOptionResponse) => GROUP_ALIASES.status.includes(o.optionGroup);

/** The status options of the workspace as the rules read them (the stage a status is scoped to, by its value). */
export function statusScope(
  options: readonly StatusOptionResponse[] | undefined,
): StatusScopeRule[] {
  const all = options ?? [];
  const stageValueById = new Map(
    all.filter((o) => o.optionGroup === STAGE_GROUP).map((o) => [o.id, o.value]),
  );
  return all.filter(isStatusGroup).map((o) => ({
    value: o.value,
    stageValue: o.stageOptionId ? (stageValueById.get(o.stageOptionId) ?? null) : null,
    isDefault: o.isDefault,
    isActive: o.isActive,
  }));
}

/**
 * The stage a contact is really in for the rules: a form that left the stage on "workspace default" means the default
 * stage option, else the column default `new`.
 */
export function effectiveStage(
  options: readonly StatusOptionResponse[] | undefined,
  stage: string,
): string {
  if (stage) return stage;
  const def = (options ?? []).find(
    (o) => o.optionGroup === STAGE_GROUP && o.isDefault && o.isActive,
  );
  return def?.value ?? 'new';
}

/** Whether a status may be chosen for a contact in `stage` (false only for one scoped to other stages). */
export function isStatusAllowedInStage(
  options: readonly StatusOptionResponse[] | undefined,
  status: string,
  stage: string,
): boolean {
  return isStatusValidForStage(statusScope(options), status, stage);
}

/** True when at least one status of the workspace is scoped to a stage (the link is in use). */
export const hasScopedStatuses = (options: readonly StatusOptionResponse[] | undefined): boolean =>
  statusScope(options).some((o) => o.stageValue !== null);

export interface StatusMove {
  /** The status the contact will hold after the move (null = none). */
  status: string | null;
  /** True when the move replaces or clears the status the contact holds. */
  changed: boolean;
}

/** What moving a contact holding `current` into `nextStage` does to its status: the API's rule, for previews and forms. */
export function statusAfterMove(
  options: readonly StatusOptionResponse[] | undefined,
  current: string | null | undefined,
  nextStage: string,
): StatusMove {
  return statusAfterStageMove(statusScope(options), current || null, nextStage);
}

/** The default status of a stage, if the workspace set one. */
export const stageDefaultStatus = (
  options: readonly StatusOptionResponse[] | undefined,
  stage: string,
): string | null => defaultStatusForStage(statusScope(options), stage);

export type StatusNotice =
  | { kind: 'reset'; status: string }
  | { kind: 'set'; status: string }
  | { kind: 'cleared' }
  | { kind: 'none' };

/**
 * What to tell the person after a stage change was saved, from the status before and after (the server's answer, so the
 * message is always what really happened): a different status replaced the old one (`reset`), the stage's default filled an
 * empty status (`set`), the old one was cleared, or nothing.
 */
export function statusNotice(
  before: string | null | undefined,
  after: string | null | undefined,
): StatusNotice {
  const b = before || null;
  const a = after || null;
  if (a === b) return { kind: 'none' };
  if (a === null) return { kind: 'cleared' };
  return b === null ? { kind: 'set', status: a } : { kind: 'reset', status: a };
}
