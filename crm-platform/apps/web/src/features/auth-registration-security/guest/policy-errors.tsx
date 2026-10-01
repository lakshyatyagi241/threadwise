'use client';

import { useTranslations } from 'next-intl';
import { policyMessage, type PolicyIssue } from './errors';

/** The broken password rules as a list, in the visitor's language (the server's English text for rules we do not know). */
export function PolicyList({
  issues,
  className = 'list-disc space-y-0.5 ps-5',
}: {
  issues: PolicyIssue[];
  className?: string;
}) {
  const t = useTranslations('auth-registration-security.guest.errors');
  return (
    <ul className={className}>
      {issues.map((issue) => {
        const local = policyMessage(issue);
        return (
          <li key={issue.rule ?? issue.message}>
            {local ? t(`policyRules.${local.key}`, local.params) : issue.message}
          </li>
        );
      })}
    </ul>
  );
}

/** Heading plus the broken rules, shown under the password field. */
export function PolicyErrors({ rules }: { rules: PolicyIssue[] }) {
  const t = useTranslations('auth-registration-security.guest.errors');
  if (rules.length === 0) return null;
  return (
    <div className="space-y-1">
      <p>{t('passwordPolicy')}</p>
      <PolicyList issues={rules} />
    </div>
  );
}
