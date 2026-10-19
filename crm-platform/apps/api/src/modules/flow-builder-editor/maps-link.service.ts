import { Injectable } from '@nestjs/common';
import {
  flbIsMapsHost,
  flbParseMapsInput,
  type FlbMapsParse,
  type FlbResolveMapsResponse,
} from '@crm/contracts';
import { guardedRequest } from '../../infra/net/guarded-http';

const MAX_HOPS = 5;
const TIMEOUT_MS = 6_000;
const MAX_BYTES = 16_384;
const USER_AGENT = 'Threadwise-FlowBuilder/1.0';

type Hop = { status: number; location: string | null };
export type HopFetcher = (url: URL) => Promise<Hop>;

/** The real hop: one GET that is never redirected for us (the destination is checked here, hop by hop) and never to a private address. */
const fetchHop: HopFetcher = async (url) => {
  const res = await guardedRequest({
    method: 'GET',
    url,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    timeoutMs: TIMEOUT_MS,
    allowPrivate: false,
    maxBytes: MAX_BYTES,
  });
  const loc = res.headers.location;
  return { status: res.status, location: typeof loc === 'string' ? loc : null };
};

/**
 * Turns a pasted Google Maps link into coordinates for the Location step. A long link is read without any network call. A short
 * one (`maps.app.goo.gl/…`, `goo.gl/maps/…`) has to be followed, which makes this an outbound request to an operator-supplied
 * address, so (repo SSRF rules): only Google's own hosts are ever requested (checked on the pasted link and on every redirect),
 * https only after the first hop, at most 5 hops, a short deadline and byte cap, redirects never followed automatically, and the
 * private-address check runs inside the socket's own DNS lookup (`guardedRequest`), so there is no resolve-then-connect gap.
 * Every failure is a `problem` code, never an exception: the form shows it inline.
 */
@Injectable()
export class MapsLinkService {
  /** Overridden in tests. */
  hop: HopFetcher = fetchHop;

  async resolve(input: string): Promise<FlbResolveMapsResponse> {
    let parsed = flbParseMapsInput(input);
    try {
      for (let hops = 0; parsed.kind === 'short'; hops++) {
        if (hops >= MAX_HOPS) return { ok: false, problem: 'resolve_failed' };
        const next = await this.follow(new URL(parsed.url));
        if (!next) return { ok: false, problem: 'resolve_failed' };
        parsed = next;
      }
    } catch {
      return { ok: false, problem: 'resolve_failed' };
    }
    return parsed.kind === 'coords'
      ? { ok: true, lat: parsed.lat, lng: parsed.lng }
      : { ok: false, problem: parsed.problem };
  }

  /** One redirect of a short link, read as what the next link is; `null` when the hop is not a redirect we may follow. */
  private async follow(url: URL): Promise<FlbMapsParse | null> {
    // Only a short-link host is ever requested (a long link is read, not fetched), and only on its own https port.
    if (!flbIsMapsHost(url.hostname) || url.port !== '' || url.protocol !== 'https:') return null;
    const { status, location } = await this.hop(url);
    if (status < 300 || status > 399 || !location) return null;
    let target = new URL(location, url);
    // Google may bounce through a consent page that carries the real destination in `continue`.
    if (target.hostname.toLowerCase().startsWith('consent.')) {
      const cont = target.searchParams.get('continue');
      if (!cont) return null;
      target = new URL(cont);
    }
    if (target.protocol !== 'https:' || !flbIsMapsHost(target.hostname)) return null;
    return flbParseMapsInput(target.toString());
  }
}
