'use client';

import { useTranslations } from 'next-intl';
import { WIZARD_NAME_MAX, type WizardTemplate } from '@crm/contracts';
import { Field, Input } from '@crm/ui';
import { issueFor, type StepIssue } from '../lib/issues';
import { TemplatePicker, type TemplatesQuery } from './template-picker';
import { TemplatePreview } from './template-preview';

/** Step 1: the broadcast's name and the approved template it sends, with the live preview beside the list. */
export function StepTemplate({
  name,
  templateId,
  templates,
  issues,
  disabled,
  onName,
  onTemplate,
}: {
  name: string;
  templateId: string | null;
  templates: TemplatesQuery;
  /** Shown only after the person tried to continue. */
  issues: StepIssue[];
  disabled?: boolean;
  onName: (name: string) => void;
  onTemplate: (t: WizardTemplate) => void;
}) {
  const t = useTranslations('campaigns.wizard.template');
  const ti = useTranslations('campaigns.wizard.issues');
  const selected = templates.data?.data.find((x) => x.id === templateId) ?? null;
  const nameIssue = issueFor(issues, 'name');
  const tplIssue = issueFor(issues, 'templateId');
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Field
          label={t('nameLabel')}
          htmlFor="wizard-name"
          hint={t('nameHint')}
          error={nameIssue ? ti(nameIssue.code) : undefined}
        >
          <Input
            id="wizard-name"
            value={name}
            maxLength={WIZARD_NAME_MAX}
            disabled={disabled}
            invalid={Boolean(nameIssue)}
            autoComplete="off"
            onChange={(e) => onName(e.target.value)}
            placeholder={t('namePlaceholder')}
          />
        </Field>
        <div className="space-y-2">
          <h2 className="text-sm font-medium">{t('pickTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('pickHint')}</p>
          <TemplatePicker
            templates={templates}
            selectedId={templateId}
            onSelect={(tpl) => !disabled && onTemplate(tpl)}
            invalid={Boolean(tplIssue)}
          />
          {tplIssue && (
            <p role="alert" className="text-xs text-danger">
              {ti(tplIssue.code)}
            </p>
          )}
        </div>
      </div>
      <TemplatePreview template={selected} />
    </div>
  );
}
