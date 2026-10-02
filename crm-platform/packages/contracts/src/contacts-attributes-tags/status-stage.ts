/**
 * A contact's Status is a sub-state of its Lifecycle stage: a status option may be scoped to one stage (status_options.
 * stage_option_id) or be unscoped, which means valid in every stage. These two rules are shared by the API (which enforces
 * them on contact writes) and the web app (which offers only valid statuses and previews a reset), so both always agree.
 */

/** A contact status option reduced to what the rules read; `stageValue` is the `lifecycle_stage` value it is scoped to. */
export interface StatusScopeRule {
  value: string;
  /** The lifecycle stage value the status is scoped to; null = valid in every stage. */
  stageValue: string | null;
  isDefault: boolean;
  isActive: boolean;
}

/**
 * Whether `status` may sit on a contact in `stage`. No status is always fine; so is a value the workspace has no option for
 * (a free-text status from an import, a deleted option) and any unscoped option. Only a status that is scoped, and only to
 * other stages, is invalid: a workspace that never scopes a status never sees one invalidated.
 */
export function isStatusValidForStage(
  scope: readonly StatusScopeRule[],
  status: string | null | undefined,
  stage: string,
): boolean {
  if (status === null || status === undefined || status === '') return true;
  const options = scope.filter((o) => o.value === status);
  if (options.length === 0) return true;
  return options.some((o) => o.stageValue === null || o.stageValue === stage);
}

/** The status a contact gets when it enters `stage` without a valid one: that stage's active default, else null. */
export function defaultStatusForStage(
  scope: readonly StatusScopeRule[],
  stage: string,
): string | null {
  return scope.find((o) => o.stageValue === stage && o.isDefault && o.isActive)?.value ?? null;
}

/**
 * What a stage move does to the status the contact holds (the same rule the API applies): a status that is still valid for
 * the new stage stays; one that is not (or none at all) is replaced by the new stage's default status, or cleared when the
 * stage has none. `changed` is false when nothing happens.
 */
export function statusAfterStageMove(
  scope: readonly StatusScopeRule[],
  current: string | null,
  nextStage: string,
): { status: string | null; changed: boolean } {
  if (current !== null && isStatusValidForStage(scope, current, nextStage)) {
    return { status: current, changed: false };
  }
  const fallback = defaultStatusForStage(scope, nextStage);
  return { status: fallback, changed: fallback !== current };
}
