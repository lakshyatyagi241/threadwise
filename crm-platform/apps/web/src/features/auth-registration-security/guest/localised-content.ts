import type { AuthPageContent, AuthPageTextField } from '@crm/contracts';

/**
 * The API fills fields the administrator left empty with its English default text and says which ones
 * (`registration-config` `authPages.defaulted`). For those, the page shows its own copy in the visitor's
 * language. Text the administrator wrote is always shown as written.
 */
export function withLocalisedDefaults(
  content: AuthPageContent,
  defaulted: readonly AuthPageTextField[] | undefined,
  localised: (field: AuthPageTextField) => string | undefined,
): AuthPageContent {
  if (!defaulted || defaulted.length === 0) return content;
  const out: AuthPageContent = { ...content };
  for (const field of defaulted) {
    const text = localised(field);
    if (text) out[field] = text;
  }
  return out;
}
