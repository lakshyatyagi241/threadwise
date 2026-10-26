'use client';

import { useTranslations } from 'next-intl';
import { AddonsList } from './addons-list';

const NS = 'addons-extension-registry.workspace';

/**
 * `/addons`: the same add-ons list the Plans page shows (`AddonsList`), under the page's own heading. Visibility and the state of every
 * card are decided by the API (`GET /addons`), not by this screen.
 */
export function WorkspaceAddonsPage() {
  const t = useTranslations(NS);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <AddonsList />
    </div>
  );
}
