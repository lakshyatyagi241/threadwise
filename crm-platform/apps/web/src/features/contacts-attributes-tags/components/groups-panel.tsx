'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Input, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { formatDateTime } from '@/lib/format-datetime';
import { KEYS, invalidateContacts } from '../api/contacts';
import { deleteGroup, GROUP_DOT_FALLBACK, useGroups } from '../api/groups';
import type { ContactGroup } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { ErrorLine } from './error-line';
import { PencilIcon, TrashIcon, UploadIcon } from './icons';

const th =
  'sticky top-0 z-10 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const td = 'border-b border-border px-3 py-2 align-middle';

/**
 * The Groups list (TW-CON-033) as a table: name, member count, who created each group and when, who last changed it and when,
 * and the row actions. The search narrows the list by name on the server, once typing pauses for 300 ms.
 */
export function GroupsPanel({
  onEdit,
  onImport,
}: {
  onEdit: (g: ContactGroup) => void;
  /** Opens the import with this group preselected; absent when the caller may not import. */
  onImport?: (g: ContactGroup) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.groups');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('record.contacts.update');

  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setQ(typed.trim()), 300);
    return () => window.clearTimeout(id);
  }, [typed]);

  const groups = useGroups(q);
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

  const list = groups.data ?? [];
  let body: ReactNode;
  if (groups.isError) {
    const unavailable = errorKind(groups.error) === 'unavailable';
    body = unavailable ? (
      <EmptyState title={t('unavailableTitle')} message={t('unavailableMessage')} />
    ) : (
      <ErrorLine error={groups.error} onRetry={() => void groups.refetch()} />
    );
  } else if (groups.isPending) {
    body = (
      <div className="flex items-center gap-2 py-10 text-muted-foreground" role="status">
        <Spinner /> {t('loading')}
      </div>
    );
  } else if (list.length === 0) {
    body = q ? (
      <EmptyState
        title={t('noResultsTitle')}
        message={t('noResults')}
        actions={
          <Button variant="secondary" onClick={() => setTyped('')}>
            {t('clearSearch')}
          </Button>
        }
      />
    ) : (
      <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
    );
  } else {
    body = (
      <section
        aria-label={t('tableLabel')}
        aria-busy={groups.isFetching}
        className="overflow-x-auto rounded-md border border-border bg-background"
      >
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={th}>
                {t('colName')}
              </th>
              <th scope="col" className={cn(th, 'text-end')}>
                {t('colMembers')}
              </th>
              <th scope="col" className={th}>
                {t('colCreatedBy')}
              </th>
              <th scope="col" className={th}>
                {t('colCreatedAt')}
              </th>
              <th scope="col" className={th}>
                {t('colModifiedBy')}
              </th>
              <th scope="col" className={th}>
                {t('colUpdatedAt')}
              </th>
              <th scope="col" className={cn(th, 'text-end')}>
                {t('colActions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => (
              <tr key={g.id} className="hover:bg-muted/60">
                <td className={td}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: g.color || GROUP_DOT_FALLBACK }}
                    />
                    <div className="min-w-0 max-w-[18rem]">
                      <Link
                        href={`/contacts?group=${g.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {g.name}
                      </Link>
                      {g.note && (
                        <div className="line-clamp-1 text-xs text-muted-foreground">{g.note}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn(td, 'text-end font-medium tabular-nums')}>
                  {g.memberCount.toLocaleString(locale)}
                </td>
                <td className={cn(td, 'max-w-[10rem] truncate')}>{g.createdBy?.name ?? '-'}</td>
                <td className={cn(td, 'whitespace-nowrap tabular-nums text-muted-foreground')}>
                  {formatDateTime(g.createdAt, locale, timeZone)}
                </td>
                <td className={cn(td, 'max-w-[10rem] truncate')}>{g.updatedBy?.name ?? '-'}</td>
                <td className={cn(td, 'whitespace-nowrap tabular-nums text-muted-foreground')}>
                  {formatDateTime(g.updatedAt, locale, timeZone)}
                </td>
                <td className={cn(td, 'whitespace-nowrap')}>
                  <div className="flex items-center justify-end gap-2">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          className="h-9 max-w-xs [&::-webkit-search-cancel-button]:hidden"
        />
        <span className="ms-auto text-sm text-muted-foreground" aria-live="polite">
          {groups.isSuccess ? t('count', { count: list.length }) : ''}
        </span>
      </div>

      {body}

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
    </div>
  );
}
