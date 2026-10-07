import {
  WIZARD_NAME_MAX,
  wizardRetriesSchema,
  wizardScheduleSchema,
  wizardVariableSourceSchema,
  type WizardVariables,
} from '@crm/contracts';
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
  return out;
}
