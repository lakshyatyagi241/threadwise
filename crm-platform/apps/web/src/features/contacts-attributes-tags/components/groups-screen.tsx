'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import type { ContactGroup } from '../api/schemas';
import { GroupModal } from './group-modal';
import { ImportModal } from './import-modal';
import { GroupsPanel } from './groups-panel';
import { PlusIcon, UploadIcon } from './icons';

/** `/contact-groups`: the Groups view as its own screen (TW-CON-033). */
export function GroupsScreen() {
  const t = useTranslations('contacts-attributes-tags.groups');
  const session = useSession();
  const canManage = useCan('record.contacts.update');
  const canImport = useCan('record.contacts.import');
  const [importing, setImporting] = useState<ContactGroup | 'any' | null>(null);
  const [editing, setEditing] = useState<ContactGroup | 'new' | null>(null);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow', { workspace: session.org.name })}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="/contacts"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            {t('allContacts')}
          </Link>
          {canImport && (
            <Button variant="secondary" onClick={() => setImporting('any')}>
              <UploadIcon /> {t('import')}
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setEditing('new')}>
              <PlusIcon /> {t('newGroup')}
            </Button>
          )}
        </div>
      </div>

      <GroupsPanel
        onCreate={() => setEditing('new')}
        onEdit={setEditing}
        onImport={canImport ? setImporting : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {(['one', 'two', 'three'] as const).map((k, i) => (
          <div key={k} className="rounded-md border border-border bg-background p-5">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('helpKicker', { n: i + 1 })}
            </div>
            <div className="mb-1 text-base font-semibold">{t(`help.${k}.title`)}</div>
            <p className="text-sm leading-relaxed text-muted-foreground">{t(`help.${k}.body`)}</p>
          </div>
        ))}
      </div>

      <ImportModal
        open={importing !== null}
        groupId={importing === null || importing === 'any' ? undefined : importing.id}
        onClose={() => setImporting(null)}
      />
      <GroupModal
        open={editing !== null}
        group={editing === 'new' || editing === null ? undefined : editing}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}
