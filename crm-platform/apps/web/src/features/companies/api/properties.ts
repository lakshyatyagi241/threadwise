'use client';

// The registry hooks are imported from their own file, not from the contacts domain's index (see `lib/properties.ts`).
import {
  useFieldDependencies,
  useFieldOptionDependencies,
  useFieldSections,
  useModuleFields,
} from '@/features/contacts-attributes-tags/api/properties';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

/**
 * The workspace's company properties (the field registry, module `companies`) with their sections and "show only when" rules, for
 * the company form and the company page. Read only by someone who may see the definitions (`record.company-properties.read`;
 * the Agent and Manager presets do): without it nothing is asked and the screens draw no properties, as for any other failed read.
 */
export function useCompanyProperties() {
  const can = useCan('record.company-properties.read');
  const fields = useModuleFields('companies', false, can);
  const sections = useFieldSections('companies', can);
  const dependencies = useFieldDependencies('companies', can);
  const optionDependencies = useFieldOptionDependencies('companies', can);
  return {
    fields: fields.data ?? [],
    sections: sections.data ?? [],
    dependencies: dependencies.data ?? [],
    optionDependencies: optionDependencies.data ?? [],
    /** The definitions are still on their way (the form waits so it never saves without a required property it could not see). */
    loading:
      can &&
      (fields.isPending ||
        sections.isPending ||
        dependencies.isPending ||
        optionDependencies.isPending),
  };
}
