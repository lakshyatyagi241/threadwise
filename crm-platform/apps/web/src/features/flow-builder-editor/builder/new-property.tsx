'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, useToast } from '@crm/ui';
import {
  createAttribute,
  suggestAttributeKey,
  usePickerFeed,
} from '@/features/contacts-attributes-tags';

/**
 * "+ New property" under a contact-property picker: makes the property right here (so nobody has to leave the builder for the
 * Contacts settings), refreshes the picker's list and hands the new key back. Shared by the Simple and the Advanced builder.
 */
export function NewPropertyInline({ onCreated }: { onCreated: (key: string) => void }) {
  const tNew = useTranslations('contacts-attributes-tags.properties');
  const tCreate = useTranslations('contacts-attributes-tags.properties.modal');
  const { toast } = useToast();
  const feed = usePickerFeed();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const label = name.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      const made = await createAttribute({
        name: label,
        key: suggestAttributeKey(label),
        defaultValue: '',
        description: '',
        active: true,
      });
      await feed.refetch();
      onCreated(made.key);
      setName('');
      setAdding(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return adding ? (
    <div className="mt-2 flex items-center gap-2">
      <Input
        autoFocus
        aria-label={tNew('newProperty')}
        placeholder={tNew('newProperty')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void create();
          }
        }}
      />
      <Button size="sm" disabled={busy || !name.trim()} onClick={() => void create()}>
        {tCreate('create')}
      </Button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className="mt-2 text-[12.5px] font-semibold text-brand hover:underline"
    >
      + {tNew('newProperty')}
    </button>
  );
}
