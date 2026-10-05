'use client';

import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { MARKET_PERMISSIONS, type MarketAccess } from '../lib/permissions';

/** What the signed-in person may do in the Marketplace. A permission absent from the session is denied; the API stays the authority. */
export function useMarketAccess(): MarketAccess {
  const read = useCan(MARKET_PERMISSIONS.read);
  const install = useCan(MARKET_PERMISSIONS.install);
  const manage = useCan(MARKET_PERMISSIONS.manage);
  return { read, install, manage };
}
