'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  MARKETPLACE_TOOLS_SECTION,
  type ResolvedSettingsTile,
} from '@/features/_registry/settings-types';

const SettingsTilesContext = createContext<readonly ResolvedSettingsTile[]>([]);

/** Hands the person's resolved tiles (gates applied on the server) to the Settings pages and to the back breadcrumb. */
export function SettingsTilesProvider({
  tiles,
  children,
}: {
  tiles: readonly ResolvedSettingsTile[];
  children: ReactNode;
}) {
  return <SettingsTilesContext.Provider value={tiles}>{children}</SettingsTilesContext.Provider>;
}

/** The tiles the Settings pages and Settings search show: everything except the tools that live in the Marketplace. */
export function useSettingsPageTiles(): readonly ResolvedSettingsTile[] {
  const tiles = useContext(SettingsTilesContext);
  return useMemo(() => tiles.filter((t) => t.section !== MARKETPLACE_TOOLS_SECTION), [tiles]);
}

export function useSettingsTiles(): readonly ResolvedSettingsTile[] {
  return useContext(SettingsTilesContext);
}
