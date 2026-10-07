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
  WizardSender,
} from '@crm/contracts';
import type { StepIssue } from '../lib/issues';
import type { WizardView } from '../lib/state';
import { CreditCard, type CreditQuery } from './credit-card';
import { EligibilityCard, type EligibilityQuery } from './eligibility-card';
import { SummaryCard } from './summary-card';
import { VariablesCard, type CustomProperty } from './variables-card';

/** Step 3: the eligibility check, the wallet check, the variable mapping with sample messages, and the summary of everything so far. */
export function StepReview({
  draft,
  template,
  sender,
  sources,
  count,
  credit,
  eligibility,
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
  sender: WizardSender | null;
  sources: WizardAudienceSources | undefined;
  count: WizardAudienceCount | undefined;
  credit: CreditQuery;
  eligibility: EligibilityQuery;
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
      <EligibilityCard eligibility={eligibility} />
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
        sender={sender}
        sources={sources}
        count={count}
        credit={credit.data}
        onEdit={onEdit}
      />
    </div>
  );
}
