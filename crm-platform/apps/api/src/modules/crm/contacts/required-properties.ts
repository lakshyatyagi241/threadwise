import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/** One property marked required in the registry (`/v2/fields`), with the conditions that make it apply. */
export interface RequiredRule {
  key: string;
  label: string;
  /** All must hold for the property to be required: the property it depends on holds this value. */
  conditions: Array<{ parentKey: string; wanted: string | null }>;
}

/** A value that does not count as an answer: nothing, blank text, an empty list. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The values a (possibly multi-valued) property holds, as strings, for matching a dependency's wanted value. */
function held(value: unknown): string[] {
  if (isBlank(value)) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v) => typeof v !== 'object' || v === null).map(String);
}

/**
 * Whether a rule applies to this data. A dependent property is only required when every one of its conditions holds,
 * the same test the contact form uses to show it (`isFieldApplicable` in apps/web). A condition that names no value
 * can never hold, so that property is never required.
 */
export function ruleApplies(rule: RequiredRule, data: Record<string, unknown>): boolean {
  return rule.conditions.every(
    (c) => c.wanted !== null && held(data[c.parentKey]).includes(c.wanted),
  );
}

/**
 * The rules the data breaks, in registry order. With `only`, just those keys are checked (a partial edit may not blank
 * what it touches, but is not answerable for properties it did not mention).
 */
export function missingRequired(
  rules: readonly RequiredRule[],
  data: Record<string, unknown>,
  only?: ReadonlySet<string>,
): RequiredRule[] {
  return rules.filter(
    (r) => (!only || only.has(r.key)) && ruleApplies(r, data) && isBlank(data[r.key]),
  );
}

/**
 * Which required properties a PARTIAL edit answers for (the contact update path). A save is held to:
 *  - every property the request names (`sent`): the contact form sends all of its properties, so a form save still answers for all of
 *    them, and an inline edit of one property may not blank that property;
 *  - every property the edit itself makes required: a dependent whose condition held NOT before and holds now (picking "needs a visa:
 *    yes" makes "visa type" required).
 * It is NOT held to properties it never mentioned, so a contact that predates a newly required property (or never had a value for it)
 * still saves an unrelated inline edit such as the job title. Create answers for every rule (it does not use this).
 */
export function requiredScopeOfEdit(
  rules: readonly RequiredRule[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  sent: Iterable<string>,
): Set<string> {
  const scope = new Set<string>(sent);
  for (const r of rules) {
    if (!scope.has(r.key) && ruleApplies(r, after) && !ruleApplies(r, before)) scope.add(r.key);
  }
  return scope;
}

/** 422 CON_REQUIRED_PROPERTY_MISSING naming every missing key (`customFields.<key>`), so a form can mark each field. */
export function requiredPropertiesError(missing: readonly RequiredRule[]): AppError {
  return new AppError(
    ERROR_CODES.CON_REQUIRED_PROPERTY_MISSING,
    `Required properties are missing: ${missing.map((m) => m.label).join(', ')}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    missing.map((m) => ({ path: `customFields.${m.key}`, message: 'required' })),
  );
}
