'use client';

import { useState } from 'react';
import type { FieldType } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { NewPropertyDialog, usePickerFeed } from '@/features/contacts-attributes-tags';

/**
 * "+ New property" under a contact-property picker: opens the Contact Properties "new property" form right here (so nobody has to leave
 * the builder, and the property gets a real type, section and options), refreshes the picker's list and hands the new key back.
 * Shared by the Simple and the Advanced builder.
 */
export function NewPropertyInline({
  onCreated,
  types,
}: {
  onCreated: (key: string) => void;
  /** The property types that can hold what the step collects; the form offers only these. */
  types?: readonly FieldType[];
}) {
  const tNew = useTranslations('contacts-attributes-tags.properties');
  const feed = usePickerFeed();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-[12.5px] font-semibold text-brand hover:underline"
      >
        + {tNew('newProperty')}
      </button>
      <NewPropertyDialog
        open={open}
        onClose={() => setOpen(false)}
        types={types}
        onCreated={(key) => {
          void feed.refetch().then(() => onCreated(key));
        }}
      />
    </>
  );
}
