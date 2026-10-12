'use client';

import { MarketplaceHeader } from './marketplace-header';
import { ToolCards } from './tool-cards';
import { PAGE } from './ui';

/** The Add-ons tab of the Marketplace (`/marketplace/addons`): the workspace's own tools and developer features, as cards. */
export function AddonsPage() {
  return (
    <div className={PAGE}>
      <MarketplaceHeader section="addons" />
      <ToolCards tab="addons" showEmpty />
    </div>
  );
}
