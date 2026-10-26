'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AddonsList } from '@/features/addons-extension-registry/components/addons-list';
import { mktRoutes } from '../lib/routes';
import { MarketplaceHeader } from './marketplace-header';
import { PAGE, TEXT_LINK } from './ui';

/**
 * The Add-ons tab of the Marketplace (`/marketplace/addons`): the workspace's add-on packs, in the one shared list that the Plans page
 * shows too (`AddonsList`: Included in your plan / Active / Buy / Unavailable, and the "Top up wallet" note). It has no tool cards: the
 * developer tools moved to the Developer tab. The tab sits inside the Marketplace plan gate; a plan without the `marketplace` feature
 * is shown the upgrade sheet here, which points to Plans and add-ons, where the same list stays available.
 */
export function AddonsPage() {
  const t = useTranslations('marketplace.addonsTab');
  return (
    <div className={PAGE}>
      <MarketplaceHeader section="addons" />
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <AddonsList />
      <p className="text-sm text-muted-foreground" data-testid="mkt-addons-dev-hint">
        {t('developerHint')}{' '}
        <Link href={mktRoutes.developer} className={TEXT_LINK}>
          {t('developerLink')}
        </Link>
      </p>
    </div>
  );
}
