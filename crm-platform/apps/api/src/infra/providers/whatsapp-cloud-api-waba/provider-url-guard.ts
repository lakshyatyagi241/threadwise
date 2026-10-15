import { lookup } from 'node:dns/promises';
import { isBlockedAddress } from '../../net/blocked-address';
import { checkProviderBaseUrl } from '@crm/contracts';

/**
 * The half of the provider base-URL rule that a URL cannot show: where the name POINTS. A registry provider's address is typed by a
 * platform operator and every call to it carries a credential, so it must never be a way to reach the platform's own network (the
 * metadata service, the database, an internal admin port). `checkProviderBaseUrl` (contracts) refuses the shape (https, public DNS
 * name, no credentials); this resolves the name and refuses it when ANY address it resolves to is private, loopback, link-local,
 * shared-address, multicast or reserved. IP literals never get here (the shape check refuses them) but are classified anyway.
 *
 * It runs when a provider is saved, when it is tested, and before every call through it (WabaHttp). Resolving and then connecting is
 * not atomic (a rebinding DNS server could answer differently the second time); the check narrows the window to a request and the
 * https-only rule means a rebound private address cannot present a certificate for the provider's name.
 */

export class UnsafeProviderUrlError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnsafeProviderUrlError';
  }
}

export interface PublicUrlOptions {
  /** Development only: a loopback host over plain http, and no DNS check. Never honoured when NODE_ENV is `production`. */
  allowDevHosts?: boolean;
  /** Replaced in tests. */
  resolve?: (host: string) => Promise<string[]>;
}

const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** True for an address a provider must not live on (the shared rule, `infra/net/blocked-address.ts`). */
export function isNonPublicAddress(address: string): boolean {
  return isBlockedAddress(address.trim().replace(/^\[|\]$/g, ''));
}

/** Throws UnsafeProviderUrlError unless `raw` is an https address on a host whose every resolved address is public. */
export async function assertPublicUrl(raw: string, options: PublicUrlOptions = {}): Promise<void> {
  const dev = options.allowDevHosts === true && process.env.NODE_ENV !== 'production';
  const verdict = checkProviderBaseUrl(raw, { allowDevLoopback: dev });
  if (!verdict.ok) throw new UnsafeProviderUrlError(verdict.reason);
  if (verdict.devLoopback || dev) return; // development only: a stand-in on the developer's own machine
  const addresses = await (options.resolve ?? defaultResolve)(verdict.host).catch(() => {
    throw new UnsafeProviderUrlError('The host name does not resolve');
  });
  if (addresses.length === 0) throw new UnsafeProviderUrlError('The host name does not resolve');
  if (addresses.some(isNonPublicAddress)) {
    throw new UnsafeProviderUrlError('The host name resolves to a private or reserved address');
  }
}
