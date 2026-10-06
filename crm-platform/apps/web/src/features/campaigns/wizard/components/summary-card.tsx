'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  WIZARD_CONTACT_FIELDS,
  type WizardAudienceCount,
  type WizardCreditCheck,
  type WizardDraft,
  type WizardSender,
  type WizardTemplate,
  type WizardAudienceSources,
} from '@crm/contracts';
import { useSegmentCatalog } from '@/features/segments/api/lookups';
import { summarize } from '@/features/segments/lib/summary';
import { useSummaryContext } from '@/features/segments/components/use-summary';
import { audienceNames, editorFromRules } from '../lib/audience';
import { formatMinor } from '../lib/money';
import type { WizardView } from '../lib/state';
import { Chip, WizardCard } from './parts';

function Row({
  label,
  step,
  onEdit,
  children,
}: {
  label: string;
  step?: WizardView;
  onEdit?: (step: WizardView) => void;
  children: ReactNode;
}) {
  const t = useTranslations('campaigns.wizard.review');
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr_auto] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
      {step && onEdit && (
        <dd className="sm:text-end">
          <button
            type="button"
            onClick={() => onEdit(step)}
            aria-label={t('editSection', { section: label })}
            className="text-sm font-medium text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('edit')}
          </button>
        </dd>
      )}
    </div>
  );
}

const WIZARD_FIELD_LABELS: ReadonlySet<string> = new Set(WIZARD_CONTACT_FIELDS);

/** The broadcast so far in words, with an Edit link back to the step that owns each value. */
export function SummaryCard({
  draft,
  template,
  sender,
  sources,
  count,
  credit,
  onEdit,
}: {
  draft: WizardDraft;
  template: WizardTemplate | null;
  sender: WizardSender | null;
  sources: WizardAudienceSources | undefined;
  count: WizardAudienceCount | undefined;
  credit: WizardCreditCheck | undefined;
  onEdit: (step: WizardView) => void;
}) {
  const t = useTranslations('campaigns.wizard.review');
  const tc = useTranslations('campaigns.wizard.categories');
  const tf = useTranslations('campaigns.wizard.fields');
  const locale = useLocale();
  const { catalog } = useSegmentCatalog();
  const ctx = useSummaryContext(catalog);
  const names = audienceNames(draft.audience, sources);
  const sentence = draft.audience.rules
    ? summarize(editorFromRules(draft.audience.rules), ctx)
    : '';
  const recipients = credit?.recipients ?? count?.recipients;
  const skipped = count ? count.optedOut + count.invalidNumber : null;
  const slots = template?.slots ?? [];
  const list = (xs: Array<{ name: string; found: boolean }>) =>
    xs.map((x) => (x.found ? x.name : t('missingSource'))).join(', ');
  return (
    <WizardCard title={t('summaryTitle')} id="review-summary">
      <dl className="divide-y divide-border">
        <Row label={t('sumName')} step={1} onEdit={onEdit}>
          {draft.name || <span className="text-muted-foreground">{t('none')}</span>}
        </Row>
        <Row label={t('sumTemplate')} step={1} onEdit={onEdit}>
          {template ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{template.name}</span>
              <Chip>{template.language}</Chip>
              <Chip tone="brand">{tc(template.category)}</Chip>
            </span>
          ) : (
            <span className="text-muted-foreground">{t('none')}</span>
          )}
        </Row>
        <Row label={t('sumSender')} step={1} onEdit={onEdit}>
          {sender ? (
            <span>
              {sender.label}
              {sender.phone ? ` (${sender.phone})` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('none')}</span>
          )}
        </Row>
        <Row label={t('sumAudience')} step={2} onEdit={onEdit}>
          <ul className="space-y-0.5">
            {names.groups.length > 0 && <li>{t('sumGroups', { names: list(names.groups) })}</li>}
            {names.segments.length > 0 && (
              <li>{t('sumSegments', { names: list(names.segments) })}</li>
            )}
            <li>
              {sentence ? (
                t('sumConditions', { rules: sentence })
              ) : (
                <span className="text-muted-foreground">{t('sumNoConditions')}</span>
              )}
            </li>
          </ul>
        </Row>
        <Row label={t('sumRecipients')} step={2} onEdit={onEdit}>
          {recipients === undefined ? '-' : recipients.toLocaleString()}
          {skipped !== null && count && (
            <span className="block text-xs text-muted-foreground">
              {t('sumSkipped', {
                total: skipped,
                optedOut: count.optedOut,
                invalid: count.invalidNumber,
              })}
            </span>
          )}
        </Row>
        <Row label={t('sumCost')}>
          {credit ? formatMinor(credit.estimatedCostMinor, credit.currency, locale) : '-'}
        </Row>
        <Row label={t('sumVariables')}>
          {slots.length === 0 ? (
            <span className="text-muted-foreground">{t('noVariables')}</span>
          ) : (
            <ul className="space-y-0.5">
              {slots.map((s) => {
                const v = draft.variables[s.slot];
                return (
                  <li key={s.slot}>
                    <code className="font-mono text-xs">{s.slot}</code>{' '}
                    {!v
                      ? t('unmapped')
                      : v.kind === 'fixed'
                        ? t('sumFixed', { text: v.text })
                        : v.fallback
                          ? t('sumFieldFallback', {
                              field: WIZARD_FIELD_LABELS.has(v.field) ? tf(v.field) : v.field,
                              fallback: v.fallback,
                            })
                          : t('sumField', {
                              field: WIZARD_FIELD_LABELS.has(v.field) ? tf(v.field) : v.field,
                            })}
                  </li>
                );
              })}
            </ul>
          )}
        </Row>
      </dl>
    </WizardCard>
  );
}
