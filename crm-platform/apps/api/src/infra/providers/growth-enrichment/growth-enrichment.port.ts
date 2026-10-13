/**
 * Growth enrichment's one outbound call: ask a data provider what it knows about the company behind a business email address. The
 * service is written against this interface; a provider is one adapter. Only coarse facts come back and are kept (company size band,
 * industry, seniority, country): never a name, an email or a phone number.
 */
export interface EnrichmentFacts {
  companySize?: string;
  industry?: string;
  seniority?: string;
  country?: string;
}

export type EnrichmentLookup =
  { status: 'found'; data: EnrichmentFacts } | { status: 'not_found'; data: EnrichmentFacts };

export class EnrichmentError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate_limited' | 'provider' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

export interface GrowthEnrichmentPort {
  /** The provider's short name, kept next to what it returned. */
  readonly provider: string;
  /** False when no key is configured: the service does nothing then, and says so in the settings. */
  configured(): boolean;
  /** Throws EnrichmentError. */
  lookup(email: string): Promise<EnrichmentLookup>;
}

export const GROWTH_ENRICHMENT_PORT = Symbol('GROWTH_ENRICHMENT_PORT');

/** A headcount as the band the scorer sees. */
export function sizeBand(employees: number | null | undefined): string | undefined {
  if (
    employees === null ||
    employees === undefined ||
    !Number.isFinite(employees) ||
    employees <= 0
  )
    return undefined;
  if (employees <= 10) return '1-10';
  if (employees <= 50) return '11-50';
  if (employees <= 200) return '51-200';
  if (employees <= 1000) return '201-1000';
  return '1000+';
}
