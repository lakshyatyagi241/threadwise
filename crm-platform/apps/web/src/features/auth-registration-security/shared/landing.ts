import type { AccountFlags, Landing } from '@crm/contracts';
import { GATE_ROUTES } from './gate-routes';

/**
 * Where a signed-in person lands. Mirrors `homePathFor` in lib/auth/server.ts
 * (server-only, so client code cannot import it): one rule, two runtimes.
 */
export function landingPath(landing: Landing, flags: Pick<AccountFlags, 'suspended'>): string {
  if (flags.suspended) return GATE_ROUTES.suspended;
  if (landing === 'onboarding') return GATE_ROUTES.onboarding;
  return landing === 'inbox' ? '/inbox' : '/dashboard';
}
