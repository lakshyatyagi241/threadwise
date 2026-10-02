'use client';

import { useTranslations } from 'next-intl';
import type { TplLintIssue } from '@crm/contracts';
import { Spinner, cn } from '@crm/ui';

type Field = TplLintIssue['field'];
const ORDER: Field[] = ['name', 'language', 'header', 'body', 'footer', 'buttons', 'template'];

/** Issues for one field, to sit under its input. Errors block the submit; warnings are advice. */
export function IssueList({ issues, field }: { issues: TplLintIssue[]; field: Field }) {
  const mine = issues.filter((i) => i.field === field);
  if (mine.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5" data-testid={`issues-${field}`}>
      {mine.map((i, n) => (
        <li
          key={`${i.code}-${n}`}
          className={cn('text-xs', i.severity === 'error' ? 'text-danger' : 'text-warning')}
        >
          <span className="sr-only">{i.severity}: </span>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * TW-TPL-023 as the form shows it: the linter's verdict grouped by field. The server wrote the messages; the severity and the
 * field are what the page branches on.
 */
export function LintPanel({
  issues,
  checking,
  failed,
}: {
  issues: TplLintIssue[];
  checking: boolean;
  failed: boolean;
}) {
  const t = useTranslations('message-templates.lint');
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.length - errors.length;
  return (
    <section
      aria-label={t('title')}
      className="space-y-2 rounded-md border border-border p-3"
      data-testid="lint-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        {checking && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Spinner /> {t('checking')}
          </span>
        )}
      </div>
      {failed ? (
        <p className="text-xs text-muted-foreground">{t('unavailable')}</p>
      ) : issues.length === 0 ? (
        <p className="text-xs text-success" role="status">
          {t('clean')}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" role="status">
            {t('summary', { errors: errors.length, warnings })}
          </p>
          <ul className="space-y-1.5">
            {ORDER.flatMap((f) => issues.filter((i) => i.field === f)).map((i, n) => (
              <li key={`${i.code}-${n}`} className="flex items-start gap-2 text-xs">
                <span
                  className={cn(
                    'mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-medium',
                    i.severity === 'error'
                      ? 'bg-danger/15 text-danger'
                      : 'bg-warning/15 text-warning',
                  )}
                >
                  {t(`severity.${i.severity}`)}
                </span>
                <span className="min-w-0 break-words">
                  <span className="font-medium">{t(`field.${i.field}`)}: </span>
                  {i.message}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
