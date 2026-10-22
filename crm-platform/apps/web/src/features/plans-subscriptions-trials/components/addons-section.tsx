'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { AddonsList } from '@/features/addons-extension-registry/components/addons-list';

const NS = 'plans-subscriptions-trials.plans.addons';

/**
 * Add-ons on the Plans page (TW-PLAN-011): the shared add-ons list under its heading. The list is the add-ons domain's single component
 * (`GET /addons`, one card style, every card in one state); it is mounted here for every workspace, so a workspace on an active paid plan
 * sees and buys add-ons even when its plan lacks the `marketplace` feature, and a free-plan workspace gets the "needs a paid plan" message
 * with a link instead of nothing.
 */
export function AddonsSection() {
  const t = useTranslations(NS);
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-3" data-testid="addons-section">
      <h2 id={titleId} className="text-lg font-semibold">
        {t('title')}
      </h2>
      <AddonsList />
    </section>
  );
}
