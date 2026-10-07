'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, EmptyState, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, invalidateContacts } from '../api/contacts';
import { deleteGroup, GROUP_DOT_FALLBACK, useGroups } from '../api/groups';
import type { ContactGroup } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { ErrorLine } from './error-line';
import { PencilIcon, PlusIcon, TrashIcon, UsersIcon, UploadIcon } from './icons';

/** The Groups view (TW-CON-033): one card per group with its member count, an edit and delete button, and a "create" tile. */
export function GroupsPanel({
  onCreate,
  onEdit,
  onImport,
}: {
  onCreate: () => void;
  onEdit: (g: ContactGroup) => void;
  /** Opens the import with this group preselected; absent when the caller may not import. */
  onImport?: (g: ContactGroup) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.groups');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('record.contacts.update');
  const groups = useGroups();
  const [deleting, setDeleting] = useState<ContactGroup | null>(null);

  const remove = useMutation({
    mutationFn: (g: ContactGroup) => deleteGroup(g.id),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: KEYS.groups }), invalidateContacts(qc)]);
      toast(t('deleted'), 'success');
      setDeleting(null);
    },
    onError: () => toast(t('deleteFailed'), 'danger'),
  });

  if (groups.isPending) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground" role="status">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (groups.isError) {
    const unavailable = errorKind(groups.error) === 'unavailable';
    return unavailable ? (
      <EmptyState title={t('unavailableTitle')} message={t('unavailableMessage')} />
    ) : (
      <ErrorLine error={groups.error} onRetry={() => void groups.refetch()} />
    );
  }

  const list = groups.data;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((g) => (
          <article key={g.id} className="rounded-md border border-border bg-background p-5">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-white"
                style={{ background: g.color || GROUP_DOT_FALLBACK }}
              >
                <UsersIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold leading-tight">{g.name}</h3>
                {g.note && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{g.note}</p>
                )}
              </div>
              <div className="text-end">
                <div className="text-2xl font-semibold leading-none tabular-nums">
                  {g.memberCount.toLocaleString()}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('contacts')}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Link
                href={`/contacts?group=${g.id}`}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              >
                {t('viewContacts')}
              </Link>
              {onImport && (
                <button
                  type="button"
                  onClick={() => onImport(g)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
                >
                  <UploadIcon className="size-3.5" />
                  {t('importInto')}
                </button>
              )}
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => onEdit(g)}
                    title={t('edit')}
                    aria-label={t('editNamed', { name: g.name })}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(g)}
                    title={t('delete')}
                    aria-label={t('deleteNamed', { name: g.name })}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-border text-danger hover:bg-danger/10"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
        {canManage && (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md border border-dashed border-primary bg-background p-5 text-start transition hover:bg-primary/5"
          >
            <span className="flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
              <PlusIcon className="size-5" />
            </span>
            <div className="mt-3 text-lg font-semibold">{t('createTile')}</div>
            <p className="text-xs text-muted-foreground">{t('createTileHint')}</p>
          </button>
        )}
      </div>
      {list.length === 0 && !canManage && (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}
