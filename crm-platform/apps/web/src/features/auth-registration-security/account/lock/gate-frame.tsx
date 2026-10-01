'use client';

import type { ReactNode } from 'react';
import { FlashBanner } from '../account-banners';
import { PreferenceSync } from '../preference-sync';
import { GateHeader } from './gate-header';

/**
 * The frame of the pages that need a session but not the app shell: a slim top
 * bar, the one-line flash notice and the centred content column. A client
 * component, like the app shell, so the frame hydrates exactly as it rendered.
 */
export function GateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <PreferenceSync />
      <GateHeader />
      <FlashBanner />
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}
