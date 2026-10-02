import type { ReactNode } from 'react';

/** First-run setup: no session exists yet, so this group has no guard and no shell, just a centred frame. */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return <main className="min-h-dvh bg-muted px-4 py-10 sm:px-8">{children}</main>;
}
