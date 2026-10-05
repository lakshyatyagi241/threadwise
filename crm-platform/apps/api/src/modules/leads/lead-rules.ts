import { leadSourceDefaultsSchema, type LeadSourceDefaults } from '@crm/contracts';
import type { LeadSourceRow } from './lead-sources.repository';

const DEFAULT_PLATFORM = 'Webhook';

/** What the pipeline reads out of a source's stored `defaults`: a row written before a key existed gets its default. */
export function defaultsOf(source: Pick<LeadSourceRow, 'defaults'>): LeadSourceDefaults {
  const parsed = leadSourceDefaultsSchema.safeParse(source.defaults ?? {});
  return parsed.success ? parsed.data : leadSourceDefaultsSchema.parse({});
}

/** The platform label of a lead: its own, else the source's, else "Webhook". It is `contacts.source` and the attribution's platform. */
export function platformLabel(
  source: Pick<LeadSourceRow, 'providerKey' | 'name'>,
  defaults: LeadSourceDefaults,
  fromLead: string | null,
): string {
  return fromLead ?? defaults.platform ?? source.providerKey ?? DEFAULT_PLATFORM;
}
