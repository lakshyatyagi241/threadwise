'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WizardAudience, WizardTemplate } from '@crm/contracts';
import { Alert, Button } from '@crm/ui';
import { audienceTally, selectionKind } from '../lib/audience';
import { issueFor, type StepIssue } from '../lib/issues';
import { AudienceModes, AudienceSummary, type AudienceMode } from './audience-modes';
import { ContactsTable } from './contacts-table';
import { CountPanel, type CountQuery } from './count-panel';
import { CsvUpload } from './csv-upload';
import { WizardCard } from './parts';
import { SourcePicker, type SourcesQuery } from './source-picker';
import { TemplatePreview } from './template-preview';

/** The mode to open on: the first one that already holds a selection (a resumed draft), else the contacts table. */
function firstMode(a: WizardAudience): AudienceMode {
  if (a.contactIds.length > 0 || a.allMatching) return 'contacts';
  if (a.groupIds.length > 0) return 'groups';
  if (a.segmentIds.length > 0) return 'segments';
  if (a.csv) return 'csv';
  return 'contacts';
}

/**
 * Step 2: "Broadcast Action" with four ways to choose the audience (contacts table, groups, segments, CSV), each holding its own
 * selection; the audience is the union of them, with opted-out contacts and invalid numbers always left out. On the right: the live
 * count of who will be messaged and the template as the customer will see it.
 */
export function StepAudience({
  audience,
  sources,
  count,
  countUpdating,
  hasSource,
  issues,
  template,
  senderName,
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
  /** The template chosen in step 1, drawn in the phone preview. */
  template: WizardTemplate | null;
  senderName?: string | null;
  disabled?: boolean;
  onAudience: (patch: Partial<WizardAudience>) => void;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const ti = useTranslations('campaigns.wizard.issues');
  const panelId = useId();
  const [mode, setMode] = useState<AudienceMode>(() => firstMode(audience));
  const [allTotal, setAllTotal] = useState<number | null>(null);
  const issue = issueFor(issues, 'audience');
  const tally = audienceTally(audience);
  return (
    <div className="grid gap-4 lg:h-[calc(100dvh-15.5rem)] lg:min-h-[28rem] lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <AudienceModes mode={mode} tally={tally} onMode={setMode} panelId={panelId} />
        <AudienceSummary tally={tally} allTotal={audience.allMatching ? allTotal : null} />
        {issue && <Alert tone="danger">{ti(issue.code)}</Alert>}
        {audience.selection && (
          <WizardCard title={t('selectionTitle')} hint={t('selectionHint')} id="audience-selection">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <SelectionText selection={audience.selection} />
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => onAudience({ selection: null })}
              >
                {t('selectionRemove')}
              </Button>
            </div>
          </WizardCard>
        )}
        <section
          id={panelId}
          role="tabpanel"
          aria-label={t(`mode.${mode}`)}
          className="flex min-h-[24rem] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background lg:min-h-0"
        >
          {mode === 'contacts' && (
            <ContactsTable
              audience={audience}
              onAudience={onAudience}
              onTotal={setAllTotal}
              disabled={disabled}
            />
          )}
          {mode === 'groups' && (
            <>
              <p className="border-b border-border px-4 py-2.5 text-sm text-muted-foreground">
                {t('groupsHint')}
              </p>
              <SourcePicker
                kind="groups"
                sources={sources}
                chosen={audience.groupIds}
                onChange={(groupIds) => onAudience({ groupIds })}
                disabled={disabled}
              />
            </>
          )}
          {mode === 'segments' && (
            <>
              <p className="border-b border-border px-4 py-2.5 text-sm text-muted-foreground">
                {t('segmentsHint')}
              </p>
              <SourcePicker
                kind="segments"
                sources={sources}
                chosen={audience.segmentIds}
                onChange={(segmentIds) => onAudience({ segmentIds })}
                disabled={disabled}
              />
            </>
          )}
          {mode === 'csv' && (
            <CsvUpload
              csv={audience.csv}
              onCsv={(csv) => onAudience({ csv })}
              disabled={disabled}
            />
          )}
        </section>
      </div>
      <aside className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto">
        <CountPanel count={count} hasSource={hasSource} updating={countUpdating} compact />
        <TemplatePreview template={template} senderName={senderName} compact />
      </aside>
    </div>
  );
}

/** "12 contacts ticked", or "Everything the Contact Hub view matched (2 left out)". */
export function SelectionText({
  selection,
}: {
  selection: NonNullable<WizardAudience['selection']>;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const kind = selectionKind(selection);
  return (
    <span>
      {kind.kind === 'ids'
        ? t('selectionIds', { count: kind.count })
        : kind.excluded > 0
          ? `${t('selectionFilter')} (${t('selectionExcluded', { count: kind.excluded })})`
          : t('selectionFilter')}
    </span>
  );
}
