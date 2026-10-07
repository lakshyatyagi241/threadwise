import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { isBlockedAddress } from '../../../net/blocked-address';
import { providerHostOf, type MediaProviderProfile } from './media-provider';
import type { WhatsappMediaConfig } from './whatsapp-media.config';
import { MEDIA_FAILURE, MediaFetchError } from './media-fetch-error';

/**
 * The SSRF guard of the media pipeline. The download address comes out of a JSON answer from Meta, which makes it data from outside:
 * a compromised or spoofed answer must not be able to send the worker to an internal service (the cloud metadata address, Redis,
 * Postgres, an admin port) with our access token in the request.
 *
 * Three layers, each of which refuses on its own:
 *   1. the url: https only, no credentials in it, the default port, and a host from the policy: the provider's own host, Meta's media
 *      hosts, and (for a download) the host the provider's lookup answered with;
 *   2. the address the host RESOLVES to: every address must be a public one (checked inside the connection's own lookup, so the
 *      address that was checked is the address that is connected to; there is no gap in which a DNS answer can change);
 *   3. redirects are never followed by the HTTP client: each hop is one more request that goes through layers 1 and 2 again, and a host
 *      that is not already on the policy cannot be reached by a redirect.
 *
 * The only relaxation is for tests and local development: a provider profile whose base URL is plain http on a loopback address (a fake
 * Graph server) is accepted outside production, and that one host is then also reachable over http. Production refuses it.
 */

/** Hosts Meta serves WhatsApp media from. `.x` matches `x` and any subdomain of it. */
export const META_MEDIA_HOST_SUFFIXES: readonly string[] = [
  '.fbsbx.com', // lookaside.fbsbx.com: the host of WhatsApp media downloads
  '.fbcdn.net',
  '.whatsapp.net',
  '.whatsapp.com',
  '.facebook.com',
];

/** What a request may reach. Built from the channel's provider profile by `downloadPolicy`. */
export interface HostPolicy {
  /** Exact host names (`graph.facebook.com`) and `.suffix` entries. */
  hosts: readonly string[];
  /** Plain http on this loopback host is allowed (the dev/test fake server), any port. */
  loopbackHost: string | null;
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The one host the profile's own address may be plain http on: a loopback fake in development and tests. A provider address that is not
 * https is refused everywhere else, and in production everywhere (an access token must never travel over plain http).
 */
function loopbackHostOf(profile: MediaProviderProfile, cfg: WhatsappMediaConfig): string | null {
  const base = new URL(profile.baseUrl);
  if (base.protocol === 'https:') return null;
  if (base.protocol === 'http:' && LOOPBACK_NAMES.has(base.hostname) && !cfg.production) {
    return base.hostname;
  }
  throw new MediaFetchError(
    MEDIA_FAILURE.URL_REJECTED,
    'The WhatsApp provider address must be https.',
    false,
  );
}

/**
 * Where a file may be downloaded from: the provider's own host, Meta's media hosts, any configured extras, and the one host the
 * provider's lookup answered with (`returnedUrl`; a BSP proxy may serve files from a storage host of its own). The address checks still
 * apply to every one of them (https, no address literals, public addresses only), and `downloadAuthApplies` decides separately where the
 * provider's credentials may go, which is not the whole list.
 */
export function downloadPolicy(
  profile: MediaProviderProfile,
  cfg: WhatsappMediaConfig,
  returnedUrl?: string,
): HostPolicy {
  let returned: string[] = [];
  if (returnedUrl) {
    try {
      returned = [new URL(returnedUrl).hostname.toLowerCase()];
    } catch {
      // not a url: assertAllowedUrl refuses it with the proper reason
    }
  }
  return {
    hosts: [providerHostOf(profile), ...META_MEDIA_HOST_SUFFIXES, ...cfg.extraHosts, ...returned],
    loopbackHost: loopbackHostOf(profile, cfg),
  };
}

export const isMetaMediaHost = (host: string): boolean =>
  hostAllowed(host.toLowerCase(), META_MEDIA_HOST_SUFFIXES);

/**
 * Whether the provider's credentials go with a download from `host`: to the provider's own host always (it is theirs), to Meta's media
 * hosts when the channel authenticates with its own token (a BSP's platform credential is not sent to Meta's CDN), and never to any other host (a storage host named by a lookup answer
 * is fetched without credentials: such a link carries its own signature).
 */
export function downloadAuthApplies(host: string, profile: MediaProviderProfile): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === providerHostOf(profile)) return true;
  // Meta's download address needs the channel's own access token (`channel_token`). A platform-level provider credential belongs
  // to a BSP and is not sent to Meta's CDN.
  return profile.credentialMode === 'channel_token' && isMetaMediaHost(h);
}

