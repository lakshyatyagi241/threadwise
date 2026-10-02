import { HttpStatus } from '@nestjs/common';
import {
  defaultStatusForStage,
  ERROR_CODES,
  isStatusValidForStage,
  type StatusScopeRule,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/**
 * Lifecycle stage and contact status, linked lightly (status_options.stage_option_id).
 *
 * The stage says where the person is in the sales journey; the status is a sub-state inside it. A status option may be scoped
 * to one stage (it then belongs to that stage only) or be unscoped (valid in every stage, which is every status of a workspace
 * that never used scoping). A contact therefore holds either no status or one that is valid for its stage; the rules below keep
 * it that way. Pure functions, no database: `ContactsRepository.statusContext` loads the rows.
 */

/** One status option of the contact status groups, with the stage it is scoped to (by the stage's value), if any. */
export interface StatusScopeOption extends StatusScopeRule {
  label: string;
  stageLabel: string | null;
}

/** Every status option of the workspace (groups `status` and `contact_status`). Empty = nothing is configured. */
export type StatusScope = readonly StatusScopeOption[];

// The two rules live in @crm/contracts so the web app applies exactly the same ones.
export { defaultStatusForStage, isStatusValidForStage };

/** The stage a status is tied to, when it is scoped (for the error message). */
function scopedTo(scope: StatusScope, status: string): StatusScopeOption | undefined {
  return scope.find((o) => o.value === status && o.stageValue !== null);
}

export function statusStageMismatch(
  scope: StatusScope,
  status: string,
  stage: string,
  stageLabel: string | null,
): AppError {
  const opt = scopedTo(scope, status);
  const own = stageLabel ?? stage;
  const belongs = opt?.stageLabel ?? opt?.stageValue ?? '';
  const message = `Status "${opt?.label ?? status}" belongs to the "${belongs}" stage and cannot be set on a contact in the "${own}" stage.`;
  return new AppError(
    ERROR_CODES.CON_STATUS_STAGE_MISMATCH,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'status', message }],
  );
}

export interface StatusPlan {
  /** The contact's status after the write: `undefined` = leave the column alone. */
  status: string | null | undefined;
  /** True when the status was changed by the stage rather than by the caller. */
  reset: boolean;
}

/**
 * What happens to the status of a contact that is created, updated or bulk-updated.
 *
 * - `stage`: the contact's stage after the write; `stageChanged` is true for a create and for a move to another stage.
 * - `current`: the status it holds now (null for a create).
 * - `requested`: what the caller sent (`undefined` = not sent, `null` / '' = clear it).
 *
 * A status the caller sets (different from the current one) must be valid for the stage, else 422 CON_STATUS_STAGE_MISMATCH.
 * A status sent unchanged is "not sent": a form that posts every field must not fail on a contact whose status predates the
 * scoping. When the stage changed and no status is set, a status that is not valid for the new stage (or none at all) is
 * replaced by the new stage's default, or cleared when the stage has none: the contact enters a stage with a valid status or
 * with none. A status that is still valid is kept, so unscoped statuses never move.
 */
export function planStatus(args: {
  scope: StatusScope;
  stage: string;
  stageLabel: string | null;
  stageChanged: boolean;
  current: string | null;
  requested: string | null | undefined;
}): StatusPlan {
  const { scope, stage, current, requested } = args;

  if (requested !== undefined && requested !== current) {
    if (requested !== null && !isStatusValidForStage(scope, requested, stage)) {
      throw statusStageMismatch(scope, requested, stage, args.stageLabel);
    }
    return { status: requested, reset: false };
  }

  if (!args.stageChanged) return { status: undefined, reset: false };

  const keep = current !== null && isStatusValidForStage(scope, current, stage);
  if (keep) return { status: undefined, reset: false };

  const fallback = defaultStatusForStage(scope, stage);
  if (current === null && fallback === null) return { status: undefined, reset: false };
  return { status: fallback, reset: fallback !== current };
}
