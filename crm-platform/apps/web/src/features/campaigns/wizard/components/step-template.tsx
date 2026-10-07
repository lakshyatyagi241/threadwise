'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { WIZARD_NAME_MAX, type WizardTemplate } from '@crm/contracts';
import { Alert, EmptyState, Field, Input, Select } from '@crm/ui';
import { issueFor, type StepIssue } from '../lib/issues';
import { snippet } from '../lib/templates';
import { Chip, ErrorBlock, Skeleton, WizardCard } from './parts';
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
 * Step 1: two cards on the left (the broadcast's name, then a dropdown of the approved templates with what the chosen one holds) and
 * the WhatsApp phone preview on the right. The number it is sent from is not asked here: the workspace's default number is picked
 * for it and shown as a line of text (`noSender` warns when there is none).
 */
export function StepTemplate({
  name,
  templateId,
  noSender,
  senderName,
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
  /** The default number's name, shown as "Sending from" and as the chat title in the preview. */
  senderName?: string | null;
  templates: TemplatesQuery;
  /** Shown only after the person tried to continue. */
  issues: StepIssue[];
  disabled?: boolean;
  onName: (name: string) => void;
  onTemplate: (t: WizardTemplate) => void;
}) {
  const t = useTranslations('campaigns.wizard.template');
  const tc = useTranslations('campaigns.wizard.categories');
  const ti = useTranslations('campaigns.wizard.issues');
  const list = templates.data?.data;
  const selected = list?.find((x) => x.id === templateId) ?? null;
  const nameIssue = issueFor(issues, 'name');
  const tplIssue = issueFor(issues, 'templateId');
  const senderIssue = issueFor(issues, 'senderKey');
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <WizardCard title={t('nameCardTitle')} hint={t('nameHint')}>
          <Field
            label={t('nameLabel')}
            htmlFor="wizard-name"
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
          <p className="mt-1.5 text-end text-xs text-muted-foreground" aria-hidden="true">
            {t('nameCount', { used: name.length, max: WIZARD_NAME_MAX })}
          </p>
        </WizardCard>

        <WizardCard title={t('templateCardTitle')} hint={t('pickHint')}>
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
            <div className="space-y-3">
              <Field
                label={t('pickTitle')}
                htmlFor="wizard-template"
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
              {selected && (
                <div
                  data-testid="template-summary"
                  className="space-y-2 rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip>{selected.language}</Chip>
                    <Chip tone="brand">{tc(selected.category)}</Chip>
                    <Chip>{t('chipVariables', { count: selected.slots.length })}</Chip>
                    <Chip>{t('chipButtons', { count: selected.buttons.length })}</Chip>
                  </div>
                  <p className="text-sm text-muted-foreground">{snippet(selected.body)}</p>
                </div>
              )}
            </div>
          )}
        </WizardCard>

        {noSender || senderIssue ? (
          <Alert tone="warning">{noSender ? t('noSenders') : ti(senderIssue!.code)}</Alert>
        ) : (
          senderName && (
            <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <span aria-hidden="true" className="size-2 rounded-full bg-success" />
              {t('sendingFrom', { sender: senderName })}
            </p>
          )
        )}
      </div>
      <TemplatePreview template={selected} senderName={senderName} />
    </div>
  );
}
