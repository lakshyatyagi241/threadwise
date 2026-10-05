/** Looks up the CNAME targets of a host (TW-STORE-007). Behind a port so tests control the answer. */
export interface DnsResolverPort {
  /** Targets as the resolver returned them; an error or no record is an empty list. */
  resolveCname(host: string): Promise<string[]>;
}

export const DNS_RESOLVER_PORT = Symbol('STORE_DNS_RESOLVER_PORT');
