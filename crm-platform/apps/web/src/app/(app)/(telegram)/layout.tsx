import type { ReactNode } from 'react';
import { TelegramProviders } from '@/features/channel-telegram/components/telegram-providers';

/** Shared frame of the Telegram screens: the toast region. */
export default function TelegramDomainLayout({ children }: { children: ReactNode }) {
  return <TelegramProviders>{children}</TelegramProviders>;
}
