'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PLAN_LIMIT_DEFS, PLAN_LIMIT_GROUPS, type PlanLimitKey } from '@crm/contracts';
import { Checkbox, Input } from '@crm/ui';
import { countLimitsSet, limitIsUnlimited, setLimitUnlimited } from '../lib/plan-draft';
import { useUnofficialSwitchState } from '@/features/node-bridge-runtime/use-unofficial-switch';
import {
  LIMIT_UNITS,
  filterKeys,
  isPlatformDefaultLimit,
  limitDisabledByPlatform,
} from '../lib/plan-editor-view';
import { NS, fieldId, type EditorState } from './plan-editor-shared';

/**
 * The Limits tab: grouped numeric caps with the hint, a unit, an Unlimited checkbox (stored as 0; the API
 * rate shows "Platform default" instead, since 0 means the platform default there), and a search box.
 */
export function LimitsTab({ state }: { state: EditorState }) {
  const t = useTranslations(NS);
  const { draft, problems, err, set } = state;
  const [query, setQuery] = useState('');
  // The devices cap only matters while the platform has the unofficial WhatsApp engine on; the operator is told when it is off.
  const unofficialSwitch = useUnofficialSwitchState();

  const label = (k: PlanLimitKey) => t(`limitKeys.${k}`);
  const hint = (k: PlanLimitKey) => t(`limitHints.${k}`);
  const groups = PLAN_LIMIT_GROUPS.map((group) => {
    const all = PLAN_LIMIT_DEFS.filter((d) => d.group === group).map((d) => d.key);
    return { group, all, shown: filterKeys(all, query, label, hint) };
  });
  const anyShown = groups.some((g) => g.shown.length > 0);

  function setUnlimited(key: PlanLimitKey, unlimited: boolean) {
    const next = setLimitUnlimited(draft, key, unlimited);
    set('limits', next.limits);
    if (!unlimited) {
      // The input is enabled only after this render: focus it (selected, so typing replaces the start value) then.
      requestAnimationFrame(() => {
        const el = document.getElementById(fieldId(`limits.${key}`)) as HTMLInputElement | null;
        el?.focus();
        el?.select();
      });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('limitsUi.intro')}</p>
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('limitsUi.searchPlaceholder')}
        aria-label={t('limitsUi.search')}
      />
      {!anyShown && <p className="text-sm text-muted-foreground">{t('limitsUi.noMatch')}</p>}
      {groups.map(({ group, all, shown }) =>
        shown.length === 0 ? null : (
          <section key={group} className="space-y-2" aria-labelledby={`plan-limits-${group}`}>
            <h4
              id={`plan-limits-${group}`}
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t(`limitGroups.${group}`)}{' '}
              <span className="font-normal normal-case">
                (
                {t('limitsUi.groupCount', {
                  count: countLimitsSet(draft.limits, all),
                  total: all.length,
                })}
                )
              </span>
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((key) => {
                const unlimited = limitIsUnlimited(draft.limits[key]);
                const error = err(`limits.${key}`);
                const id = fieldId(`limits.${key}`);
                const platformOff = limitDisabledByPlatform(key, unofficialSwitch);
                return (
                  <div
                    key={key}
                    className={`min-w-0 space-y-2 rounded-md border border-border p-3${platformOff ? ' opacity-60' : ''}`}
                    data-testid={`plan-limit-${key}`}
                    data-platform-disabled={platformOff || undefined}
                  >
                    <div className="space-y-0.5">
                      <label htmlFor={id} className="block text-sm font-medium">
                        {label(key)}
                      </label>
                      <p className="text-xs text-muted-foreground">{hint(key)}</p>
                      {platformOff && (
                        <p
                          className="text-xs font-medium text-warning"
                          data-testid={`plan-limit-${key}-platform-off`}
                        >
                          {t('limitsUi.unofficialOff')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id={id}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={unlimited ? '' : draft.limits[key]}
                        placeholder={
                          unlimited
                            ? t(
                                isPlatformDefaultLimit(key)
                                  ? 'limitsUi.platformDefault'
                                  : 'limitsUi.unlimited',
                              )
                            : undefined
                        }
                        disabled={unlimited}
                        onChange={(e) => set('limits', { ...draft.limits, [key]: e.target.value })}
                        invalid={Boolean(problems[`limits.${key}`])}
                        aria-describedby={error ? `${id}-error` : undefined}
                        className="min-w-0 flex-1 font-mono"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t(`limitUnits.${LIMIT_UNITS[key]}`)}
                      </span>
                    </div>
                    <Checkbox
                      id={`${id}-unlimited`}
                      checked={unlimited}
                      onChange={(e) => setUnlimited(key, e.target.checked)}
                      label={t(
                        isPlatformDefaultLimit(key)
                          ? 'limitsUi.platformDefault'
                          : 'limitsUi.unlimited',
                      )}
                    />
                    {error && (
                      <p id={`${id}-error`} role="alert" className="text-xs text-danger">
                        {error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
