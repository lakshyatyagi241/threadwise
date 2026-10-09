'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { NavLayoutKey, ShellMode } from '@crm/contracts';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import type { ProfileMenuData } from './user-menu';

/** What the shell resolved for this person; screens that live inside it (the More page) read it instead of re-resolving. */
export interface ShellData {
  nav: readonly ResolvedNavItem[];
  tiles: readonly ResolvedSettingsTile[];
  mode: ShellMode;
  bar: readonly NavLayoutKey[];
  /** The wallet balance chip text, when the wallet domain provides one. */
  walletLabel?: string;
  /** The workspace's own header logo (WD-ASHELL-025); null shows the platform mark. */
  brandLogoUrl?: string | null;
  /** Plan and role for the account menu's chip. */
  profile?: ProfileMenuData;
}

const ShellDataContext = createContext<ShellData | null>(null);

export function ShellDataProvider({ value, children }: { value: ShellData; children: ReactNode }) {
  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellData {
  const v = useContext(ShellDataContext);
  if (!v) throw new Error('useShellData must be used inside the app shell');
  return v;
}

/** The shell's data when there is a shell around; null in isolation (a test, a story). */
export const useOptionalShellData = (): ShellData | null => useContext(ShellDataContext);
