'use client';

import { Suspense, type ReactNode } from 'react';
import { StoreSidebar } from './sidebar';
import { Skeleton } from './parts';

/**
 * The frame of every `/store/*` page: the store sidebar on the left (260px, stacked above the content on small
 * screens) and the page on the right. Sibling domains (products, reviews, orders ...) wrap their pages in it.
 */
export function StoreShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Suspense fallback={<Skeleton className="h-64" />}>
        <StoreSidebar />
      </Suspense>
      <section className="min-w-0 space-y-5">{children}</section>
    </div>
  );
}
