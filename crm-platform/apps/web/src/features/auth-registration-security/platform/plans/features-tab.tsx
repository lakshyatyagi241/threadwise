'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PLAN_FEATURE_DEFS, PLAN_FEATURE_GROUPS, type PlanFeatureKey } from '@crm/contracts';
import { Button, Input } from '@crm/ui';
import { countFeaturesOn, toggleFeatures } from '../lib/plan-draft';
import { filterKeys } from '../lib/plan-editor-view';
import { NS, ToggleRow, ToolbarRow, type EditorState } from './plan-editor-shared';

/** The Features tab: grouped switches with a hint each, a search box and per-group Enable all / Disable all. */
export function FeaturesTab({ state }: { state: EditorState }) {
  const t = useTranslations(NS);
  const { draft, set } = state;
  const [query, setQuery] = useState('');

  const label = (k: PlanFeatureKey) => t(`featureKeys.${k}`);
  const hint = (k: PlanFeatureKey) => t(`featureHints.${k}`);
  const groups = PLAN_FEATURE_GROUPS.map((group) => {
    const all = PLAN_FEATURE_DEFS.filter((d) => d.group === group).map((d) => d.key);
    return { group, all, shown: filterKeys(all, query, label, hint) };
  });
  const anyShown = groups.some((g) => g.shown.length > 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('featuresUi.intro')}</p>
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('featuresUi.searchPlaceholder')}
        aria-label={t('featuresUi.search')}
      />
      {!anyShown && <p className="text-sm text-muted-foreground">{t('featuresUi.noMatch')}</p>}
      {groups.map(({ group, all, shown }) =>
        shown.length === 0 ? null : (
          <section key={group} className="space-y-2" aria-labelledby={`plan-features-${group}`}>
            <ToolbarRow>
              <h4
                id={`plan-features-${group}`}
                className="me-auto text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {t(`featureGroups.${group}`)}{' '}
                <span className="font-normal normal-case">
                  (
                  {t('featuresUi.groupCount', {
                    count: countFeaturesOn(draft.features, all),
                    total: all.length,
                  })}
                  )
                </span>
              </h4>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => set('features', toggleFeatures(draft.features, shown, true))}
              >
                {t('featuresUi.enableAll')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => set('features', toggleFeatures(draft.features, shown, false))}
              >
                {t('featuresUi.disableAll')}
              </Button>
            </ToolbarRow>
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((key) => (
                <ToggleRow
                  key={key}
                  id={`plan-feature-${key}`}
                  label={label(key)}
                  hint={hint(key)}
                  checked={draft.features[key]}
                  onChange={(v) => set('features', { ...draft.features, [key]: v })}
                />
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
