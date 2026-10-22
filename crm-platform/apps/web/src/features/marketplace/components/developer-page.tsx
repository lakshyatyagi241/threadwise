'use client';

import { useTranslations } from 'next-intl';
import { MarketplaceHeader } from './marketplace-header';
import { ToolCards } from './tool-cards';
import { PAGE } from './ui';

/**
 * The Developer tab (`/marketplace/developer`): the workspace's developer tools (REST API, Webhooks, Geta publishing, Translation) as
 * cards. They keep their Settings-registry gates, icons and copy; a role or plan without a tool does not get its card.
 */
export function DeveloperPage() {
  const t = useTranslations('marketplace.developerTab');
  return (
    <div className={PAGE}>
      <MarketplaceHeader section="developer" />
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <ToolCards tab="developer" showEmpty />
    </div>
  );
}
