'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';

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

export function useSettingsTiles(): readonly ResolvedSettingsTile[] {
  return useContext(SettingsTilesContext);
}
