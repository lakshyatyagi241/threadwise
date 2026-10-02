import type { ReactNode } from 'react';
import { AiProviders } from '@/features/ai-keys-usage-admin/workspace/providers';

/** Shared frame of the AI usage and AI keys screens: the toast region. */
export default function AiDomainLayout({ children }: { children: ReactNode }) {
  return <AiProviders>{children}</AiProviders>;
}
