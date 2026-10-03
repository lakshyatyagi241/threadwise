import type { ReactNode } from 'react';
import { cn } from '@crm/ui';

/**
 * The guest pages get their type from class names on the guest layout's wrapper (`--font-auth-*` variables). The
 * console has no such wrapper, so the auth-pages preview brings its own around the design. `display: contents`
 * draws no box of its own, so the shell keeps its height rules; custom properties still inherit through it.
 */
export function PreviewFonts({ fontClass, children }: { fontClass?: string; children: ReactNode }) {
  return <div className={cn('contents', fontClass)}>{children}</div>;
}
