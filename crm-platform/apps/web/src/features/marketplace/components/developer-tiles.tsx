'use client';

import { useTranslations } from 'next-intl';
import { toSettingsSections } from '@/features/_registry/settings-resolve';
import { useSettingsTiles } from '@/features/settings-hub/settings-context';
import { TileCard } from '@/features/settings-hub/tile-card';

/**
 * The tools that used to sit on Settings > Integrations and developer (REST API, Webhooks, Google Calendar, Add-ons, Shopify,
 * WooCommerce...), shown at the top of the Marketplace Integrations tab so there is one place to connect things. The tiles come
 * from the same registry and gates as Settings, so a person sees only what their role and plan allow.
 */
export function DeveloperTiles() {
  const t = useTranslations();
  const tiles = useSettingsTiles();
  const entry = toSettingsSections(tiles).find((s) => s.section === 'integrations');
  if (!entry) return null;
  return (
    <section aria-labelledby="mkt-dev-tools" className="space-y-3" data-testid="mkt-dev-tools">
      <header>
        <h2 id="mkt-dev-tools" className="text-base font-semibold">
          {t('settings.sections.integrations.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('settings.sections.integrations.description')}
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {entry.tiles.map((tile) => (
          <li key={tile.id} className="min-w-0">
            <TileCard
              tile={tile}
              label={t(tile.labelKey)}
              description={tile.descriptionKey ? t(tile.descriptionKey) : undefined}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
