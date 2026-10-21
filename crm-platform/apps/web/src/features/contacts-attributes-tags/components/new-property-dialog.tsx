'use client';

import { useMemo } from 'react';
import { useFieldDependencies, useFieldSections, useModuleFields } from '../api/properties';
import { PropertyModal } from './property-modal';

/**
 * The Contact Properties "new property" form, opened from another screen (the flow builder's pickers) so a property is made with the
 * same name, type, section and options as on Contacts > Properties. Reads what the form needs itself, and hands back the new key.
 */
export function NewPropertyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const fields = useModuleFields('contacts', true, open);
  const sections = useFieldSections('contacts', open);
  const deps = useFieldDependencies('contacts', open);
  const allFields = useMemo(() => (fields.data ?? []).filter((f) => !f.isSystem), [fields.data]);
  const allSections = useMemo(
    () => [...(sections.data ?? [])].sort((a, b) => a.position - b.position),
    [sections.data],
  );
  // Until the sections are here the form has no section to start in.
  const ready = open && sections.data !== undefined && fields.data !== undefined;
  return (
    <PropertyModal
      open={ready}
      sections={allSections}
      fields={allFields}
      dependencies={deps.data ?? []}
      onSaved={(f) => onCreated(f.key)}
      onClose={onClose}
    />
  );
}
