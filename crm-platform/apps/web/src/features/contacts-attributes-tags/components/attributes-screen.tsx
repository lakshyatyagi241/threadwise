'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Spinner,
  StatTile,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { deleteAttribute, useAttributeList } from '../api/attributes';
import { KEYS } from '../api/contacts';
import type { Attribute, StatusFilter } from '../lib/attribute-model';
import { errorKind } from '../lib/errors';
import { useDebounced } from '../lib/use-debounced';
import { AttributeModal } from './attribute-modal';
import { ErrorLine } from './error-line';
import { ArrowRightIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from './icons';
import { SlashTextarea } from './slash-picker';

const STATUS_KEYS: StatusFilter[] = ['all', 'active', 'inactive'];

/** `/attributes` (WD-CON-042..046): the workspace's merge variables, with status filter, search and "load more". */
export function AttributesScreen() {
  const t = useTranslations('contacts-attributes-tags.attributes');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreate = useCan('record.contact-properties.create');
  const canUpdate = useCan('record.contact-properties.update');
  const canDelete = useCan('record.contact-properties.delete');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  // Search runs on the server, 220 ms after typing stops (as in WaDesk).
  const applied = useDebounced(query, 220);
  const list = useAttributeList(status, applied);
  const [editing, setEditing] = useState<Attribute | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Attribute | null>(null);
  /** Set when the API refused the delete because contacts hold a value: how many, awaiting a second confirmation. */
  const [inUse, setInUse] = useState<number | null>(null);
  const [trial, setTrial] = useState('');

  const items = list.items;
  const counts = list.counts;

  const remove = useMutation({
    mutationFn: ({ a, force }: { a: Attribute; force: boolean }) => deleteAttribute(a.id, force),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.attributes }),
        qc.invalidateQueries({ queryKey: KEYS.attributePicker }),
      ]);
      toast(t('deleted'), 'success');
      setDeleting(null);
      setInUse(null);
    },
    onError: (e) => {
      if (errorKind(e) === 'attributeInUse' && e instanceof ApiError) {
        const holders = Number(e.fieldErrors.find((f) => f.path === 'contacts')?.message ?? 0);
        setInUse(Number.isFinite(holders) ? holders : 0);
        return;
      }
      toast(t(errorKind(e) === 'systemField' ? 'deleteSystem' : 'deleteFailed'), 'danger');
      setDeleting(null);
    },
  });

  const filterActive = status !== 'all' || applied.trim() !== '';
  const num = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString());

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="space-y-3 self-start lg:sticky lg:top-6">
        <div className="rounded-md border border-border bg-background p-2">
          <div className="px-3 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('statusTitle')}
          </div>
          {STATUS_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={status === k}
              onClick={() => setStatus(k)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm',
                status === k ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              <span className="flex items-center gap-2">
                {k === 'active' && (
                  <span aria-hidden="true" className="size-2 rounded-full bg-success" />
                )}
                {k === 'inactive' && (
                  <span aria-hidden="true" className="size-2 rounded-full bg-border" />
                )}
                {t(`status.${k}`)}
              </span>
              <span
                className={cn(
                  'text-xs tabular-nums',
                  status === k ? 'opacity-90' : 'text-muted-foreground',
                )}
              >
                {num(counts?.[k])}
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-xs leading-relaxed">
          <div className="mb-1 font-semibold">{t('how.title')}</div>
          {t('how.body')}
        </div>

        <div className="rounded-md border border-border bg-background p-4">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('quick.title')}
          </div>
          <ul className="space-y-1.5 text-xs">
            {(['slash', 'enter', 'esc', 'token'] as const).map((k) => (
              <li key={k} className="flex items-start gap-2">
                <kbd dir="ltr" className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono">
                  {k === 'token' ? '{{key}}' : t(`quick.${k}.key`)}
                </kbd>
                <span>{t(`quick.${k}.text`)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1">
            <div className="text-xs font-medium">{t('quick.try')}</div>
            <SlashTextarea
              value={trial}
              onChange={setTrial}
              label={t('quick.tryLabel')}
              placeholder={t('quick.tryPlaceholder')}
              rows={2}
            />
          </div>
        </div>

        <div className="rounded-md border border-border bg-background p-4">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('where.title')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['templates', 'broadcasts', 'campaigns', 'flows'] as const).map((k) => (
              <Badge key={k}>{t(`where.${k}`)}</Badge>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-w-0 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('eyebrow')}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          {canCreate && (
            <Button className="shrink-0" onClick={() => setEditing('new')}>
              <PlusIcon /> {t('new')}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <div className="min-w-0 max-w-2xl">
            <div className="font-semibold">{t('related.title')}</div>
            <p className="text-muted-foreground">{t('related.body')}</p>
          </div>
          <Link
            href="/contact-properties"
            className="inline-flex shrink-0 items-center gap-1.5 font-medium text-primary hover:underline"
          >
            {t('related.link')} <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatTile
            label={t('tiles.total')}
            value={num(counts?.all)}
            hint={t('tiles.attributes')}
          />
          <StatTile
            tone="accent"
            label={t('tiles.active')}
            value={num(counts?.active)}
            hint={t('tiles.activeHint')}
          />
          <StatTile
            label={t('tiles.inactive')}
            value={num(counts?.inactive)}
            hint={t('tiles.inactiveHint')}
          />
        </div>

        <div className="rounded-md border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="text-sm" aria-live="polite">
              {items.length > 0 &&
                t.rich('showing', {
                  shown: items.length,
                  more: list.hasNextPage ? 1 : 0,
                  b: (c) => <b>{c}</b>,
                })}
            </div>
            <div className="relative w-full max-w-xs flex-1">
              <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('search')}
                className="h-9 ps-9"
              />
            </div>
          </div>

          {list.isPending ? (
            <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
              <Spinner /> {t('loading')}
            </div>
          ) : list.isError ? (
            <div className="p-4">
              <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t('emptyTitle')}
                message={filterActive ? t('emptyFiltered') : t('empty')}
                actions={
                  <>
                    {filterActive && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setStatus('all');
                          setQuery('');
                        }}
                      >
                        {t('resetFilters')}
                      </Button>
                    )}
                    {canCreate && <Button onClick={() => setEditing('new')}>{t('create')}</Button>}
                  </>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-border bg-muted text-muted-foreground">
                  <tr>
                    {(['name', 'key', 'default', 'description', 'status'] as const).map((c) => (
                      <th
                        key={c}
                        className="px-3 py-2.5 text-start text-[11px] font-semibold uppercase tracking-wider first:ps-4"
                      >
                        {t(`col.${c}`)}
                      </th>
                    ))}
                    <th className="w-24 px-3 py-2.5 pe-4 text-end text-[11px] font-semibold uppercase tracking-wider">
                      {t('col.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((a) => (
                    <tr key={a.id} className="hover:bg-muted/50">
                      <td className="px-3 py-3 font-medium first:ps-4" dir="auto">
                        {a.name}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs" dir="ltr">
                        <span className="block text-start">{a.key}</span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground" dir="auto">
                        {a.defaultValue || '/'}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground" dir="auto">
                        {a.description || '/'}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={a.active ? 'success' : 'neutral'}>
                          {a.active ? t('status.active') : t('status.off')}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 pe-4 text-end">
                        {canUpdate && (
                          <button
                            type="button"
                            onClick={() => setEditing(a)}
                            title={t('edit')}
                            aria-label={t('editNamed', { name: a.name })}
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <PencilIcon className="size-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeleting(a)}
                            title={t('delete')}
                            aria-label={t('deleteNamed', { name: a.name })}
                            className="inline-flex size-8 items-center justify-center rounded-md text-danger hover:bg-danger/10"
                          >
                            <TrashIcon className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {list.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage && <Spinner />}
              {t('loadMore')}
            </Button>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {(['when', 'rules', 'naming'] as const).map((k) => (
            <div key={k} className="rounded-md border border-border bg-background p-5">
              <h3 className="mb-1 text-base font-semibold">{t(`tips.${k}.title`)}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(`tips.${k}.body`)}</p>
            </div>
          ))}
        </div>

        <div className="rounded-md bg-primary p-5 text-primary-foreground">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider opacity-70">
            {t('tip.kicker')}
          </div>
          <div className="text-lg font-semibold">{t('tip.title')}</div>
          <p className="mt-2 text-sm leading-relaxed opacity-90">{t('tip.body')}</p>
        </div>
      </section>

      <AttributeModal
        open={editing !== null}
        attribute={editing === 'new' || editing === null ? undefined : editing}
        onClose={() => setEditing(null)}
      />
      {/* One dialog, two texts: a second dialog would be closed by the first one's own close event. */}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={inUse === null ? t('deleteTitle') : t('inUseTitle')}
        message={
          inUse === null
            ? t('deleteMessage', { name: deleting?.name ?? '' })
            : t('inUseMessage', { name: deleting?.name ?? '', count: inUse })
        }
        confirmLabel={inUse === null ? t('delete') : t('deleteAnyway')}
        cancelLabel={t('cancel')}
        onClose={() => {
          setDeleting(null);
          setInUse(null);
        }}
        onConfirm={() => deleting && remove.mutate({ a: deleting, force: inUse !== null })}
      />
    </div>
  );
}
