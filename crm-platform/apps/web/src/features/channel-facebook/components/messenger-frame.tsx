'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { FB_BLUE, MESSENGER_BLUE, PhoneIcon } from './fb-icons';
import { initial } from '../lib/format';

/** A compact Messenger phone frame (Reference's `messenger-frame`): the body shows how the piece being edited looks to a customer. */
export function MessengerFrame({
  pageName,
  children,
}: {
  pageName: string | null;
  children: ReactNode;
}) {
  const t = useTranslations('facebook.setup.frame');
  return (
    <div className="self-start xl:sticky xl:top-6">
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <PhoneIcon className="size-3" />
        {t('preview')}
      </div>
      <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[26px] border-[6px] border-foreground/90 bg-[#f5f6f7] shadow-sm dark:bg-muted">
        <div className="flex items-center gap-2.5 border-b border-border bg-background px-3 py-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
            style={{ background: FB_BLUE }}
          >
            {initial(pageName)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold leading-tight">
              {pageName || t('yourPage')}
            </div>
            <div className="text-[9.5px] font-medium text-success">{t('activeNow')}</div>
          </div>
          <svg
            viewBox="0 0 16 16"
            className="ml-auto size-4 shrink-0"
            fill={MESSENGER_BLUE}
            aria-hidden
          >
            <circle cx="4" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12" cy="8" r="1.3" />
          </svg>
        </div>
        <div className="flex h-[300px] flex-col px-3 py-3">{children}</div>
      </div>
    </div>
  );
}
