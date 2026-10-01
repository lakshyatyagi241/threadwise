import 'server-only';
import { cache } from 'react';
import { getSession } from '@/lib/auth/server';

/**
 * `getSession()` once per request: the (gate) layout and the page both need the
 * session, and this way the API is asked a single time.
 */
export const getRequestSession = cache(getSession);
