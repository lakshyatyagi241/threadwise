import type { ReactNode } from 'react';
import { WidgetsProviders } from '@/features/chatbot-widget/components/widgets-providers';

/** Shared frame of the chatbot widget screens: the toast region. */
export default function ChatbotWidgetDomainLayout({ children }: { children: ReactNode }) {
  return <WidgetsProviders>{children}</WidgetsProviders>;
}
