import type { ReactNode } from 'react';
import { SheetsProviders } from '@/features/chrome-extension-sheets-addon/components/providers';

/** Shared frame of the Google Sheets add-on screens: the toast region. */
export default function SheetsDomainLayout({ children }: { children: ReactNode }) {
  return <SheetsProviders>{children}</SheetsProviders>;
}
