import { Injectable } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import type { DnsResolverPort } from './dns-resolver.port';

/** Real DNS. Only CNAME records count (an A record or ALIAS flattening never verifies, as in WaDesk). */
@Injectable()
export class SystemDnsResolver implements DnsResolverPort {
  async resolveCname(host: string): Promise<string[]> {
    try {
      return await dns.resolveCname(host);
    } catch {
      return [];
    }
  }
}

/** Answers tests set per host; chosen by `STORE_PROVIDER_MODE=fixture`. */
export const fixtureCnames = new Map<string, string[]>();

@Injectable()
export class FixtureDnsResolver implements DnsResolverPort {
  async resolveCname(host: string): Promise<string[]> {
    return fixtureCnames.get(host.toLowerCase()) ?? [];
  }
}
