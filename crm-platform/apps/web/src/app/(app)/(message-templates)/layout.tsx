import type { ReactNode } from 'react';
import { TemplatesProviders } from '@/features/message-templates/components/providers';

/** Shared frame of the template screens: the toast region. */
export default function MessageTemplatesLayout({ children }: { children: ReactNode }) {
  return <TemplatesProviders>{children}</TemplatesProviders>;
}
