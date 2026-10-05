'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PLAN_FEATURE_KEYS, PLAN_LIMIT_KEYS } from '@crm/contracts';
import { Tabs } from '@crm/ui';
import type { PlanTab } from '../lib/plan-editor-view';
import { NS } from './plan-editor-shared';

export interface TabCounts {
  featuresOn: number;
  limitsSet: number;
  addons: number;
}

function TabLabel({
  tab,
  counts,
  hasError,
}: {
  tab: PlanTab;
  counts: TabCounts;
  hasError: boolean;
}) {
  const t = useTranslations(NS);
  // The visible chip is a short number; the screen-reader text spells it out.
  const chip =
    tab === 'features'
      ? {
          text: `${counts.featuresOn}/${PLAN_FEATURE_KEYS.length}`,
          full: t('tabSummary.features', {
            count: counts.featuresOn,
            total: PLAN_FEATURE_KEYS.length,
          }),
        }
      : tab === 'limits'
        ? {
            text: `${counts.limitsSet}/${PLAN_LIMIT_KEYS.length}`,
            full: t('tabSummary.limits', {
              count: counts.limitsSet,
              total: PLAN_LIMIT_KEYS.length,
            }),
          }
        : tab === 'addons'
          ? {
              text: String(counts.addons),
              full: t('tabSummary.addons', { count: counts.addons }),
            }
          : null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {t(`tabs.${tab}`)}
      {chip && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] leading-none text-muted-foreground">
          <span aria-hidden="true">{chip.text}</span>
          <span className="sr-only">{chip.full}</span>
        </span>
      )}
      {hasError && (
        <>
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-danger"
            data-testid={`plan-tab-error-${tab}`}
          />
          <span className="sr-only">{t('tabSummary.error')}</span>
        </>
      )}
    </span>
  );
}

/**
 * The editor's four sections as tabs (Details and pricing, Features, Limits, Add-ons). On a phone the
 * strip scrolls sideways inside itself (the shared Tabs list), never the page. Each tab shows a count
 * and an error dot while a problem sits inside it.
 */
export function PlanEditorTabs({
  active,
  onChange,
  counts,
  errorTabs,
  panels,
}: {
  active: PlanTab;
  onChange: (tab: PlanTab) => void;
  counts: TabCounts;
  errorTabs: readonly PlanTab[];
  panels: Record<PlanTab, ReactNode>;
}) {
  const tabs: PlanTab[] = ['details', 'features', 'limits', 'addons'];
  return (
    <Tabs
      value={active}
      onValueChange={(id) => onChange(id as PlanTab)}
      items={tabs.map((tab) => ({
        id: tab,
        label: <TabLabel tab={tab} counts={counts} hasError={errorTabs.includes(tab)} />,
        content: panels[tab],
      }))}
    />
  );
}
