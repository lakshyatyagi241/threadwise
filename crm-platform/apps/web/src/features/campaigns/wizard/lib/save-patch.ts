import {
  WIZARD_FOLLOW_UP_MAX,
  WIZARD_NAME_MAX,
  WIZARD_TEMPLATE_SEQUENCE_MAX,
  wizardFollowUpSchema,
  wizardRetriesSchema,
  wizardScheduleSchema,
  wizardVariableSourceSchema,
  type WizardVariables,
} from '@crm/contracts';
import { sanitizePrevious } from '../../lib/previous-sends';
import type { DraftPatch } from './state';

/**
 * A patch the API will accept. The screen keeps what is half typed (an empty date box, a fixed text with a brace in it) so the
 * person is not fought while typing, but the server refuses such values: they are left out of the save (the last good value stays
 * saved) or cleaned, and the step's own check keeps the person from moving on with them.
 */
export function sanitizePatch(patch: DraftPatch): DraftPatch {
  const out: DraftPatch = { ...patch };
  if (out.name !== undefined) out.name = out.name.slice(0, WIZARD_NAME_MAX);
  if (out.variables) {
    const clean: WizardVariables = {};
    for (const [slot, source] of Object.entries(out.variables)) {
      if (wizardVariableSourceSchema.safeParse(source).success) clean[slot] = source;
    }
    out.variables = clean;
  }
  if (out.audience?.previous) {
    // At most 20 earlier sends and a known outcome (a ticked broadcast has no replies or clicks); the server refuses the rest.
    out.audience = { ...out.audience, previous: sanitizePrevious(out.audience.previous) };
  }
  if (out.schedule && !wizardScheduleSchema.safeParse(out.schedule).success) delete out.schedule;
  if (out.retries) {
    const r = {
      ...out.retries,
      endDate: out.retries.endDate || null,
      timezone: out.retries.timezone || null,
    };
    if (wizardRetriesSchema.safeParse(r).success) out.retries = r;
    else delete out.retries;
  }
  if (out.followUps) {
    // A step the server would refuse is left out of the save; the rest still saves, and the step's own check blocks Next.
    out.followUps = out.followUps
      .filter((f) => wizardFollowUpSchema.safeParse(f).success)
      .slice(0, WIZARD_FOLLOW_UP_MAX);
  }
  if (out.templateSequence) {
    // Every entry keeps its place (the order is the order of the runs); only a mapping the server would refuse is cleaned.
    out.templateSequence = out.templateSequence.slice(0, WIZARD_TEMPLATE_SEQUENCE_MAX).map((e) => ({
      ...e,
      variables: Object.fromEntries(
        Object.entries(e.variables).filter(
          ([, source]) => wizardVariableSourceSchema.safeParse(source).success,
        ),
      ),
    }));
  }
  return out;
}
