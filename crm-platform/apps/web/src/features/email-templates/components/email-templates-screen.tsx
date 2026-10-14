'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EmailTemplate } from '@crm/contracts';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { invalidateTemplates, templatesApi, useTemplatesList } from '../api/templates';
import { errorKind } from '../lib/errors';
import {
  DEFAULT_FILTERS,
  PURPOSES,
  SCOPES,
  STATUSES,
  filtersToSearch,
  hasActiveFilter,
  parseFilters,
  type TemplateFilters,
} from '../lib/filters';
import { useDebounced } from '../lib/use-debounced';
import { ErrorLine } from './error-line';
import { PlusIcon, RefreshIcon, SearchIcon } from './icons';
import { TemplateEditorModal } from './template-editor-modal';
import { TemplateRow } from './template-row';

/**
 * `/email-templates`: the workspace's library of reusable emails. Search and filters live in the address; the list pages by cursor.
 * Everyone who can read templates sees the shared ones and keeps personal ones; creating or changing a SHARED template needs the manage
 * permission (the buttons for it are hidden without it, the server decides).
 */
export function EmailTemplatesScreen() {
  const t = useTranslations('emailTemplates.list');
  const tBar = useTranslations('emailTemplates.toolbar');
  const tDelete = useTranslations('emailTemplates.delete');
  const tToast = useTranslations('emailTemplates.toast');
  const tErr = useTranslations('emailTemplates.errors');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('mail.templates.manage');

  const filters = useMemo(() => parseFilters(search), [search]);
  // The box keeps what is typed; the address (and so the requests) follow after a pause.
  const [q, setQ] = useState(filters.q);
  const debouncedQ = useDebounced(q);
  const apply = useCallback(
    (patch: Partial<TemplateFilters>) =>
      router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false }),
    [router, pathname, filters],
  );
  useEffect(() => {
    if (debouncedQ.trim() !== filters.q.trim()) apply({ q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a pause in typing moves the address
  }, [debouncedQ]);

  const list = useTemplatesList(filters);
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<EmailTemplate | null>(null);

  const archive = useMutation({
    mutationFn: (tpl: EmailTemplate) =>
      templatesApi.update(tpl.id, {
        status: tpl.status === 'archived' ? 'active' : 'archived',
        rowVersion: tpl.rowVersion,
      }),
    onSuccess: async (saved) => {
      await invalidateTemplates(qc);
      toast(tToast(saved.status === 'archived' ? 'archived' : 'restored'), 'success');
    },
    onError: async (e) => {
      // A stale row version means someone else changed it: the list is reloaded and the person told.
      await invalidateTemplates(qc);
      toast(tErr(errorKind(e)), 'danger');
    },
  });
  const remove = useMutation({
    mutationFn: (tpl: EmailTemplate) => templatesApi.remove(tpl.id),
    onSuccess: async () => {
      setDeleting(null);
      await invalidateTemplates(qc);
      toast(tToast('deleted'), 'success');
    },
    onError: async (e) => {
      setDeleting(null);
      await invalidateTemplates(qc);
      toast(tErr(errorKind(e)), 'danger');
    },
  });

  const filtered = hasActiveFilter({ ...filters, q });
  const rows = list.items;

  return (
    <section>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="text-2xl font-semibold leading-tight">{t('title')}</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          variant="brand"
          className="self-start"
          data-testid="email-template-new"
          onClick={() => setEditing('new')}
        >
          <PlusIcon /> {t('newTemplate')}
        </Button>
      </div>

      <div
        role="search"
        aria-label={tBar('search')}
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
      >
        <Field label={tBar('search')} htmlFor="email-templates-search">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute start-3 top-3 size-4 text-muted-foreground" />
            <Input
              id="email-templates-search"
              type="search"
              dir="auto"
              className="ps-9"
              maxLength={100}
              value={q}
              placeholder={tBar('searchPlaceholder')}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </Field>
        <Field label={tBar('scope')} htmlFor="email-templates-scope">
          <Select
            id="email-templates-scope"
            value={filters.scope}
            onChange={(e) => apply({ scope: e.target.value as TemplateFilters['scope'] })}
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {tBar(`scopes.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tBar('purpose')} htmlFor="email-templates-purpose">
          <Select
            id="email-templates-purpose"
            value={filters.purpose}
            onChange={(e) => apply({ purpose: e.target.value as TemplateFilters['purpose'] })}
          >
            <option value="">{tBar('anyPurpose')}</option>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {tBar(`purposes.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tBar('status')} htmlFor="email-templates-status">
          <Select
            id="email-templates-status"
            value={filters.status}
            onChange={(e) => apply({ status: e.target.value as TemplateFilters['status'] })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tBar(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tBar('category')} htmlFor="email-templates-category">
          <Select
            id="email-templates-category"
            value={filters.category}
            onChange={(e) => apply({ category: e.target.value })}
          >
            <option value="">{tBar('anyCategory')}</option>
            {filters.category && !list.categories.includes(filters.category) && (
              <option value={filters.category}>{filters.category}</option>
            )}
            {list.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button
            variant="secondary"
            aria-label={tBar('refresh')}
            title={tBar('refresh')}
            onClick={() => void invalidateTemplates(qc)}
          >
            {list.isFetching && !list.isPending ? <Spinner /> : <RefreshIcon />}
          </Button>
        </div>
      </div>

      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 px-4 py-10 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        errorKind(list.error) === 'unavailable' ? (
          <EmptyState title={t('unavailableTitle')} message={t('unavailable')} />
        ) : (
          <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
        )
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title={t('emptyFilteredTitle')}
            message={t('emptyFiltered')}
            actions={
              <Button
                variant="secondary"
                onClick={() => {
                  setQ('');
                  apply({ ...DEFAULT_FILTERS });
                }}
              >
                {t('clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('emptyTitle')}
            message={t('empty')}
            actions={
              <Button variant="brand" onClick={() => setEditing('new')}>
                <PlusIcon /> {t('newTemplate')}
              </Button>
            }
          />
        )
      ) : (
        <ul className="space-y-3" aria-label={t('title')}>
          {rows.map((tpl) => (
            <TemplateRow
              key={tpl.id}
              template={tpl}
              busy={archive.isPending || remove.isPending}
              onEdit={setEditing}
              onToggleArchive={(x) => archive.mutate(x)}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{t('showing', { count: rows.length })}</span>
          {list.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
            </Button>
          )}
        </div>
      )}
      {!canManage && <p className="mt-4 text-xs text-muted-foreground">{t('noPermission')}</p>}

      {editing !== null && (
        <TemplateEditorModal
          key={editing === 'new' ? 'new' : editing.id}
          {...(editing === 'new' ? {} : { template: editing })}
          categories={list.categories}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={tDelete('title')}
        message={tDelete('message', { name: deleting?.name ?? '' })}
        confirmLabel={tDelete('confirm')}
        cancelLabel={tDelete('cancel')}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
