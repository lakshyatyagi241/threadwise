'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { WIZARD_NAME_MAX, type WizardTemplate } from '@crm/contracts';
import { Alert, EmptyState, Field, Input, Select } from '@crm/ui';
import { issueFor, type StepIssue } from '../lib/issues';
import { ErrorBlock, Skeleton } from './parts';
import { TemplatePreview } from './template-preview';

/** The approved templates the wizard offers (the query behind them). */
export interface TemplatesQuery {
  data?: { data: WizardTemplate[] };
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Step 1: the broadcast's name and, below it, a dropdown of the approved templates; the WhatsApp preview takes the other half of the
 * page. The number it is sent from is not asked here: the workspace's default number is picked for it (`noSender` says so when there
 * is none).
 */
export function StepTemplate({
  name,
  templateId,
  noSender,
  templates,
  issues,
  disabled,
  onName,
  onTemplate,
}: {
  name: string;
  templateId: string | null;
  /** True once the connected numbers are known and there is none to send from. */
  noSender: boolean;
  templates: TemplatesQuery;
  /** Shown only after the person tried to continue. */
  issues: StepIssue[];
  disabled?: boolean;
  onName: (name: string) => void;
  onTemplate: (t: WizardTemplate) => void;
}) {
  const t = useTranslations('campaigns.wizard.template');
  const ti = useTranslations('campaigns.wizard.issues');
  const list = templates.data?.data;
  const selected = list?.find((x) => x.id === templateId) ?? null;
  const nameIssue = issueFor(issues, 'name');
  const tplIssue = issueFor(issues, 'templateId');
  const senderIssue = issueFor(issues, 'senderKey');
  return (
    <div className="grid items-start gap-8 lg:grid-cols-2">
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
        {templates.isPending ? (
          <Skeleton label={t('loading')} lines={2} />
        ) : templates.isError ? (
          <ErrorBlock error={templates.error} onRetry={() => void templates.refetch()} />
        ) : !list || list.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            message={t('emptyHint')}
            actions={
              <Link
                href="/templates"
                className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
              >
                {t('createTemplate')}
              </Link>
            }
          />
        ) : (
          <Field
            label={t('pickTitle')}
            htmlFor="wizard-template"
            hint={t('pickHint')}
            error={tplIssue ? ti(tplIssue.code) : undefined}
          >
            <Select
              id="wizard-template"
              value={templateId ?? ''}
              disabled={disabled}
              invalid={Boolean(tplIssue)}
              onChange={(e) => {
                const picked = list.find((x) => x.id === e.target.value);
                if (picked) onTemplate(picked);
              }}
            >
              {!selected && <option value="">{t('pickPlaceholder')}</option>}
              {list.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.language})
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(noSender || senderIssue) && (
          <Alert tone="warning">{noSender ? t('noSenders') : ti(senderIssue!.code)}</Alert>
        )}
      </div>
      <TemplatePreview template={selected} />
    </div>
  );
}
