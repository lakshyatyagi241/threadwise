'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CompanyLink, CompanyPicker, useCanPickCompany } from '@/features/companies';
import { KEYS, updateContact } from '../../api/contacts';
import type { ContactRow } from '../../api/schemas';
import { errorKind } from '../../lib/errors';
import { EmptyLine, Panel, useRefreshContact } from './shared';

/**
 * The contact's company, in the page itself (no dialog): a search box over the workspace's companies, where someone who may create
 * companies can also make the typed one, and once one is chosen a chip with the company's name (a link) and a clear button. The
 * change shows at once and is saved with the row version the contact was read with; if the server refuses it goes back and says why.
 * Without the permission to change contacts or read companies it only shows the company.
 *
 * `focusSignal` changes each time something outside (the action bar's "Add company") wants the cursor here.
 */
export function CompanyInline({
  contact,
  focusSignal,
}: {
  contact: ContactRow;
  focusSignal?: number;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.company');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canUpdate = useCan('record.contacts.update');
  const canPick = useCanPickCompany();
  const refresh = useRefreshContact(contact.id);
  const root = useRef<HTMLDivElement>(null);
  // The name of the company just chosen, so its chip does not flash "Loading" while the contact is saved.
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (focusSignal === undefined || focusSignal === 0) return;
    const frame = window.requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>('input, button');
      el?.focus();
      root.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSignal]);

  const save = useMutation({
    mutationFn: (companyId: string | null) =>
      updateContact(contact.id, { companyId, rowVersion: contact.rowVersion }),
    onMutate: async (companyId) => {
      await qc.cancelQueries({ queryKey: KEYS.contact(contact.id) });
      const before = qc.getQueryData<ContactRow>(KEYS.contact(contact.id));
      if (before) qc.setQueryData<ContactRow>(KEYS.contact(contact.id), { ...before, companyId });
      return { before };
    },
    onSuccess: async (_saved, companyId) => {
      await refresh();
      toast(t(companyId ? 'saved' : 'removed'), 'success');
    },
    onError: async (e, _companyId, ctx) => {
      if (ctx?.before) qc.setQueryData(KEYS.contact(contact.id), ctx.before);
      setPicked(null);
      const conflict = errorKind(e) === 'conflict';
      toast(t(conflict ? 'conflict' : 'failed'), 'danger');
      if (conflict) await refresh();
    },
  });

  if (!canUpdate || !canPick) {
    return contact.companyId ? (
      <p className="text-sm font-medium">
        <CompanyLink id={contact.companyId} />
      </p>
    ) : (
      <EmptyLine>{t('none')}</EmptyLine>
    );
  }

  return (
    <div ref={root} className="space-y-2">
      <CompanyPicker
        value={
          contact.companyId
            ? {
                id: contact.companyId,
                name: picked?.id === contact.companyId ? picked.name : undefined,
              }
            : null
        }
        linkToCompany
        disabled={save.isPending}
        onChange={(next) => {
          setPicked(next);
          save.mutate(next ? next.id : null);
        }}
      />
      {!contact.companyId && <p className="text-xs text-muted-foreground">{t('hint')}</p>}
    </div>
  );
}

/** The company as a card of its own (the overview's right column, the details page's Company section). */
export function CompanyCard({
  contact,
  focusSignal,
}: {
  contact: ContactRow;
  focusSignal?: number;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.company');
  return (
    <Panel id={`co-${contact.id}`} title={t('title')}>
      <CompanyInline contact={contact} focusSignal={focusSignal} />
    </Panel>
  );
}