const reject = (why: string): never => {
  throw new MediaFetchError(MEDIA_FAILURE.URL_REJECTED, `Download address refused: ${why}`, false);
};

const hostAllowed = (host: string, hosts: readonly string[]): boolean =>
  hosts.some((h) => (h.startsWith('.') ? host === h.slice(1) || host.endsWith(h) : host === h));

/** Layer 1. Returns the parsed url, or throws a permanent `MEDIA_URL_REJECTED`. */
export function assertAllowedUrl(raw: string, policy: HostPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('not a url');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback =
    policy.loopbackHost !== null && host === policy.loopbackHost.replace(/^\[|\]$/g, '');

  if (url.username !== '' || url.password !== '') return reject('credentials in the url');
  if (url.protocol === 'http:') {
    if (!loopback) return reject('not https');
  } else if (url.protocol === 'https:') {
    if (url.port !== '' && url.port !== '443' && !loopback) return reject('unexpected port');
  } else {
    return reject('not https');
  }
  if (!loopback) {
    // An address literal would skip the DNS step, so it is never a media host (a Meta host is always a name).
    if (isIP(host) !== 0) return reject('an ip address, not a host name');
    if (!hostAllowed(host, policy.hosts))
      return reject(`host ${host} is not a WhatsApp media host`);
  }
  return url;
}

// --- layer 2: addresses ---------------------------------------------------------------------------------------------------------

/**
 * True only for an address routable on the public internet. The rule is shared (`infra/net/blocked-address.ts`): it also refuses every
 * IPv6 form that carries a blocked IPv4 address (mapped in dotted or hex form, NAT64, 6to4). Text that is not an address is false.
 */
export const isPublicAddress = (address: string): boolean => !isBlockedAddress(address);

export type DnsResolver = (
  host: string,
  cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolver: DnsResolver = (host, cb) => dnsLookup(host, { all: true }, cb);

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

/**
 * The `lookup` function handed to the HTTP client. The client connects to what THIS returns, so the check and the connection cannot
 * disagree: if any answer for the name is not public, the connection is never made. A loopback host that the policy allows (the dev
 * fake) is the one name that may resolve to a loopback address.
 */
export function guardedLookup(policy: HostPolicy, resolver: DnsResolver = systemResolver) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    cb: LookupCallback,
  ): void => {
    const all = typeof options === 'object' && options?.all === true;
    const finish = (list: LookupAddress[]) =>
      all ? cb(null, list) : cb(null, list[0]!.address, list[0]!.family);
    const bare = hostname.replace(/^\[|\]$/g, '');

    resolver(bare, (err, addresses) => {
      if (err) return cb(err);
      if (!addresses.length)
        return cb(Object.assign(new Error(`no address for ${bare}`), { code: 'ENOTFOUND' }));
      const loopbackOk =
        policy.loopbackHost !== null && bare === policy.loopbackHost.replace(/^\[|\]$/g, '');
      const bad = addresses.find((a) => !isPublicAddress(a.address) && !loopbackOk);
      if (bad) {
        return cb(
          Object.assign(new Error(`${bare} resolves to a non-public address`), {
            code: 'EBLOCKED',
          }),
        );
      }
      finish(addresses);
    });
  };
}
