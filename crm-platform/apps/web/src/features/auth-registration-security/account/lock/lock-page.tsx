'use client';

import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { PreferenceSync } from '../preference-sync';

/**
 * A lock screen (suspended account, unverified email): one centred card on the quiet page colour, a round icon
 * on top, a serif title whose last words are in the accent colour. Standalone, as in the reference product: the
 * person is locked out of everything else, so there is no navigation and no showcase panel.
 */
export function LockPage({
  tone,
  icon,
  lead,
  accent,
  children,
}: {
  tone: 'danger' | 'warning';
  icon: ReactNode;
  /** The plain part of the title. */
  lead: string;
  /** The coloured, italic part of the title. */
  accent: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-muted px-6 py-12">
      <PreferenceSync />
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-7 shadow-(--auth-shadow-card)">
        <span
          className={cn(
            'mx-auto mb-4 grid size-12 place-items-center rounded-full',
            tone === 'danger'
              ? 'bg-(--auth-coral)/10 text-(--auth-coral)'
              : 'bg-(--auth-amber)/10 text-(--auth-amber)',
          )}
        >
          {icon}
        </span>
        <h1 className="text-center font-serif text-[26px] leading-tight">
          {lead}{' '}
          <span
            className={cn(
              'italic rtl:not-italic',
              tone === 'danger' ? 'text-(--auth-coral)' : 'text-(--auth-link)',
            )}
          >
            {accent}
          </span>
        </h1>
        {children}
      </div>
    </div>
  );
}
