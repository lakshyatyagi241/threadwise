import { createHash } from 'node:crypto';
import {
  appointmentsHolder,
  crmRecords,
  formsSubmissions,
  growthEnrichment,
  leadsRecords,
} from '../manifests/records';
import {
  broadcastsRecipients,
  campaignsRecipients,
  commerceNudges,
  flowsRuntime,
} from '../manifests/engagement';
import { callsLogs, callsPermissions } from '../manifests/calls';
import {
  consentLedger,
  contactsCard,
  contactsGroupsTags,
  contactsNotesFiles,
} from '../manifests/contacts';
import { inboxMessages } from '../manifests/inbox';
import { salesInvoices } from '../manifests/sales';
import { privacyRequestsHolder } from '../manifests/privacy';
import { orderOf } from './define';
import type { PersonalDataHolder, TableSpec } from './types';

/**
 * Every place a person's data lives, in the order the wiring map lists them. A new module that keeps data about a person adds its
 * manifest here (or a table to one of these); `test/integration/privacy/registry.spec.ts` fails until it does.
 */
export const PERSONAL_DATA_REGISTRY: readonly PersonalDataHolder[] = [
  contactsCard,
  contactsNotesFiles,
  contactsGroupsTags,
  consentLedger,
  inboxMessages,
  broadcastsRecipients,
  campaignsRecipients,
  flowsRuntime,
  leadsRecords,
  crmRecords,
  formsSubmissions,
  appointmentsHolder,
  growthEnrichment,
  salesInvoices,
  callsLogs,
  callsPermissions,
  commerceNudges,
  privacyRequestsHolder,
];

/** Every (holder, table) pair, in the global execution order of an erasure. */
export function registeredSpecs(
  registry: readonly PersonalDataHolder[] = PERSONAL_DATA_REGISTRY,
): { holder: PersonalDataHolder; spec: TableSpec }[] {
  const out: { holder: PersonalDataHolder; spec: TableSpec }[] = [];
  for (const holder of registry) for (const spec of holder.tables) out.push({ holder, spec });
  return out.sort((a, b) => orderOf(a.spec) - orderOf(b.spec));
}

/** The tables the registry names (a table may appear under two holders only by mistake; the test rejects that). */
export function registeredTables(
  registry: readonly PersonalDataHolder[] = PERSONAL_DATA_REGISTRY,
): Set<string> {
  return new Set(registeredSpecs(registry).map((p) => p.spec.table));
}

/**
 * A short digest of what the registry declares (keys, tables, dispositions). A proof of erasure carries it, so a later reader can tell
 * which version of the declarations an erasure ran with; it never includes a value.
 */
export function registryDigest(
  registry: readonly PersonalDataHolder[] = PERSONAL_DATA_REGISTRY,
): string {
  const body = registeredSpecs(registry)
    .map((p) => `${p.holder.key}:${p.spec.table}:${p.spec.disposition}:${p.spec.tier}`)
    .sort()
    .join('|');
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}
