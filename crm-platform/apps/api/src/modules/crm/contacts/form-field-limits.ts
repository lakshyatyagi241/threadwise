import { AppError } from '../../../common/errors/app-error';

/**
 * The contact form keeps title, middle name, language, address and memo in `customFields` under reserved keys (the table
 * has no column for them yet). Reference validates them on the server (title 50, middle name 191, language 80, address 1000,
 * memo 2000); without a cap here the API accepted any size, so a 100 KB memo was stored and a larger one failed as a 500.
 * The same numbers are the `maxLength` of the form inputs in apps/web.
 */
export const FORM_FIELD_LIMITS: Readonly<Record<string, number>> = {
  title: 50,
  middle_name: 191,
  language: 80,
  address: 1000,
  memo: 2000,
};

/** 422 VALIDATION_FAILED naming each over-long key as `customFields.<key>`; passes when nothing is over a cap. */
export function assertFormFieldLimits(customFields: Record<string, unknown> | undefined): void {
  if (!customFields) return;
  const over: Array<{ path: string; message: string }> = [];
  for (const [key, max] of Object.entries(FORM_FIELD_LIMITS)) {
    const v = customFields[key];
    if (typeof v === 'string' && v.length > max) {
      over.push({ path: `customFields.${key}`, message: `must be at most ${max} characters` });
    }
  }
  if (over.length === 0) return;
  throw AppError.validation(
    `Too long: ${over.map((o) => o.path.replace('customFields.', '')).join(', ')}.`,
    over,
  );
}

/**
 * The reserved text keys of a `customFields` object as a plan: text is set (trimmed), blank text or `null` clears the key. Other
 * keys are left to the registry; a value that is not text is refused.
 */
export function reservedTextPlan(
  customFields: Record<string, unknown> | undefined,
): { set: Record<string, string>; clear: string[] } | undefined {
  if (!customFields) return undefined;
  const plan = { set: {} as Record<string, string>, clear: [] as string[] };
  const bad: Array<{ path: string; message: string }> = [];
  for (const key of Object.keys(FORM_FIELD_LIMITS)) {
    if (!(key in customFields)) continue;
    const v = customFields[key];
    if (v === null || (typeof v === 'string' && v.trim() === '')) plan.clear.push(key);
    else if (typeof v === 'string') plan.set[key] = v.trim();
    else bad.push({ path: `customFields.${key}`, message: 'must be text' });
  }
  if (bad.length > 0)
    throw AppError.validation('Not text: ' + bad.map((b) => b.path).join(', ') + '.', bad);
  return plan.clear.length + Object.keys(plan.set).length > 0 ? plan : undefined;
}
