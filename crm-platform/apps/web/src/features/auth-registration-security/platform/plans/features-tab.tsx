'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  PLAN_FEATURE_DEFS,
  PLAN_PRODUCT_LINES,
  type PlanFeatureKey,
  type PlanProductLine,
} from '@crm/contracts';
import { Badge, Button, Input, Switch } from '@crm/ui';
import {
  countFeaturesOn,
  offerFeatures,
  packLockedFeatures,
  toggleFeatures,
  type PackGrants,
} from '../lib/plan-draft';
import { filterKeys } from '../lib/plan-editor-view';
import { NS, ToggleRow, ToolbarRow, type EditorState } from './plan-editor-shared';

/**
 * The Features tab: switches grouped by PRODUCT LINE (Chat, Sales CRM, Platform), a hint and a line badge each, a search box and per-group
 * Enable all / Disable all. An edition is made here as data: a Chat plan is "Disable all" under Sales CRM, a Sales CRM plan the other way round.
 *
 * A key a plain add-on grants is not set here: the add-on's mode on the Add-ons tab sets it (included -> on, paid or hidden -> off), so its
 * switch is read-only, says which add-on sets it, and Enable all / Disable all skip it.
 */
export function FeaturesTab({
  state,
  packs = [],
}: {
  state: EditorState;
  /** The plain add-ons the Add-ons tab lists (empty while they load or when they failed: nothing is locked then). */
  packs?: ReadonlyArray<PackGrants & { name: string }>;
}) {
  const t = useTranslations(NS);
  const { draft, set } = state;
  const [query, setQuery] = useState('');
  const locked = packLockedFeatures(packs);
  const fromOffers = offerFeatures(draft, packs);
  const free = (keys: readonly PlanFeatureKey[]) => keys.filter((k) => !locked.has(k));

  const label = (k: PlanFeatureKey) => t(`featureKeys.${k}`);
  const hint = (k: PlanFeatureKey) => t(`featureHints.${k}`);
  const lineOf = (k: PlanFeatureKey): PlanProductLine =>
    PLAN_FEATURE_DEFS.find((d) => d.key === k)!.productLine;
  const groups = PLAN_PRODUCT_LINES.map((group) => {
    const all = PLAN_FEATURE_DEFS.filter((d) => d.productLine === group).map((d) => d.key);
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
                {t(`productLines.${group}`)}{' '}
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
                onClick={() => set('features', toggleFeatures(draft.features, free(shown), true))}
              >
                {t('featuresUi.enableAll')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => set('features', toggleFeatures(draft.features, free(shown), false))}
              >
                {t('featuresUi.disableAll')}
              </Button>
            </ToolbarRow>
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((key) => {
                const badge = (
                  <Badge tone={lineOf(key) === 'platform' ? 'neutral' : 'success'}>
                    {t(`productLines.${lineOf(key)}`)}
                  </Badge>
                );
                const by = locked.get(key);
                return by ? (
                  <LockedRow
                    key={key}
                    id={`plan-feature-${key}`}
                    label={label(key)}
                    hint={hint(key)}
                    badge={badge}
                    note={t('featuresUi.lockedBy', { addon: by.join(', ') })}
                    checked={fromOffers[key] ?? draft.features[key] ?? false}
                  />
                ) : (
                  <ToggleRow
                    key={key}
                    id={`plan-feature-${key}`}
                    label={label(key)}
                    hint={hint(key)}
                    badge={badge}
                    checked={draft.features[key]}
                    onChange={(v) => set('features', { ...draft.features, [key]: v })}
                  />
                );
              })}
            </div>
          </section>
        ),
      )}
    </div>
  );
}

/** A feature switch an add-on sets: shown as the save will store it, never editable here, with the add-on named. */
function LockedRow({
  id,
  label,
  hint,
  badge,
  note,
  checked,
}: {
  id: string;
  label: string;
  hint: string;
  badge: ReactNode;
  note: string;
  checked: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-md border border-dashed border-border p-3"
      data-testid={`${id}-locked`}
    >
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
          <span className="ms-2 align-middle">{badge}</span>
        </label>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <p className="text-xs font-medium text-foreground">{note}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={() => undefined}
        // The switch takes no description, so its name carries why it is locked.
        label={`${label}. ${note}`}
        disabled
      />
    </div>
  );
}
