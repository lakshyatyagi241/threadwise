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
import { useBuilder } from '../../api/campaigns';
import type { StepIssue } from '../lib/issues';
import type { WizardAction, WizardView } from '../lib/state';
import { CreditCard, type CreditQuery } from './credit-card';
import { SequenceVariables } from './sequence-card';
import { SummaryCard } from './summary-card';
import { VariablesCard, type CustomProperty } from './variables-card';

/** Step 3: the wallet check, the variable mapping with sample messages, and the summary of everything so far. */
export function StepReview({
  draft,
  template,
  sender,
  sources,
  count,
  credit,
  templates,
  properties,
  issues,
  showIssues,
  disabled,
  onVariable,
  onVariables,
  dispatch,
  onEdit,
}: {
  draft: WizardDraft;
  template: WizardTemplate | null;
  sender: WizardSender | null;
  sources: WizardAudienceSources | undefined;
  count: WizardAudienceCount | undefined;
  credit: CreditQuery;
  /** Template names for the follow-up lines of the summary. */
  templates?: readonly WizardTemplate[] | undefined;
  properties: readonly CustomProperty[];
  issues: StepIssue[];
  showIssues: boolean;
  disabled?: boolean;
  onVariable: (slot: string, source: WizardVariableSource | null) => void;
  onVariables: (variables: WizardVariables) => void;
  /** The mapping of the templates of a recurring broadcast's sequence. */
  dispatch: (a: WizardAction) => void;
  onEdit: (step: WizardView) => void;
}) {
  const t = useTranslations('campaigns.wizard.review');
  const audience: WizardAudience = draft.audience;
  // Only to name the flows the follow-ups start; the list is the one the campaign builder offers.
  const builder = useBuilder();
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
      <SequenceVariables
        sequence={draft.templateSequence}
        templates={templates}
        audience={audience}
        properties={properties}
        issues={issues}
        showIssues={showIssues}
        disabled={disabled}
        dispatch={dispatch}
      />
      <SummaryCard
        draft={draft}
        template={template}
        sender={sender}
        sources={sources}
        count={count}
        credit={credit.data}
        templates={templates}
        flows={builder.data?.flows}
        onEdit={onEdit}
      />
    </div>
  );
}
