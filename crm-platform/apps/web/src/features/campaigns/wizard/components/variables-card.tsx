'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  WIZARD_CONTACT_FIELDS,
  WIZARD_VARIABLE_TEXT_MAX,
  type WizardAudience,
  type WizardTemplate,
  type WizardTemplateSlot,
  type WizardVariableSource,
  type WizardVariables,
} from '@crm/contracts';
import { Alert, Field, Input, Select } from '@crm/ui';
import { MessageBubble } from '@/features/message-templates/components/message-bubble';
import { prefillVariables, previewModelWithText, wouldPrefill } from '../lib/templates';
import { useVariablePreview } from '../api/wizard';
import { unmappedSlots, type StepIssue } from '../lib/issues';
import { Chip, ErrorBlock, Skeleton, WizardCard } from './parts';
import { useSettled } from './use-settled';

export interface CustomProperty {
  key: string;
  label: string;
}

function placeholderOf(s: WizardTemplateSlot): string {
  return s.section === 'button' ? `{{${s.position + 1}}}` : `{{${s.position}}}`;
}

function SlotRow({
  slot,
  source,
  properties,
  invalid,
  disabled,
  onChange,
}: {
  slot: WizardTemplateSlot;
  source: WizardVariableSource | undefined;
  properties: readonly CustomProperty[];
  invalid: boolean;
  disabled?: boolean;
  onChange: (source: WizardVariableSource | null) => void;
}) {
  const t = useTranslations('campaigns.wizard.review');
  const tf = useTranslations('campaigns.wizard.fields');
  const uid = useId();
  // What the row shows comes from the saved source; only a choice with no source yet (an empty fixed text, "Fixed" picked
  // before typing) is held here.
  const [localKind, setKind] = useState<'field' | 'fixed'>('field');
  const [localText, setText] = useState('');
  const kind = source?.kind ?? localKind;
  const text = source?.kind === 'fixed' ? source.text : localText;
  const field = source?.kind === 'field' ? source.field : '';
  const fallback = source?.kind === 'field' ? (source.fallback ?? '') : '';
  const braces = kind === 'fixed' && /[{}]/.test(text);

  const sectionLabel = t(`slotSection.${slot.section}`);
  return (
    <li className="space-y-2 rounded-lg border border-border p-3" data-slot={slot.slot}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {sectionLabel} <code className="font-mono text-xs">{placeholderOf(slot)}</code>
        </span>
        {slot.example && (
          <span className="text-xs text-muted-foreground">
            {t('example', { value: slot.example })}
          </span>
        )}
        {source && <Chip tone="success">{t('mapped')}</Chip>}
        {!source && invalid && <Chip tone="danger">{t('unmapped')}</Chip>}
      </div>
      <div className="grid gap-2 sm:grid-cols-[11rem_1fr_1fr]">
        <Field label={t('source')} htmlFor={`${uid}-kind`} className="space-y-1">
          <Select
            id={`${uid}-kind`}
            value={kind}
            disabled={disabled}
            onChange={(e) => {
              const k = e.target.value as 'field' | 'fixed';
              setKind(k);
              if (k === 'fixed')
                onChange(text && !/[{}]/.test(text) ? { kind: 'fixed', text } : null);
              else onChange(field ? { kind: 'field', field, fallback: fallback || null } : null);
            }}
          >
            <option value="field">{t('sourceField')}</option>
            <option value="fixed">{t('sourceFixed')}</option>
          </Select>
        </Field>
        {kind === 'field' ? (
          <>
            <Field label={t('field')} htmlFor={`${uid}-field`} className="space-y-1">
              <Select
                id={`${uid}-field`}
                value={field}
                disabled={disabled}
                invalid={invalid && !source}
                onChange={(e) =>
                  onChange(
                    e.target.value
                      ? { kind: 'field', field: e.target.value, fallback: fallback || null }
                      : null,
                  )
                }
              >
                <option value="">{t('pickField')}</option>
                <optgroup label={t('contactFields')}>
                  {WIZARD_CONTACT_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {tf(f)}
                    </option>
                  ))}
                </optgroup>
                {properties.length > 0 && (
                  <optgroup label={t('customFields')}>
                    {properties.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
            <Field label={t('fallback')} htmlFor={`${uid}-fb`} className="space-y-1">
              <Input
                id={`${uid}-fb`}
                value={fallback}
                maxLength={WIZARD_VARIABLE_TEXT_MAX}
                disabled={disabled || !field}
                placeholder={t('fallbackPlaceholder')}
                onChange={(e) =>
                  field && onChange({ kind: 'field', field, fallback: e.target.value || null })
                }
              />
            </Field>
          </>
        ) : (
          <Field
            label={t('fixedText')}
            htmlFor={`${uid}-text`}
            className="space-y-1 sm:col-span-2"
            error={braces ? t('bracesNotAllowed') : undefined}
          >
            <Input
              id={`${uid}-text`}
              value={text}
              maxLength={WIZARD_VARIABLE_TEXT_MAX}
              disabled={disabled}
              invalid={braces || (invalid && !source)}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                onChange(v.trim() && !/[{}]/.test(v) ? { kind: 'fixed', text: v } : null);
              }}
            />
          </Field>
        )}
      </div>
    </li>
  );
}

