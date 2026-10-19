'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, MultiSelect, Select, cn, useToast } from '@crm/ui';
import type { ViewAccessType, ViewShareMode } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useLeadScoringEnabled } from '@/features/lead-scoring';
import { RulesEditor, usePeople, useRulesDraft } from '@/features/segments';
import { useAttributes } from '../api/attributes';
import { useContactViews, useViewMutations } from '../api/views';
import {
  allColumns,
  defaultColumns,
  LOCKED_COLUMNS,
  moveColumn,
  nudgeColumn,
  omittedColumns,
  restoreOmitted,
  type ColumnDef,
  type ColumnId,
} from '../lib/columns';
import { composeViewFilter, viewColumnsOf, viewRulesOf } from '../lib/views';
import { GripIcon, LockIcon, StarIcon, XIcon } from './icons';

const NS = 'contacts-attributes-tags.views.editor';
const TL = 'contacts-attributes-tags.list';

/**
 * The full page "Create New View" / "Edit View" (Reference's view editor): a name, favorite and sharing, the rules that pick the
 * contacts ("Filter Contacts"), and which columns the view shows and in what order ("Column Preferences"). Saving writes one
 * contact view; opening that view later applies its rules and its columns.
 */
export function ViewEditorScreen({ id }: { id?: string }) {
  const views = useContactViews(true);
  const canCreate = useCan('record.contact-views.create');
  const canUpdate = useCan('record.contact-views.update');
  const t = useTranslations(NS);

  if (id) {
    if (views.isPending)
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      );
    const view = views.data?.find((v) => v.id === id);
    if (!view)
      return (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-danger">
            {t('notFound')}
          </p>
          <Link href="/contacts" className="text-sm font-medium text-primary hover:underline">
            {t('back')}
          </Link>
        </div>
      );
    if (!canUpdate)
      return (
        <p role="alert" className="text-sm text-danger">
          {t('noPermission')}
        </p>
      );
    // Keyed by the view's version: a refetch after a save never leaves stale form state behind.
    return <Editor key={`${view.id}:${view.rowVersion}`} view={view} />;
  }
  if (!canCreate)
    return (
      <p role="alert" className="text-sm text-danger">
        {t('noPermission')}
      </p>
    );
  return <Editor key="new" />;
}

type View = NonNullable<ReturnType<typeof useContactViews>['data']>[number];

const byIdOf = (catalog: readonly ColumnDef[]) => new Map(catalog.map((c) => [c.id, c] as const));

