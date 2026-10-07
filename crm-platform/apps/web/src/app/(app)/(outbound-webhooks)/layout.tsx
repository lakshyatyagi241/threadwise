import type { ReactNode } from 'react';
import { WebhooksProviders } from '@/features/outbound-webhooks/components/providers';

/** Shared frame of the Webhooks screen: the toast region. */
export default function WebhooksDomainLayout({ children }: { children: ReactNode }) {
  return <WebhooksProviders>{children}</WebhooksProviders>;
}
