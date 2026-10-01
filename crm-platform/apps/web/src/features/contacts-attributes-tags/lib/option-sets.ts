import { lifecycleStageSchema, type StatusOptionResponse } from '@crm/contracts';
import { FALLBACK_STATUSES, titleCaseKey } from './contact-model';

export interface Choice {
  value: string;
  label: string;
  /** The workspace's colour for the option (hex), when one is set. */
  color?: string;
}

const active = (o: StatusOptionResponse) => o.isActive;

function fromGroup(
  options: readonly StatusOptionResponse[] | undefined,
  groups: readonly string[],
) {
  return (options ?? [])
    .filter((o) => active(o) && groups.includes(o.optionGroup))
    .sort((a, b) => a.position - b.position)
    .map((o) => ({ value: o.value, label: o.label, ...(o.color ? { color: o.color } : {}) }));
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

/** Contact status: configured `status` / `contact_status` options, otherwise Reference's four. */
export function statusChoices(
  options: readonly StatusOptionResponse[] | undefined,
  fallbackLabel: (value: string) => string,
  current?: string,
): Choice[] {
  const configured = fromGroup(options, ['status', 'contact_status']);
  const base = configured.length
    ? configured
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