function Samples({
  template,
  audience,
  variables,
}: {
  template: WizardTemplate;
  audience: WizardAudience;
  variables: WizardVariables;
}) {
  const t = useTranslations('campaigns.wizard.review');
  const settled = useSettled({ audience, variables }, 500);
  const q = useVariablePreview(template.id, settled.value.audience, settled.value.variables);
  const busy = !settled.settled || (q.isFetching && !q.isPending);
  return (
    <div className="space-y-2" aria-busy={busy}>
      <h3 className="text-sm font-semibold">{t('samplesTitle')}</h3>
      {q.isPending ? (
        <Skeleton label={t('samplesLoading')} lines={3} />
      ) : q.isError && !q.data ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.samples.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t('samplesEmpty')}
        </p>
      ) : (
        <ul className={busy ? 'space-y-3 opacity-60' : 'space-y-3'}>
          {q.data?.samples.map((s) => (
            <li key={s.contact.id} className="rounded-lg bg-muted p-3">
              <p className="mb-1.5 text-xs text-muted-foreground">
                {s.contact.name || t('unnamed')}
                {s.contact.phone && (
                  <span dir="ltr" className="ms-2 font-mono">
                    {s.contact.phone}
                  </span>
                )}
              </p>
              <MessageBubble
                model={previewModelWithText(template, {
                  header: s.header,
                  body: s.body,
                  footer: s.footer,
                })}
              />
              {s.empty.length > 0 && (
                <p role="status" className="mt-1.5 text-xs text-warning">
                  {t('emptyPlaceholders', { slots: s.empty.join(', ') })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Where each placeholder of the template gets its value, and a few real contacts' messages as they will be sent. */
export function VariablesCard({
  template,
  variables,
  audience,
  properties,
  issues,
  showIssues,
  disabled,
  onVariable,
  onVariables,
}: {
  template: WizardTemplate | null;
  variables: WizardVariables;
  audience: WizardAudience;
  properties: readonly CustomProperty[];
  issues: StepIssue[];
  showIssues: boolean;
  disabled?: boolean;
  onVariable: (slot: string, source: WizardVariableSource | null) => void;
  onVariables: (variables: WizardVariables) => void;
}) {
  const t = useTranslations('campaigns.wizard.review');
  const slots = template?.slots ?? [];
  const missing = new Set(unmappedSlots(issues));

  // Placeholders the template names after a contact field or a custom property start mapped to it.
  useEffect(() => {
    if (!template) return;
    const next = prefillVariables(
      template.slots,
      variables,
      properties.map((p) => p.key),
    );
    if (wouldPrefill(variables, next)) onVariables(next);
    // Runs when the template or the known fields change, never on the person's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, properties.length]);

  return (
    <WizardCard title={t('variablesTitle')} hint={t('variablesHint')} id="review-variables">
      {!template ? (
        <Alert tone="warning">{t('noTemplate')}</Alert>
      ) : slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noVariables')}</p>
      ) : (
        <div className="space-y-4">
          {showIssues && missing.size > 0 && (
            <Alert tone="danger">
              <span className="block">{t('unmappedList', { count: missing.size })}</span>
              <span className="block font-mono text-xs">{[...missing].join(', ')}</span>
            </Alert>
          )}
          <ul className="space-y-2">
            {slots.map((s) => (
              <SlotRow
                key={s.slot}
                slot={s}
                source={variables[s.slot]}
                properties={properties}
                invalid={showIssues && missing.has(s.slot)}
                disabled={disabled}
                onChange={(src) => onVariable(s.slot, src)}
              />
            ))}
          </ul>
        </div>
      )}
      {template && (
        <div className="mt-5">
          <Samples template={template} audience={audience} variables={variables} />
        </div>
      )}
    </WizardCard>
  );
}
