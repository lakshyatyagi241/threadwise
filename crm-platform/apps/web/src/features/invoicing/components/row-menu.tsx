'use client';

import type { ReactNode } from 'react';
import { Menu } from '@crm/ui';

/** The "..." button at the end of a row. `children` is a function that receives `close`. */
export function RowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <Menu
      label={label}
      align="end"
      triggerClassName="size-8 shrink-0 border-transparent bg-transparent px-0 text-muted-foreground hover:bg-background hover:text-foreground"
      triggerProps={{ 'aria-label': label }}
      trigger={
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      }
    >
      {children}
    </Menu>
  );
}
