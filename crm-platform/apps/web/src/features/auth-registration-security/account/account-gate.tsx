'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '../shared/session-context';
import { gateTarget } from './gate-target';

/**
 * Sends a gated account to the screen that resolves its gate and keeps it there
 * (WD-AUTH-016/032/035): suspended, forced password change, required MFA
 * enrolment, unverified email (policy "block"), unfinished first-run setup.
 *
 * The API enforces every gate regardless; this only avoids rendering pages that
 * would fail. The rules live in `gate-target.ts`, which is unit-tested to prove
 * every destination is exempt from its own gate (WaDesk's Force2FA looped).
 * The lock screens themselves live outside this layout, under `(gate)`.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const { flags, landing } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const target = gateTarget({ pathname, flags, landing });

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return target ? null : <>{children}</>;
}
