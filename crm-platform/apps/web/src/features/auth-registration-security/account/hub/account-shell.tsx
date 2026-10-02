'use client';

import type { ReactNode } from 'react';
import { AccountFrame } from './account-frame';

/** The layout of /account/*: the shared hub frame around whichever pane the route renders (WD-AUTH-024). */
export function AccountShell({ children }: { children: ReactNode }) {
  return <AccountFrame>{children}</AccountFrame>;
}
