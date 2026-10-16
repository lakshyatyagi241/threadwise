'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import {
  WIZARD_TEMPLATE_SEQUENCE_MAX,
  type WizardAudience,
  type WizardSequenceTemplate,
  type WizardTemplate,
} from '@crm/contracts';
import { Alert, Button, Field, Select } from '@crm/ui';
import { issueFor, sequenceMappingIssues, type StepIssue } from '../lib/issues';
import type { WizardAction } from '../lib/state';
import { VariablesCard, type CustomProperty } from './variables-card';
import { WizardCard } from './parts';

/** The draft's own template plus the sequence: at most this many templates in all. */
export const SEQUENCE_TOTAL_MAX = WIZARD_TEMPLATE_SEQUENCE_MAX + 1;

function Entry({
  index,
  last,
  entry,
  templates,
  loading,
  issues,
  locked,
  disabled,
  dispatch,
}: {
  index: number;
  last: boolean;
  entry: WizardSequenceTemplate;
  templates: readonly WizardTemplate[] | undefined;
  loading: boolean;
  issues: StepIssue[];
  /** The sequence cannot be used now (not recurring, or an A/B test): the entry can only be removed. */
  locked: boolean;
  disabled?: boolean;
  dispatch: (a: WizardAction) => void;
}) {
  const t = useTranslations('campaigns.wizard.sequence');
  const ti = useTranslations('campaigns.wizard.issues');
  const uid = useId();
  const position = index + 2;
  const issue = issueFor(issues, `templateSequence.${index}.templateId`);
  const chosen = entry.templateId;
  const gone =
    chosen !== null && templates !== undefined && !templates.some((x) => x.id === chosen);
  const off = disabled || locked;
  return (
    <li className="space-y-2 rounded-lg border border-border p-3" data-testid="sequence-row">
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label={t('templateLabel', { position })}
          htmlFor={`${uid}-template`}
          className="min-w-0 flex-1"
        >
          <Select
            id={`${uid}-template`}
            value={chosen ?? ''}
            invalid={Boolean(issue)}
            disabled={off || loading}
            onChange={(e) =>
              dispatch({
                type: 'sequenceTemplate',
                index,
                template: templates?.find((x) => x.id === e.target.value) ?? null,
              })
            }
          >
            <option value="">{loading ? t('loading') : t('pick')}</option>
            {gone && chosen && <option value={chosen}>{t('unavailable')}</option>}
            {templates?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.language})
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={off || index === 0}
            aria-label={t('moveUp', { position })}
            onClick={() => dispatch({ type: 'sequenceMove', index, by: -1 })}
          >
            {t('up')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={off || last}
            aria-label={t('moveDown', { position })}
            onClick={() => dispatch({ type: 'sequenceMove', index, by: 1 })}
          >
            {t('down')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={t('remove', { position })}
            onClick={() => dispatch({ type: 'sequenceRemove', index })}
          >
            {t('removeShort')}
          </Button>
        </div>
      </div>
      {issue && (
        <p role="alert" className="text-xs text-danger">
          {ti(issue.code)}
        </p>
      )}
    </li>
  );
}

/**
 * "Templates in order": the draft's own template is the first of a sequence and up to nine more follow; the runs of a recurring
 * broadcast take them in turn, round and round. Shown for a recurring schedule; with a sequence left over on another schedule, or with
 * an A/B test, it stays on screen but locked (it can only be emptied), so the issue the contract reports has something to act on.
 */
export function SequenceCard({
  firstName,
  sequence,
  recurring,
  abTesting,
  templates,
  loading,
  issues,
  disabled,
  dispatch,
}: {
  /** The name of the draft's own template (read only here; step 1 changes it). */
  firstName: string | null;
  sequence: readonly WizardSequenceTemplate[];
  recurring: boolean;
  abTesting: boolean;
  /** The approved templates on offer (the list step 1 uses). */
  templates: readonly WizardTemplate[] | undefined;
  loading: boolean;
  issues: StepIssue[];
  disabled?: boolean;
  dispatch: (a: WizardAction) => void;
}) {
  const t = useTranslations('campaigns.wizard.sequence');
  const ti = useTranslations('campaigns.wizard.issues');
  if (!recurring && sequence.length === 0) return null;

  const reason = !recurring ? t('notRecurring') : abTesting ? t('withAb') : null;
  const locked = reason !== null;
  const full = sequence.length >= WIZARD_TEMPLATE_SEQUENCE_MAX;
  const total = sequence.length + 1;
  const listIssue = issueFor(issues, 'templateSequence');
  return (
    <WizardCard title={t('title')} hint={t('intro')} id="send-sequence">
      <div className="space-y-4">
        {reason && (
          <Alert tone="info" className="text-sm">
            {reason}
          </Alert>
        )}
        {listIssue && (
          <p role="alert" className="text-sm text-danger">
            {ti(listIssue.code)}
          </p>
        )}
        <ol className="space-y-3">
          <li
            className="rounded-lg border border-border bg-muted/40 p-3"
            data-testid="sequence-first"
          >
            <p className="text-xs text-muted-foreground">{t('templateLabel', { position: 1 })}</p>
            <p className="text-sm font-medium">
              {firstName ?? <span className="text-muted-foreground">{t('firstMissing')}</span>}
            </p>
            <p className="text-xs text-muted-foreground">{t('firstHint')}</p>
          </li>
          {sequence.map((entry, i) => (
            <Entry
              key={i}
              index={i}
              last={i === sequence.length - 1}
              entry={entry}
              templates={templates}
              loading={loading}
              issues={issues}
              locked={locked}
              disabled={disabled}
              dispatch={dispatch}
            />
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={disabled || locked || full}
            onClick={() => dispatch({ type: 'sequenceAdd' })}
          >
            {t('add')}
          </Button>
          {sequence.length > 0 && (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => dispatch({ type: 'sequenceClear' })}
            >
              {t('removeAll')}
            </Button>
          )}
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {full
              ? t('limitReached', { max: SEQUENCE_TOTAL_MAX })
              : t('count', { used: total, max: SEQUENCE_TOTAL_MAX })}
          </span>
        </div>
      </div>
    </WizardCard>
  );
}

/**
 * The variable mapping of each template of the sequence, one card per template that has placeholders, titled with its name and its
 * place in the order. Shown whenever the draft has a sequence (the mapping is needed for the runs that send it).
 */
export function SequenceVariables({
  sequence,
  templates,
  audience,
  properties,
  issues,
  showIssues,
  disabled,
  dispatch,
}: {
  sequence: readonly WizardSequenceTemplate[];
  templates: readonly WizardTemplate[] | undefined;
  audience: WizardAudience;
  properties: readonly CustomProperty[];
  issues: StepIssue[];
  showIssues: boolean;
  disabled?: boolean;
  dispatch: (a: WizardAction) => void;
}) {
  const t = useTranslations('campaigns.wizard.sequence');
  return (
    <>
      {sequence.map((entry, i) => {
        const template = templates?.find((x) => x.id === entry.templateId) ?? null;
        // A template still to be chosen has no placeholders to map: the card appears with the template.
        if (!template || template.slots.length === 0) return null;
        return (
          <VariablesCard
            key={`${i}-${template.id}`}
            id={`sequence-variables-${i + 2}`}
            title={t('variablesTitle', { position: i + 2, name: template.name })}
            template={template}
            variables={entry.variables}
            audience={audience}
            properties={properties}
            issues={sequenceMappingIssues(issues, i)}
            showIssues={showIssues}
            disabled={disabled}
            onVariable={(slot, source) =>
              dispatch({ type: 'sequenceVariable', index: i, slot, source })
            }
            onVariables={(variables) =>
              dispatch({ type: 'sequenceVariables', index: i, variables })
            }
          />
        );
      })}
    </>
  );
}
