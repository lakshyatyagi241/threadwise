import { useTranslations } from 'next-intl';
import type { ModuleKey } from '@crm/contracts';

/**
 * The properties screen and its forms serve two modules (Contact properties, Company properties). Nearly every word is shared; the
 * few that name the module's records (the title, "N contacts have a value", "the contact form will not save without it") come from the
 * module's own namespace, under the same keys, so a call site reads `copy('modal.requiredHint')` for either.
 */
export function useModuleCopy(moduleKey: ModuleKey) {
  const contacts = useTranslations('contacts-attributes-tags.properties');
  const companies = useTranslations('companies.properties');
  return moduleKey === 'companies' ? companies : contacts;
}

/** The permission segment of a module's property keys: `record.<segment>.read|create|update|delete`. */
export const propertyPermissionSegment = (moduleKey: ModuleKey): string =>
  moduleKey === 'companies' ? 'company-properties' : 'contact-properties';
