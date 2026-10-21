'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext, type ReactNode } from 'react';

const BrandContext = createContext<string>('');

/**
 * The product name the platform settings configure (Settings > Branding, "App name"). The signed-in layout reads it once on the
 * server; every visible place (header logo, account menu, page titles, help copy) reads it here, so renaming the product is
 * one setting and nothing says another name. Blank = not configured: the default name from `common.appName` is used.
 */
export function BrandProvider({ name, children }: { name: string; children: ReactNode }) {
  return <BrandContext.Provider value={name.trim()}>{children}</BrandContext.Provider>;
}

export function useBrandName(): string {
  const configured = useContext(BrandContext);
  const fallback = useTranslations('common')('appName');
  return configured || fallback;
}
