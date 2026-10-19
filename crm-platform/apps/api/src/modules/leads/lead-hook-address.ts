import { Injectable } from '@nestjs/common';
import { LEAD_HOOK_PATH_PREFIX, type LeadHookAddress } from '@crm/contracts';

/**
 * The complete public address of a lead source's webhook (BL-061). The path is `LEAD_HOOK_PATH_PREFIX + token`; what goes in front is
 * the platform's configured public API address, `APP_URL` (the same setting the channel webhooks, the calendar callbacks and the
 * marketplace hooks use).
 *
 * The rule is "no address is better than a wrong address": `APP_URL` has a development default (`http://localhost:3000`) so that
 * the API boots anywhere, and a hook address built from that default and pasted into an ad platform silently never receives a lead.
 * So the default does not count as configured (the raw environment is read, not the schema's default), and in production an address
 * that points at the machine itself or a private network is refused too. The caller gets `baseUrl: null` and the reason, and the
 * screen tells the person to ask whoever runs the platform to set the public API address.
 */

/** Hosts that only the machine itself or its own network can reach: no ad platform can deliver a lead there. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || h.startsWith('fe80');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * Pure: the public origin from the raw `APP_URL` of the environment. A path prefix (a reverse proxy that mounts the API under `/api`)
 * is kept; trailing slashes, a query and a fragment are dropped. `isProduction` decides whether a private address is a problem: a
 * developer's own machine is allowed to use it, a production server is not.
 */
export function resolveHookBase(input: {
  appUrl: string | undefined;
  isProduction: boolean;
}): LeadHookAddress {
  const raw = (input.appUrl ?? '').trim();
  if (raw === '') return { baseUrl: null, problem: 'base_url_not_configured' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { baseUrl: null, problem: 'base_url_not_configured' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { baseUrl: null, problem: 'base_url_not_configured' };
  }
  if (input.isProduction && isPrivateHost(url.hostname)) {
    return { baseUrl: null, problem: 'base_url_not_public' };
  }
  return { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, problem: null };
}

/** The complete address of one hook, or null when the base is unusable. */
export function hookUrlFor(base: LeadHookAddress, token: string): string | null {
  return base.baseUrl === null ? null : `${base.baseUrl}${LEAD_HOOK_PATH_PREFIX}${token}`;
}

/** Reads the environment at the moment of the call, so a changed setting is picked up by the next response without a restart of tests. */
@Injectable()
export class LeadHookAddressService {
  current(): LeadHookAddress {
    return resolveHookBase({
      appUrl: process.env.APP_URL,
      isProduction: process.env.NODE_ENV === 'production',
    });
  }
}
