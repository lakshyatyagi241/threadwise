import { updateLeadSourceSchema, type UpdateLeadSourceInput } from '@crm/contracts';
import { buildDefaults, validateDraft, type Problems, type SourceDraft } from './draft';

/**
 * The "Assignment and deal" dialog of a Meta lead form edits the same rules every source has (owner, deal, notifications, starting
 * stage, tag, country code), nothing else. It saves only `defaults`, so the mapping, the name and the retention stay as another
 * editor left them.
 */

/** The request that saves the rules. */
export const buildRulesUpdate = (d: SourceDraft, rowVersion: number): UpdateLeadSourceInput => ({
  rowVersion,
  defaults: buildDefaults(d),
});

/** True when the rules in the draft differ from the ones it was loaded with. */
export const rulesDirty = (draft: SourceDraft, baseline: SourceDraft): boolean =>
  JSON.stringify(buildDefaults(draft)) !== JSON.stringify(buildDefaults(baseline));

/** The problems that belong to the rules: the plain-language ones first, then anything only the contract caught. */
export function rulesProblems(d: SourceDraft): Problems {
  const own = Object.fromEntries(
    Object.entries(validateDraft(d)).filter(([path]) => path.startsWith('defaults.')),
  );
  if (Object.keys(own).length > 0) return own;
  const out: Problems = {};
  const parsed = updateLeadSourceSchema.safeParse(buildRulesUpdate(d, 1));
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.');
    if (!(path in out)) out[path] = { key: 'contract', values: { message: issue.message } };
  }
  return out;
}
