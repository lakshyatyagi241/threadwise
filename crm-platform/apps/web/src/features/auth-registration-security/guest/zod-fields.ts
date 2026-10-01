import type { ZodError } from 'zod';

/** Top-level field names that failed validation, in the order they appear (for "focus the first invalid field"). */
export function failedFields(error: ZodError): string[] {
  const seen: string[] = [];
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !seen.includes(field)) seen.push(field);
  }
  return seen;
}
