'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { TemplateSummary, TplMetaCategory, TplStatus } from '@crm/contracts';
import { Button, EmptyState, Field, Input, Select, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useConnections, useDebounced, useSyncTemplates, useTemplateList } from '../api/hooks';
import { CATEGORIES, STATUSES } from '../lib/status-model';
import { connectionLabel, summarizeSync, syncTargets } from '../lib/sync';
import { DeleteTemplateDialog } from './delete-dialog';
import { ErrorAlert } from './error-line';
import { PlusIcon, RefreshIcon, SearchIcon } from './icons';
import { TemplateCard } from './template-card';
import { useErrorText } from './use-error-text';

/** TW-TPL-001: the template library. Server-side filters, cursor "load more", no page numbers and no totals. */
export function TemplatesScreen() {
  const t = useTranslations('message-templates.library');
  const ts = useTranslations('message-templates.status');
  const tc = useTranslations('message-templates.category');
  const { toast } = useToast();
  const errorText = useErrorText();
  const mayCreate = useCan('tpl.templates.create');
  const mayDelete = useCan('tpl.templates.delete');
  const maySync = useCan('tpl.templates.sync');

  const [status, setStatus] = useState<TplStatus | ''>('');
  const [category, setCategory] = useState<TplMetaCategory | ''>('');
  const [connectionId, setConnectionId] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);

  const connections = useConnections();
  const list = useTemplateList({
    status: status || undefined,
    category: category || undefined,
    connectionId: connectionId || undefined,
    q,
  });
  const sync = useSyncTemplates();
  const [syncing, setSyncing] = useState(false);
  const [toDelete, setToDelete] = useState<TemplateSummary | null>(null);

  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of connections.data ?? []) m.set(c.id, connectionLabel(c));
    return m;
  }, [connections.data]);

  const filtered = Boolean(status || category || connectionId || q);
  const targets = syncTargets(connections.data ?? [], connectionId || undefined);
  const empty = !list.isPending && !list.isError && list.items.length === 0;

  async function runSync() {
    setSyncing(true);
    const results = [];
    for (const id of targets) {
      try {
        results.push(await sync.mutateAsync({ connectionId: id }));
      } catch {
        results.push(null);
      }
    }
    setSyncing(false);
    const s = summarizeSync(results);
    if (s.succeeded === 0) {
      toast(t('syncFailed'), 'danger');
      return;
    }
    toast(
      s.total === 0 && s.created === 0
        ? t('syncNone')
        : t('syncDone', { created: s.created, updated: s.updated, missing: s.missing }),
      s.failed > 0 ? 'info' : 'success',
    );
    if (s.failed > 0) toast(t('syncPartial', { count: s.failed }), 'danger');
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-7 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {maySync && targets.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => void runSync()}
              disabled={syncing}
              title={t('syncHint')}
            >
              {syncing ? <Spinner /> : <RefreshIcon className="size-4" />}
              {syncing ? t('syncing') : t('sync')}
            </Button>
          )}
          {mayCreate && (
            <Link
              href="/templates/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
            >
              <PlusIcon className="size-4" />
              {t('new')}
            </Link>
          )}
        </div>
      </header>

      <form
        role="search"
        aria-label={t('filters')}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label={t('search')} htmlFor="tpl-search">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="tpl-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="ps-9"
            />
          </div>
        </Field>
        <Field label={t('status')} htmlFor="tpl-status">
          <Select
            id="tpl-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as TplStatus | '')}
          >
            <option value="">{t('allStatuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('category')} htmlFor="tpl-category">
          <Select
            id="tpl-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as TplMetaCategory | '')}
          >
            <option value="">{t('allCategories')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tc(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('connection')} htmlFor="tpl-connection">
          <Select
            id="tpl-connection"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            <option value="">{t('allConnections')}</option>
            {(connections.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {connectionLabel(c)}
              </option>
            ))}
          </Select>
        </Field>
      </form>

      <section aria-live="polite" aria-busy={list.isFetching} className={cn(list.isFetching && !list.isPending && 'opacity-70 transition-opacity')}>
        {list.isPending ? (
          <div className="flex justify-center p-12">
            <Spinner label={t('loading')} />
          </div>
        ) : list.isError ? (
          <div className="space-y-3">
            <ErrorAlert error={errorText(list.error)} />
            <Button variant="secondary" onClick={() => void list.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : empty ? (
          <EmptyState
            title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
            message={filtered ? t('emptyFilteredBody') : t('emptyBody')}
            actions={
              filtered ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStatus('');
                    setCategory('');
                    setConnectionId('');
                    setSearch('');
                  }}
                >
                  {t('clearFilters')}
                </Button>
              ) : (
                mayCreate && (
                  <Link
                    href="/templates/new"
                    className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground"
                  >
                    {t('new')}
                  </Link>
                )
              )
            }
          />
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.items.map((tpl) => (
                <li key={tpl.id} className="flex">
                  <TemplateCard
                    template={tpl}
                    connectionLabel={tpl.connectionId ? (labels.get(tpl.connectionId) ?? null) : null}
                    mayEdit={mayCreate}
                    mayDelete={mayDelete}
                    onDelete={setToDelete}
                  />
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <div className="mt-5 flex justify-center">
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
          </>
        )}
      </section>

      <DeleteTemplateDialog template={toDelete} onClose={() => setToDelete(null)} />
    </main>
  );
}
