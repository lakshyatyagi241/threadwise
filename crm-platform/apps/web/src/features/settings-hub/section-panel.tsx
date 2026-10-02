'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@crm/ui';
import type { SettingsSection } from '@/features/_registry/settings-types';
import { defaultSection, toSettingsSections } from '@/features/_registry/settings-resolve';
import { useSettingsTiles } from './settings-context';
import { TileCard } from './tile-card';

/**
 * The right-hand area of a Settings page: the section's title, its one-line description and a grid of tiles (three a row on a
 * desktop, two on a tablet, one on a phone). With no section given it shows the first one the person can see (`/settings`).
 */
export function SectionPanel({ section }: { section?: SettingsSection }) {
  const t = useTranslations();
  const tiles = useSettingsTiles();
  const sections = toSettingsSections(tiles);
  const current = section ?? defaultSection(sections);
  const entry = sections.find((s) => s.section === current);

  if (!current || !entry) {
    return (
      <EmptyState
        title={t('settings.emptySection.title')}
        message={t('settings.emptySection.message')}
      />
    );
  }
  const headingId = `settings-section-${current}`;
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <header>
        <h2 id={headingId} className="text-xl font-semibold tracking-tight">
          {t(`settings.sections.${current}.title`)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(`settings.sections.${current}.description`)}
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
