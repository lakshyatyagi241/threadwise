'use client';

import { useTranslations } from 'next-intl';
import { Field, Textarea } from '@crm/ui';
import type {
  ContactGroupResponse,
  ContactResponse,
  SegmentResponse,
  TagResponse,
} from '@crm/contracts';
import { AudiencePicker } from '@/features/broadcasts/components/audience-picker';
import type { AudienceFilter } from '@/features/broadcasts/api/compose';
import { readFileText, type BuilderForm } from '../../lib/builder-model';
import {
  RECIPIENT_MODES,
  countCsvRows,
  countNumbers,
  type RecipientMode,
} from '../../lib/wizard-model';
import { DownloadIcon } from '../icons';
import { ChoiceCard, StepCard } from './parts';

/**
 * Step 3 (WD-CAMP-004): who gets it. One of three ways at a time, as in WaDesk: contact groups, tags, segments and individual
 * contacts; an uploaded CSV; or numbers typed or pasted. Switching way drops what the other ways held.
 */
export function StepRecipients({
  form,
  patch,
  mode,
  onMode,
  lists,
  onSample,
  onCsvTooBig,
}: {
  form: BuilderForm;
  patch: (p: Partial<BuilderForm>) => void;
  mode: RecipientMode;
  onMode: (m: RecipientMode) => void;
  lists: {
    tags: TagResponse[];
    groups: ContactGroupResponse[];
    segments: SegmentResponse[];
    contacts: ContactResponse[];
    contactsDenied: boolean;
    filter: AudienceFilter;
    onFilter: (f: AudienceFilter) => void;
  };
  onSample: () => void;
  onCsvTooBig: () => void;
}) {
  const t = useTranslations('campaigns.builder');
  return (
    <StepCard index="03" title={t('audience.title')} tag={t('audience.tag')}>
      <div
        role="radiogroup"
        aria-label={t('audience.title')}
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
      >
        {RECIPIENT_MODES.map((m) => (
          <ChoiceCard
            key={m}
            compact
            checked={mode === m}
            title={t(`audience.modes.${m}.title`)}
            hint={t(`audience.modes.${m}.hint`)}
            onSelect={() => onMode(m)}
          />
        ))}
      </div>

      {mode === 'audience' && (
        <AudiencePicker
          tags={lists.tags}
          groups={lists.groups}
          segments={lists.segments}
          filter={lists.filter}
          onFilter={lists.onFilter}
          contacts={lists.contacts}
          contactsDenied={lists.contactsDenied}
          selectedTags={form.tagIds}
          selectedGroups={form.groupIds}
          selectedSegments={form.segmentIds}
          selectedContacts={form.contactIds}
          onTags={(tagIds) => patch({ tagIds })}
          onGroups={(groupIds) => patch({ groupIds })}
          onSegments={(segmentIds) => patch({ segmentIds })}
          onContacts={(contactIds) => patch({ contactIds })}
        />
      )}

      {mode === 'csv' && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="camp-csv" className="text-sm font-medium">
              {t('audience.csv')}
            </label>
            <button
              type="button"
              onClick={onSample}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
            >
              <DownloadIcon className="size-3" />
              {t('audience.sample')}
            </button>
          </div>
          <input
            id="camp-csv"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="w-full rounded-xl border border-dashed border-border p-4 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-semibold"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return patch({ csvText: '' });
              if (f.size > 5 * 1024 * 1024) {
                onCsvTooBig();
                e.target.value = '';
                return patch({ csvText: '' });
              }
              patch({ csvText: await readFileText(f) });
            }}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t('audience.csvHint')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('audience.csvRows', { count: countCsvRows(form.csvText) })}
          </p>
        </div>
      )}

      {mode === 'manual' && (
        <Field
          label={t('audience.numbers')}
          htmlFor="camp-numbers"
          hint={t('audience.numbersHint')}
        >
          <Textarea
            id="camp-numbers"
            rows={8}
            value={form.manualNumbers}
            onChange={(e) => patch({ manualNumbers: e.target.value })}
            placeholder={t('audience.numbersPlaceholder')}
            className="font-mono text-xs"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('audience.numbersCount', { count: countNumbers(form.manualNumbers) })}
          </p>
        </Field>
      )}
    </StepCard>
  );
}
