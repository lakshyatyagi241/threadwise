import { lifecycleStageSchema, type StatusOptionResponse } from '@crm/contracts';
import { FALLBACK_STATUSES, titleCaseKey } from './contact-model';
import { effectiveStage, isStatusAllowedInStage } from './status-scope';

export interface Choice {
  value: string;
  label: string;
  /** The workspace's colour for the option (hex), when one is set. */
  color?: string;
  /** Lifecycle stages only: what the admin flagged (Contact stages screen). */
  isWon?: boolean;
  isLost?: boolean;
}

const active = (o: StatusOptionResponse) => o.isActive;

function fromGroup(
  options: readonly StatusOptionResponse[] | undefined,
  groups: readonly string[],
) {
  return (options ?? [])
    .filter((o) => active(o) && groups.includes(o.optionGroup))
    .sort((a, b) => a.position - b.position)
    .map((o) => ({
      value: o.value,
      label: o.label,
      ...(o.color ? { color: o.color } : {}),
      ...(o.isWon ? { isWon: true } : {}),
      ...(o.isLost ? { isLost: true } : {}),
    }));
}

/**
 * Lifecycle stages: the workspace's configured `lifecycle_stage` options when there are any, otherwise the platform
 * defaults. A stage the contact already has but the list lacks (an option was removed) is kept so the select can show it.
 */
export function stageChoices(
  options: readonly StatusOptionResponse[] | undefined,
  current?: string,
): Choice[] {
  const configured = fromGroup(options, ['lifecycle_stage']);
  const base = configured.length
    ? configured
    : lifecycleStageSchema.options.map((v) => ({ value: v, label: titleCaseKey(v) }));
  return withCurrent(base, current);
}

/**
 * Contact status: configured `status` / `contact_status` options, otherwise WaDesk's four. With `stage` only the statuses
 * valid for that stage are offered (the unscoped ones and those scoped to it); without it, every status (filters, import).
 * An empty `stage` means "the workspace default stage", as on the contact form.
 */
export function statusChoices(
  options: readonly StatusOptionResponse[] | undefined,
  fallbackLabel: (value: string) => string,
  current?: string,
  stage?: string,
): Choice[] {
  const inStage = stage === undefined ? undefined : effectiveStage(options, stage);
  const configured = fromGroup(options, ['status', 'contact_status']);
  // A workspace that configured statuses is never shown the platform's four, even when none fits the stage.
  const base = configured.length
    ? configured.filter(
        (c) => inStage === undefined || isStatusAllowedInStage(options, c.value, inStage),
      )
    : FALLBACK_STATUSES.map((v) => ({ value: v, label: fallbackLabel(v) }));
  return withCurrent(base, current);
}

function withCurrent(base: Choice[], current?: string): Choice[] {
  if (!current || base.some((c) => c.value === current)) return base;
  return [...base, { value: current, label: titleCaseKey(current) }];
}

/** Label for a stage value in badges and the detail page. */
export function stageLabel(
  options: readonly StatusOptionResponse[] | undefined,
  value: string,
): string {
  return stageChoices(options).find((c) => c.value === value)?.label ?? titleCaseKey(value);
}
