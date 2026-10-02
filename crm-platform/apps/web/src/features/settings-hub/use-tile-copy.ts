'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { splitKeywords, type SearchableTile } from './settings-search';

/** The tiles with their words in the current language, ready for the search. */
export function useSearchableTiles(tiles: readonly ResolvedSettingsTile[]): SearchableTile[] {
  const t = useTranslations();
  return useMemo(
    () =>
      tiles.map((tile) => ({
        tile,
        label: t(tile.labelKey),
        description: tile.descriptionKey ? t(tile.descriptionKey) : '',
        keywords: tile.keywordsKey ? splitKeywords(t(tile.keywordsKey)) : [],
        sectionTitle: t(`settings.sections.${tile.section}.title`),
      })),
    [tiles, t],
  );
}
