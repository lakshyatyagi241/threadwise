'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Menu, MenuLabel, MenuRadioItem, Spinner, useToast } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { invalidateContacts, KEYS, updateContact } from '../api/contacts';
import { useOwnerNames } from '../api/owners';
import { errorKind } from '../lib/errors';
import { ContactAvatar } from './chips';
import { ChevronDownIcon } from './icons';

/**
 * The contact's owner on the profile: avatar and name (or "Unassigned"), and, for someone who may edit contacts, a menu to hand the
 * contact to another person or to nobody. Only the people the caller's record scope allows are offered (the API enforces it again);
 * the save carries the row version, so a change made elsewhere in the meantime is reported instead of overwritten.
 */
export function OwnerControl({
  contactId,
  ownerId,
  rowVersion,
  canEdit,
}: {
  contactId: string;
  ownerId: string | null;
  rowVersion: number;
  canEdit: boolean;
}) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const { owners, nameOf, loading } = useOwnerNames();

  const change = useMutation({
    mutationFn: (next: string | null) => updateContact(contactId, { ownerId: next, rowVersion }),
    onSuccess: async (saved) => {
      await Promise.all([
        invalidateContacts(qc),
        qc.invalidateQueries({ queryKey: KEYS.contact(contactId) }),
      ]);
      toast(
        saved.ownerId
          ? t('ownerChanged', { name: nameOf(saved.ownerId) ?? '' })
          : t('ownerCleared'),
        'success',
      );
    },
    onError: async (e) => {
      const kind = errorKind(e);
      toast(
        t(
          kind === 'conflict'
            ? 'ownerConflict'
            : kind === 'forbidden'
              ? 'ownerForbidden'
              : 'ownerFailed',
        ),
        'danger',
      );
      if (kind === 'conflict') await qc.invalidateQueries({ queryKey: KEYS.contact(contactId) });
    },
  });

  const name = ownerId ? (nameOf(ownerId) ?? (loading ? '' : t('ownerFormer'))) : '';
  const display = ownerId ? (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ContactAvatar id={ownerId} name={name} />
      <span className="truncate">{name}</span>
    </span>
  ) : (
    <span className="text-muted-foreground">{t('ownerNone')}</span>
  );
  if (!canEdit) return display;

  // The current owner stays listed even when the scope would not let the caller pick them, so the menu always shows where it stands.
  const choices = owners.filter((o) => o.canAssign || o.id === ownerId);
  return (
    <Menu
      label={t('ownerChange')}
      disabled={change.isPending}
      triggerClassName="h-auto max-w-full gap-1.5 px-1.5 py-1"
      trigger={
        <>
          {change.isPending ? <Spinner /> : display}
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      }
    >
      <MenuLabel>{t('ownerChange')}</MenuLabel>
      <MenuRadioItem
        checked={ownerId === null}
        onSelect={() => {
          if (ownerId !== null) change.mutate(null);
        }}
      >
        {t('ownerNone')}
      </MenuRadioItem>
      {choices.map((o) => (
        <MenuRadioItem
          key={o.id}
          checked={o.id === ownerId}
          onSelect={() => {
            if (o.id !== ownerId) change.mutate(o.id);
          }}
        >
          {o.id === session.user.id ? t('ownerMe', { name: o.fullName }) : o.fullName}
        </MenuRadioItem>
      ))}
    </Menu>
  );
}
