'use client';

import { useTranslations } from 'next-intl';
import type { SegmentGroup, WizardAudience } from '@crm/contracts';
import { Alert } from '@crm/ui';
import { issueFor, type StepIssue } from '../lib/issues';
import { AudienceConditions } from './audience-conditions';
import { CountPanel, type CountQuery } from './count-panel';
import { WizardCard } from './parts';
import { SourcePicker, type SourcesQuery } from './source-picker';

/** Step 2: groups and segments, narrowed by the filter conditions, with the live count of who will be messaged. */
export function StepAudience({
  audience,
  sources,
  count,
  countUpdating,
  hasSource,
  issues,
  disabled,
  onAudience,
}: {
  audience: WizardAudience;
  sources: SourcesQuery;
  count: CountQuery;
  countUpdating: boolean;
  hasSource: boolean;
  /** Shown only after the person tried to continue (plus the zero-recipients state). */
  issues: StepIssue[];
  disabled?: boolean;
  onAudience: (patch: Partial<WizardAudience>) => void;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const ti = useTranslations('campaigns.wizard.issues');
  const issue = issueFor(issues, 'audience');
  const onRules = (rules: SegmentGroup | null) => onAudience({ rules });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <p className="text-sm text-muted-foreground">{t('explainer')}</p>
        {issue && <Alert tone="danger">{ti(issue.code)}</Alert>}
        <WizardCard title={t('sourcesTitle')} hint={t('sourcesHint')} id="audience-sources">
          <SourcePicker
            sources={sources}
            groupIds={audience.groupIds}
            segmentIds={audience.segmentIds}
            onGroups={(groupIds) => onAudience({ groupIds })}
            onSegments={(segmentIds) => onAudience({ segmentIds })}
            disabled={disabled}
          />
        </WizardCard>
        <WizardCard
          title={t('conditionsTitle')}
          hint={t('conditionsHint')}
          id="audience-conditions"
        >
          <AudienceConditions
            rules={audience.rules}
            invalid={count.data?.invalidConditions ?? []}
            showProblems={Boolean(issue)}
            disabled={disabled}
            onRules={onRules}
          />
        </WizardCard>
      </div>
      <CountPanel count={count} hasSource={hasSource} updating={countUpdating} />
    </div>
  );
}
