import { countryCodeDigits, type AssignmentConditions } from '@crm/contracts';

/** What the rules look at, gathered from the record (or from a test box). Pure input for `matchesAssignment`. */
export interface AssignmentFacts {
  source: string | null;
  countryCode: string | null;
  /** Digits of the phone number, no `+`, no spaces. */
  phoneDigits: string | null;
  lifecycleStage: string | null;
  /** Tag uuids the contact has. */
  tagIds: readonly string[];
  /** How it arrived: manual, import, inbound, form, lead, api. */
  origin: string;
  /** Custom property values by key, as text. */
  properties: Readonly<Record<string, string>>;
  pipelineId: string | null;
  value: number | null;
}

const ci = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
const anyOf = (list: readonly string[], v: string | null | undefined) =>
  list.length === 0 || list.some((x) => ci(x) === ci(v));

/** A country code is typed "+91", "91" or "0091" (and stored either way): two codes with the same digits are the same code. */
const sameCountryCode = (rule: string, v: string | null | undefined) => {
  const a = countryCodeDigits(rule);
  return ci(rule) === ci(v) || (a !== '' && a === countryCodeDigits(v));
};

/**
 * Every condition that is set holds (an unset one means "any"). Text is compared without case or surrounding spaces; `tagIds` needs ANY
 * of the listed tags; `properties` needs ALL of them to equal; a phone prefix is compared on digits, so `91` matches `+91 98...`.
 * A condition the subject does not use is simply never set by the API for it, so it cannot exclude by accident.
 */
export function matchesAssignment(c: AssignmentConditions, f: AssignmentFacts): boolean {
  if (!anyOf(c.sources, f.source)) return false;
  if (c.countryCodes.length > 0 && !c.countryCodes.some((x) => sameCountryCode(x, f.countryCode)))
    return false;
  if (c.phonePrefixes.length > 0) {
    const digits = f.phoneDigits ?? '';
    if (!c.phonePrefixes.some((p) => digits.startsWith(p))) return false;
  }
  if (!anyOf(c.lifecycleStages, f.lifecycleStage)) return false;
  if (c.tagIds.length > 0 && !c.tagIds.some((t) => f.tagIds.includes(t))) return false;
  if (c.origins.length > 0 && !(c.origins as readonly string[]).includes(f.origin)) return false;
  for (const p of c.properties) {
    if (ci(f.properties[p.key]) !== ci(p.equals)) return false;
  }
  if (
    c.pipelineIds.length > 0 &&
    (f.pipelineId === null || !c.pipelineIds.includes(f.pipelineId))
  ) {
    return false;
  }
  if (c.valueMin !== null && (f.value === null || f.value < c.valueMin)) return false;
  if (c.valueMax !== null && (f.value === null || f.value > c.valueMax)) return false;
  return true;
}

/** Candidates in the order the rule lists them (people first, then each team's members), without repeats. */
export function candidateOrder(
  userIds: readonly number[],
  teamMemberIds: readonly number[],
): number[] {
  return [...new Set([...userIds, ...teamMemberIds])];
}