function Editor({ view }: { view?: View }) {
  const t = useTranslations(NS);
  const tl = useTranslations(TL);
  const tv = useTranslations('contacts-attributes-tags.views');
  const router = useRouter();
  const { toast } = useToast();
  const { create, update, pin } = useViewMutations();
  const attributes = useAttributes();

  const [name, setName] = useState(view?.name ?? '');
  const [favorite, setFavorite] = useState(view?.isFavorite ?? false);
  const [shareMode, setShareMode] = useState<ViewShareMode>(view?.shareMode ?? 'me');
  const [accessType, setAccessType] = useState<ViewAccessType>(
    view && view.shareMode !== 'me' ? view.accessType : 'can_view',
  );
  const [userIds, setUserIds] = useState<string[]>(view?.sharedWith ?? []);
  const [colSearch, setColSearch] = useState('');
  const people = usePeople(true);
  // Only the creator changes who a view is shared with; someone it is shared with as can_edit changes its name, filter and columns.
  const canShare = !view || view.canManage;
  const [tried, setTried] = useState(false);
  const rules = useRulesDraft(view ? viewRulesOf(view.filter) : '');

  const attrCols = useMemo(
    () =>
      (attributes.data ?? []).filter((a) => a.active && !a.hidden).map((a) => ({ key: a.key, name: a.name })),
    [attributes.data],
  );
  // Lead scoring off: the Lead score column is not offered. A view that already lists it keeps it (it comes back with scoring).
  const scoringOn = useLeadScoringEnabled();
  const omitted = useMemo(() => omittedColumns({ canCompany: true, scoringOn }), [scoringOn]);
  const catalog = useMemo(() => allColumns(attrCols, omitted), [attrCols, omitted]);
  const known = useMemo(() => new Set(catalog.map((c) => c.id)), [catalog]);
  // Until the person changes the selection: what the view saved (only columns that still exist), else the usual defaults.
  const [picked, setPicked] = useState<ColumnId[] | null>(null);
  const selected: ColumnId[] = useMemo(() => {
    const base =
      picked ??
      (view ? (viewColumnsOf(view.filter) as ColumnId[] | null) : null) ??
      defaultColumns(attrCols);
    const kept = base.filter((id) => known.has(id) || attributes.isPending);
    return [...LOCKED_COLUMNS.filter((l) => !kept.includes(l)), ...kept];
  }, [picked, view, attrCols, known, attributes.isPending]);

  const label = (c: ColumnDef) => ('key' in c.label ? tl(c.label.key) : c.label.text);
  // One list: the chosen columns first, in order, then the rest (unchecked) in their usual order.
  // Two lists, as in Reference: everything that can be shown (searchable), and what is shown now, in order.
  const available = useMemo(() => {
    const q = colSearch.trim().toLowerCase();
    return q ? catalog.filter((c) => label(c).toLowerCase().includes(q)) : catalog;
    // `label` only reads the translators, which change with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, colSearch, tl]);
  const chosen = useMemo(
    () => selected.flatMap((id) => (byIdOf(catalog).get(id) ? [byIdOf(catalog).get(id)!] : [])),
    [selected, catalog],
  );
  const togglable = available.filter((c) => !LOCKED_COLUMNS.includes(c.id));
  const allOn = togglable.length > 0 && togglable.every((c) => selected.includes(c.id));
  const setAll = (on: boolean) => {
    const ids = togglable.map((c) => c.id);
    setPicked(
      on
        ? [...selected, ...ids.filter((id) => !selected.includes(id))]
        : selected.filter((id) => LOCKED_COLUMNS.includes(id) || !ids.includes(id)),
    );
  };

  const setCol = (id: ColumnId, on: boolean) => {
    if (LOCKED_COLUMNS.includes(id)) return;
    setPicked(on ? [...selected.filter((c) => c !== id), id] : selected.filter((c) => c !== id));
  };
  // Drag a chosen column onto another to move it there; the handle also answers the arrow keys.
  const [dragId, setDragId] = useState<ColumnId | null>(null);
  const [overId, setOverId] = useState<ColumnId | null>(null);
  const dropOn = (target: ColumnId) => {
    if (dragId) setPicked(moveColumn(selected, dragId, target));
    setDragId(null);
    setOverId(null);
  };

  const nameOk = name.trim().length > 0;
  const filterOk = rules.summary.count > 0 && rules.summary.valid;
  const peopleOk = shareMode !== 'selected' || userIds.length > 0;
  const busy = create.isPending || update.isPending || pin.isPending;
  const back = view ? `/contacts?view=${view.id}` : '/contacts';

  const fail = (e: unknown) =>
    toast(tv('toast.failed', { message: e instanceof Error ? e.message : String(e) }), 'danger');

  const submit = () => {
    setTried(true);
    if (!nameOk || !filterOk || !peopleOk || busy) return;
    const filter = composeViewFilter(
      view?.filter ?? null,
      rules.summary.rules,
      restoreOmitted(selected, view ? viewColumnsOf(view.filter) : null, omitted),
    );
    if (!view) {
      create.mutate(
        {
          name: name.trim(),
          filter,
          pin: favorite,
          shareMode,
          accessType,
          ...(shareMode === 'selected' ? { userIds } : {}),
        },
        {
          onSuccess: (v) => {
            toast(tv('toast.created', { name: v.name }), 'success');
            router.push(`/contacts?view=${v.id}`);
          },
          onError: fail,
        },
      );
      return;
    }
    update.mutate(
      {
        view,
        patch: {
          name: name.trim(),
          filter,
          // The creator alone sends the sharing; for anyone else it is left as it is.
          ...(canShare
            ? { shareMode, accessType, ...(shareMode === 'selected' ? { userIds } : {}) }
            : {}),
        },
      },
      {
        onSuccess: () => {
          const finish = () => {
            toast(tv('toast.updated'), 'success');
            router.push(back);
          };
          if (favorite !== view.isFavorite)
            pin.mutate({ id: view.id, pinned: favorite }, { onSuccess: finish, onError: fail });
          else finish();
        },
        onError: fail,
      },
    );
  };

  return (
    <form
      className="flex min-h-[calc(100dvh-8rem)] w-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <header className="sticky top-14 z-[35] -mx-4 -mt-4 flex items-center justify-between border-b border-border bg-background px-4 py-3 md:-mx-6 md:-mt-6 md:px-6">
        <h1 className="text-xl font-semibold">{view ? t('title.edit') : t('title.create')}</h1>
        <Link
          href={back}
          aria-label={t('close')}
          title={t('close')}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-5" />
        </Link>
      </header>

      <div className="grid flex-1 gap-10 py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Left: name, favorite, sharing and the conditions. Right: the columns. */}
        <div className="space-y-5">
          <div className="space-y-1">
            <label htmlFor="ve-name" className="text-sm font-medium">
              {t('name')} <span className="text-danger">*</span>
            </label>
            <div className="flex items-center gap-3">
              <Input
                id="ve-name"
                value={name}
                maxLength={255}
                placeholder={t('namePlaceholder')}
                aria-invalid={tried && !nameOk}
                onChange={(e) => setName(e.target.value)}
                className="flex-1"
              />
              <button
                type="button"
                aria-pressed={favorite}
                onClick={() => setFavorite((f) => !f)}
                title={t('favoriteHint')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              >
                <StarIcon
                  className={cn('size-5', favorite ? 'text-warning' : 'text-muted-foreground')}
                  fill={favorite ? 'currentColor' : 'none'}
                />
                {t('favorite')}
              </button>
            </div>
            {tried && !nameOk && (
              <p role="alert" className="text-xs text-danger">
                {t('needName')}
              </p>
            )}
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="ve-share" className="text-sm font-medium">
                {t('shareWith')}
              </label>
              <Select
                id="ve-share"
                value={shareMode}
                disabled={!canShare}
                onChange={(e) => setShareMode(e.target.value as ViewShareMode)}
              >
                <option value="me">{t('justMe')}</option>
                <option value="everyone">{t('everyone')}</option>
                <option value="selected">{t('selectedUsers')}</option>
              </Select>
            </div>
            {shareMode !== 'me' && (
              <div className="space-y-1">
                <label htmlFor="ve-access" className="text-sm font-medium">
                  {t('accessLevel')}
                </label>
                <Select
                  id="ve-access"
                  value={accessType}
                  disabled={!canShare}
                  onChange={(e) => setAccessType(e.target.value as ViewAccessType)}
                >
                  <option value="can_view">{t('canView')}</option>
                  <option value="can_edit">{t('canEdit')}</option>
                </Select>
              </div>
            )}
            {shareMode === 'selected' && (
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="ve-people" className="text-sm font-medium">
                  {t('selectedUsers')} <span className="text-danger">*</span>
                </label>
                <MultiSelect
                  id="ve-people"
                  label={t('selectedUsers')}
                  placeholder={t('peoplePlaceholder')}
                  emptyLabel={t('noPeople')}
                  removeLabel={(n) => t('removePerson', { name: n })}
                  clearLabel={t('clearPeople')}
                  disabled={!canShare}
                  options={(people.data ?? []).map((p) => ({
                    value: p.id,
                    label: p.fullName || p.email || p.id,
                  }))}
                  value={userIds}
                  onChange={setUserIds}
                />
                {tried && !peopleOk && (
                  <p role="alert" className="text-xs text-danger">
                    {t('needPeople')}
                  </p>
                )}
              </div>
            )}
            {!canShare && (
              <p className="text-xs text-muted-foreground sm:col-span-2">{t('onlyCreator')}</p>
            )}
          </div>
          <section className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold">
                {t('filterTitle')} <span className="text-danger">*</span>
              </h2>
              <p className="text-xs text-muted-foreground">{t('filterHint')}</p>
            </div>
            <RulesEditor state={rules} showProblems={tried} />
            {tried && !filterOk && rules.ready && (
              <p role="alert" className="text-xs text-danger">
                {t('needFilter')}
              </p>
            )}
          </section>
        </div>
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">{t('columnsTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('columnsHint')}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col rounded-lg border border-border">
              <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('available')}
              </p>
              <div className="space-y-2 p-3">
                <Input
                  value={colSearch}
                  onChange={(e) => setColSearch(e.target.value)}
                  placeholder={t('searchColumns')}
                  aria-label={t('searchColumns')}
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allOn}
                    disabled={togglable.length === 0}
                    onChange={(e) => setAll(e.target.checked)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {t('selectAll')}
                </label>
              </div>
              <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto border-t border-border">
                {available.length === 0 && (
                  <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                    {t('noColumnMatch')}
                  </li>
                )}
                {available.map((c) => {
                  const locked = LOCKED_COLUMNS.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={selected.includes(c.id)}
                          disabled={locked}
                          onChange={(e) => setCol(c.id, e.target.checked)}
                          className="size-4 accent-[var(--primary)]"
                        />
                        <span className="min-w-0 truncate">{label(c)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col rounded-lg border border-border">
              <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('selected')} ({chosen.length})
              </p>
              <p className="px-3 pt-2 text-center text-xs text-muted-foreground">{t('reorder')}</p>
              <ul className="max-h-[55vh] space-y-1 overflow-y-auto p-2">
                {chosen.map((c) => {
                  const locked = LOCKED_COLUMNS.includes(c.id);
                  return (
                    <li
                      key={c.id}
                      draggable={!locked}
                      onDragStart={() => setDragId(c.id)}
                      onDragOver={(e) => {
                        if (dragId && !locked) {
                          e.preventDefault();
                          setOverId(c.id);
                        }
                      }}
                      onDrop={() => dropOn(c.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      className={cn(
                        'flex items-center gap-2 rounded-md border border-border border-t-2 bg-background px-2 py-1.5 text-sm',
                        dragId === c.id && 'opacity-40',
                        overId === c.id && dragId !== c.id && 'border-t-primary',
                      )}
                    >
                      {locked ? (
                        <LockIcon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-label={t('locked')}
                        />
                      ) : (
                        <button
                          type="button"
                          aria-label={t('drag', { name: label(c) })}
                          title={t('drag', { name: label(c) })}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              setPicked(nudgeColumn(selected, c.id, e.key === 'ArrowUp' ? -1 : 1));
                            }
                          }}
                          className="cursor-grab rounded p-0.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
                        >
                          <GripIcon className="size-4" />
                        </button>
                      )}
                      <span className="min-w-0 flex-1 truncate">{label(c)}</span>
                      {!locked && (
                        <button
                          type="button"
                          aria-label={t('remove', { name: label(c) })}
                          onClick={() => setCol(c.id, false)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      </div>

      <footer className="sticky bottom-0 z-[35] -mx-4 -mb-4 flex items-center justify-end gap-3 border-t border-border bg-background px-4 py-3 md:-mx-6 md:-mb-6 md:px-6">
        <Button type="button" variant="secondary" onClick={() => router.push(back)}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="brand" disabled={busy}>
          {busy ? t('saving') : view ? t('save') : t('create')}
        </Button>
      </footer>
    </form>
  );
}
