'use client';

import { useTranslations } from 'next-intl';
import type {
  WizardAudience,
  WizardAudienceCount,
  WizardAudienceSources,
  WizardDraft,
  WizardTemplate,
  WizardVariableSource,
  WizardVariables,
} from '@crm/contracts';
import type { StepIssue } from '../lib/issues';
import type { WizardView } from '../lib/state';
import { CreditCard, type CreditQuery } from './credit-card';
import { SummaryCard } from './summary-card';
import { VariablesCard, type CustomProperty } from './variables-card';

/** Step 3: the wallet check, the variable mapping with sample messages, and the summary of everything so far. */
export function StepReview({
  draft,
  template,
  sources,
  count,
  credit,
  properties,
  issues,
  showIssues,
  disabled,
  onVariable,
  onVariables,
  onEdit,
}: {
  draft: WizardDraft;
  template: WizardTemplate | null;
  sources: WizardAudienceSources | undefined;
  count: WizardAudienceCount | undefined;
  credit: CreditQuery;
  properties: readonly CustomProperty[];
  issues: StepIssue[];
  showIssues: boolean;
  disabled?: boolean;
  onVariable: (slot: string, source: WizardVariableSource | null) => void;
  onVariables: (variables: WizardVariables) => void;
  onEdit: (step: WizardView) => void;
}) {
  const t = useTranslations('campaigns.wizard.review');
  const audience: WizardAudience = draft.audience;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <CreditCard credit={credit} />
      <VariablesCard
        template={template}
        variables={draft.variables}
        audience={audience}
        properties={properties}
        issues={issues}
        showIssues={showIssues}
        disabled={disabled}
        onVariable={onVariable}
        onVariables={onVariables}
      />
      <SummaryCard
        draft={draft}
        template={template}
        sources={sources}
        count={count}
        credit={credit.data}
        onEdit={onEdit}
      />
    </div>
  );
}
