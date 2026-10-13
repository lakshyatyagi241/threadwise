import { Injectable } from '@nestjs/common';
import {
  EnrichmentError,
  sizeBand,
  type EnrichmentLookup,
  type GrowthEnrichmentPort,
} from './growth-enrichment.port';

/** No provider configured: the pilot's enrichment switch has no effect and the settings say so. */
@Injectable()
export class NoEnrichmentAdapter implements GrowthEnrichmentPort {
  readonly provider = 'none';
  configured(): boolean {
    return false;
  }
  async lookup(): Promise<EnrichmentLookup> {
    throw new EnrichmentError('auth', 'No enrichment provider is configured.');
  }
}

/**
 * An offline stand-in for the provider, for the automated tests and the browser run (GROWTH_ENRICHMENT_DRIVER=fixture). The answer is a
 * function of the email's domain, so the same company always gets the same facts; a domain starting with "unknown" is not found.
 * It must never answer in production (the module refuses to boot with it there).
 */
@Injectable()
export class FixtureEnrichmentAdapter implements GrowthEnrichmentPort {
  readonly provider = 'fixture';
  /** Every email asked about, newest last (a test asserts what was sent). */
  readonly asked: string[] = [];
  configured(): boolean {
    return true;
  }
  async lookup(email: string): Promise<EnrichmentLookup> {
    this.asked.push(email);
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    if (domain.startsWith('unknown')) return { status: 'not_found', data: {} };
    let h = 0;
    for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) % 997;
    const sizes = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
    const industries = ['Software', 'Retail', 'Healthcare', 'Education', 'Manufacturing'];
    const seniority = ['manager', 'director', 'vp', 'c_suite', 'senior'];
    return {
      status: 'found',
      data: {
        companySize: sizes[h % sizes.length],
        industry: industries[h % industries.length],
        seniority: seniority[h % seniority.length],
        country: 'IN',
      },
    };
  }
}

/**
 * Apollo people match (https://docs.apollo.io): one email in, the company and the seniority out. NOT verified against the real service
 * by the build session (no account was available): the request and the response fields follow its public documentation, and the first
 * run with a real key should be watched. Used only when GROWTH_ENRICHMENT_DRIVER=apollo and GROWTH_ENRICHMENT_API_KEY are set.
 */
@Injectable()
export class ApolloEnrichmentAdapter implements GrowthEnrichmentPort {
  readonly provider = 'apollo';
  constructor(private readonly apiKey: string) {}
  configured(): boolean {
    return this.apiKey.trim() !== '';
  }
  async lookup(email: string): Promise<EnrichmentLookup> {
    let res: Response;
    try {
      res = await fetch('https://api.apollo.io/api/v1/people/match', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-cache',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ email, reveal_personal_emails: false }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new EnrichmentError(
        err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'provider',
        'The enrichment provider could not be reached.',
      );
    }
    if (res.status === 401 || res.status === 403)
      throw new EnrichmentError('auth', 'The provider refused the key.');
    if (res.status === 429)
      throw new EnrichmentError('rate_limited', 'The provider is rate limiting.');
    if (!res.ok) throw new EnrichmentError('provider', `The provider answered ${res.status}.`);
    const body = (await res.json().catch(() => null)) as {
      person?: {
        seniority?: string;
        country?: string;
        organization?: { estimated_num_employees?: number; industry?: string };
      } | null;
    } | null;
    const p = body?.person;
    if (!p) return { status: 'not_found', data: {} };
    const data = {
      ...(sizeBand(p.organization?.estimated_num_employees)
        ? { companySize: sizeBand(p.organization?.estimated_num_employees) }
        : {}),
      ...(p.organization?.industry ? { industry: p.organization.industry.slice(0, 60) } : {}),
      ...(p.seniority ? { seniority: p.seniority.slice(0, 30) } : {}),
      ...(p.country ? { country: p.country.slice(0, 40) } : {}),
    };
    return Object.keys(data).length > 0
      ? { status: 'found', data }
      : { status: 'not_found', data: {} };
  }
}
