'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import {
  FREQUENCY_CAP_ERROR_CODE,
  WIZARD_RETRY_INTERVAL_HOURS,
  type WizardRetries,
} from '@crm/contracts';
import { Alert, Field, Switch } from '@crm/ui';
import { issueFor, type StepIssue } from '../lib/issues';
import { WizardCard } from './parts';
import { DatePicker } from './pickers';

/** "Activate Retries": try again every 24 hours, until an end date, the messages Meta refused for frequency capping. */
export function RetriesCard({
  retries,
  issues,
  disabled,
  onRetries,
}: {
  retries: WizardRetries;
  issues: StepIssue[];
  disabled?: boolean;
  onRetries: (r: WizardRetries) => void;
}) {
  const t = useTranslations('campaigns.wizard.send');
  const ti = useTranslations('campaigns.wizard.issues');
  const uid = useId();
  const issue = issueFor(issues, 'retries.endDate');
  return (
    <WizardCard title={t('retriesTitle')} id="send-retries">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id={`${uid}-on`}
            checked={retries.enabled}
            disabled={disabled}
            label={t('retriesTitle')}
            onCheckedChange={(enabled) => onRetries({ ...retries, enabled })}
          />
          <label htmlFor={`${uid}-on`} className="text-sm">
            {t('retriesToggle')}
          </label>
        </div>
        {retries.enabled && (
          <Field
            label={t('retryEnd')}
            htmlFor={`${uid}-end`}
            error={issue ? ti(issue.code) : undefined}
            className="max-w-xs"
          >
            <DatePicker
              id={`${uid}-end`}
              value={retries.endDate ?? ''}
              disabled={disabled}
              invalid={Boolean(issue)}
              onChange={(endDate) => onRetries({ ...retries, endDate: endDate || null })}
            />
          </Field>
        )}
        <Alert tone="info" className="text-sm">
          <ul className="list-disc space-y-1 ps-5">
            <li>{t('retriesInfoWhy', { code: FREQUENCY_CAP_ERROR_CODE })}</li>
            <li>{t('retriesInfoWhen', { hours: WIZARD_RETRY_INTERVAL_HOURS })}</li>
            <li>{t('retriesInfoCost')}</li>
          </ul>
        </Alert>
      </div>
    </WizardCard>
  );
}
