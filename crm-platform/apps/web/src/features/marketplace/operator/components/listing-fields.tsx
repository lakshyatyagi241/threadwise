'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { PLAN_FEATURE_KEYS, PLAN_FEATURE_LABELS } from '@crm/contracts';
import { Button, Checkbox, Field, Input, Select, Textarea } from '@crm/ui';
import {
  LISTING_LIMITS,
  type FieldProblem,
  type FieldProblems,
  type ListingDraft,
} from '../lib/listing-form';
import { Section } from './ui';

const NS = 'marketplace.operator.fields';

/** Text of a field problem, or the API's own text for a field it refused. */
export function useFieldError(
  problems: FieldProblems,
  server: Readonly<Record<string, string>>,
  showClient: boolean,
): (key: string) => string | undefined {
  const t = useTranslations(`${NS}.problems`);
  return (key) => {
    const s = server[key];
    if (s) return s;
    const p: FieldProblem | undefined = showClient ? problems[key] : undefined;
    return p ? t(p.code, p.values) : undefined;
  };
}

/**
 * The simple listing fields as sections of a form: the tagline and the page text, the screenshots, the data-processing disclosure and
 * the placement (first-party, featured, plan feature, sort order). `disabled` shows them read-only for someone who may not edit.
 */
export function ListingFields({
  draft,
  onChange,
  problems,
  server,
  showErrors,
  disabled,
}: {
  draft: ListingDraft;
  onChange: (next: ListingDraft) => void;
  problems: FieldProblems;
  /** Texts the API gave for fields it refused, by form key. */
  server: Readonly<Record<string, string>>;
  /** Show the typed values' problems (after a first save attempt). The API's are always shown. */
  showErrors: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations(NS);
  const base = useId();
  const id = (k: string) => `${base}-${k}`;
  const err = useFieldError(problems, server, showErrors);
  const set = <K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const L = LISTING_LIMITS;

  return (
    <>
      <Section title={t('sections.page')} description={t('sections.pageHelp')}>
        <div className="grid gap-4">
          <Field
            label={t('tagline')}
            htmlFor={id('tagline')}
            hint={t('taglineHint', { count: draft.tagline.trim().length, max: L.taglineMax })}
            error={err('tagline')}
          >
            <Input
              id={id('tagline')}
              value={draft.tagline}
              disabled={disabled}
              invalid={!!err('tagline')}
              onChange={(e) => set('tagline', e.target.value)}
            />
          </Field>
          <Field label={t('logo')} htmlFor={id('logo')} hint={t('logoHint')} error={err('logo')}>
            <Input
              id={id('logo')}
              type="url"
              dir="ltr"
              inputMode="url"
              placeholder="https://"
              autoComplete="off"
              value={draft.logo}
              disabled={disabled}
              invalid={!!err('logo')}
              onChange={(e) => set('logo', e.target.value)}
            />
          </Field>
          <Field
            label={t('longDescription')}
            htmlFor={id('long')}
            hint={t('longDescriptionHint', { max: L.longDescriptionMax })}
            error={err('longDescription')}
          >
            <Textarea
              id={id('long')}
              rows={6}
              value={draft.longDescription}
              disabled={disabled}
              invalid={!!err('longDescription')}
              onChange={(e) => set('longDescription', e.target.value)}
            />
          </Field>
          <Field
            label={t('highlights')}
            htmlFor={id('highlights')}
            hint={t('highlightsHint', { max: L.highlightsMax, length: L.highlightMax })}
            error={err('highlights')}
          >
            <Textarea
              id={id('highlights')}
              rows={4}
              value={draft.highlights}
              disabled={disabled}
              invalid={!!err('highlights')}
              onChange={(e) => set('highlights', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section
        title={t('sections.screenshots')}
        description={t('sections.screenshotsHelp', { max: L.screenshotsMax })}
      >
        {err('screenshots') && (
          <p role="alert" className="text-xs text-danger">
            {err('screenshots')}
          </p>
        )}
        {draft.screenshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('screenshotsNone')}</p>
        ) : (
          <ul className="space-y-3">
            {draft.screenshots.map((s, i) => (
              <li
                key={i}
                className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start"
              >
                <Field
                  label={t('screenshotUrl', { n: i + 1 })}
                  htmlFor={id(`shot-${i}-url`)}
                  error={err(`screenshots.${i}.url`)}
                >
                  <Input
                    id={id(`shot-${i}-url`)}
                    type="url"
                    dir="ltr"
                    inputMode="url"
                    placeholder="https://"
                    autoComplete="off"
                    value={s.url}
                    disabled={disabled}
                    invalid={!!err(`screenshots.${i}.url`)}
                    onChange={(e) =>
                      set(
                        'screenshots',
                        draft.screenshots.map((x, j) =>
                          j === i ? { ...x, url: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <Field
                  label={t('screenshotCaption', { n: i + 1 })}
                  htmlFor={id(`shot-${i}-caption`)}
                  error={err(`screenshots.${i}.caption`)}
                >
                  <Input
                    id={id(`shot-${i}-caption`)}
                    value={s.caption}
                    disabled={disabled}
                    invalid={!!err(`screenshots.${i}.caption`)}
                    onChange={(e) =>
                      set(
                        'screenshots',
                        draft.screenshots.map((x, j) =>
                          j === i ? { ...x, caption: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                {!disabled && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="sm:mt-7"
                    onClick={() =>
                      set(
                        'screenshots',
                        draft.screenshots.filter((_, j) => j !== i),
                      )
                    }
                  >
                    {t('screenshotRemove', { n: i + 1 })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!disabled && (
          <Button
            variant="secondary"
            size="sm"
            disabled={draft.screenshots.length >= L.screenshotsMax}
            onClick={() => set('screenshots', [...draft.screenshots, { url: '', caption: '' }])}
          >
            {t('screenshotAdd')}
          </Button>
        )}
      </Section>

      <Section title={t('sections.data')} description={t('sections.dataHelp')}>
        <div className="grid gap-4">
          <Field
            label={t('dataSummary')}
            htmlFor={id('data-summary')}
            hint={t('dataSummaryHint', { max: L.summaryMax })}
            error={err('dataSummary')}
          >
            <Textarea
              id={id('data-summary')}
              rows={3}
              value={draft.dataSummary}
              disabled={disabled}
              invalid={!!err('dataSummary')}
              onChange={(e) => set('dataSummary', e.target.value)}
            />
          </Field>
          <Field
            label={t('dataRegions')}
            htmlFor={id('data-regions')}
            hint={t('dataRegionsHint', { max: L.regionsMax })}
            error={err('dataRegions')}
          >
            <Input
              id={id('data-regions')}
              value={draft.dataRegions}
              disabled={disabled}
              invalid={!!err('dataRegions')}
              onChange={(e) => set('dataRegions', e.target.value)}
            />
          </Field>
          <Field
            label={t('dataDeletion')}
            htmlFor={id('data-deletion')}
            hint={t('dataDeletionHint', { max: L.deletionMax })}
            error={err('dataDeletion')}
          >
            <Textarea
              id={id('data-deletion')}
              rows={2}
              value={draft.dataDeletion}
              disabled={disabled}
              invalid={!!err('dataDeletion')}
              onChange={(e) => set('dataDeletion', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title={t('sections.placement')} description={t('sections.placementHelp')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox
            id={id('first-party')}
            label={
              <span>
                {t('firstParty')}
                <span className="block text-xs text-muted-foreground">{t('firstPartyHint')}</span>
              </span>
            }
            checked={draft.firstParty}
            disabled={disabled}
            onChange={(e) => set('firstParty', e.target.checked)}
          />
          <Checkbox
            id={id('featured')}
            label={
              <span>
                {t('featured')}
                <span className="block text-xs text-muted-foreground">{t('featuredHint')}</span>
              </span>
            }
            checked={draft.featured}
            disabled={disabled}
            onChange={(e) => set('featured', e.target.checked)}
          />
          <Field
            label={t('planFeature')}
            htmlFor={id('plan-feature')}
            hint={t('planFeatureHint')}
            error={err('planFeature')}
          >
            <Select
              id={id('plan-feature')}
              value={draft.planFeature}
              disabled={disabled}
              invalid={!!err('planFeature')}
              onChange={(e) => set('planFeature', e.target.value)}
            >
              <option value="">{t('planFeatureNone')}</option>
              {draft.planFeature !== '' &&
                !(PLAN_FEATURE_KEYS as string[]).includes(draft.planFeature) && (
                  <option value={draft.planFeature}>{draft.planFeature}</option>
                )}
              {[...PLAN_FEATURE_KEYS]
                .sort((a, b) => a.localeCompare(b))
                .map((k) => (
                  <option key={k} value={k}>
                    {PLAN_FEATURE_LABELS[k]} ({k})
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label={t('sortOrder')}
            htmlFor={id('sort-order')}
            hint={t('sortOrderHint', { max: L.sortOrderMax })}
            error={err('sortOrder')}
          >
            <Input
              id={id('sort-order')}
              type="number"
              inputMode="numeric"
              min={0}
              max={L.sortOrderMax}
              value={draft.sortOrder}
              disabled={disabled}
              invalid={!!err('sortOrder')}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}
