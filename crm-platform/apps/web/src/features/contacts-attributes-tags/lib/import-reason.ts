import { IMPORT_REJECT_REASONS, type ImportRowIssue } from '@crm/contracts';

export type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * Why a row will not be imported, in words. A custom property's rejection names the column that failed, so the person can find
 * it in the file; a reason this app does not know is shown as the server sent it.
 */
export function importRejectText(
  issue: Pick<ImportRowIssue, 'reason' | 'column'>,
  t: Translate,
): string {
  if (issue.reason === 'invalid_property_value' && issue.column) {
    return t('reasons.invalid_property_value_column', { column: issue.column });
  }
  return (IMPORT_REJECT_REASONS as readonly string[]).includes(issue.reason)
    ? t(`reasons.${issue.reason}`)
    : issue.reason;
}
