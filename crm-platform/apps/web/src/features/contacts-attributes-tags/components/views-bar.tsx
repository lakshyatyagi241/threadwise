'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { ContactViewResponse } from '@crm/contracts';
import { Button, ConfirmDialog, Drawer, Input, Popover, cn, useToast } from '@crm/ui';
import type { ContactFilters } from '../api/contacts';
import { useContactViews, useViewMutations } from '../api/views';
import { pickerViews, tabViews, viewChanged, viewFilterOf, type ViewKind } from '../lib/views';
import { ChevronDownIcon, PlusIcon } from './icons';
import { RowMenu, RowMenuItem, RowMenuSeparator } from './row-menu';

const NS = 'contacts-attributes-tags.views';

type Drawing = { mode: 'edit'; view: ContactViewResponse } | null;

/**
 * The Contact Hub's saved views (Reference's views tabs): "All contacts" and the views pinned as tabs, a "+" picker with "Create new
 * view", and a drawer to create or rename one. A tab applies the filters the view saved; a dot on it says the list has moved away from
 * them, and its menu saves the filters now on screen back into it.
 */
export function ViewsBar({
  filters,
  defaultLimit,
  activeId,
  columnIds,
  keepsColumns,
  onSelect,
  can,
}: {
  /** The filters on screen now (what "Create view" and "Save current filters" keep). */
  filters: ContactFilters;
  defaultLimit: ContactFilters['limit'];
  /** The open view's id; empty for "All contacts". */
  activeId: string;
  /** The columns on screen now, in order. */
  columnIds: readonly string[];
  /** The open view keeps its own columns (so saving filters saves the columns too). */
  keepsColumns: boolean;
  /** A tab (or a picked / created view) was chosen; null is "All contacts". */
  onSelect: (view: ContactViewResponse | null) => void;
  can: { create: boolean; update: boolean; delete: boolean };
}) {
  const t = useTranslations(NS);
  const router = useRouter();
  const { toast } = useToast();
  const views = useContactViews(true);
  const { update, remove, pin } = useViewMutations();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawing, setDrawing] = useState<Drawing>(null);
  const [deleting, setDeleting] = useState<ContactViewResponse | null>(null);

  const all = useMemo(() => views.data ?? [], [views.data]);
  const tabs = useMemo(() => tabViews(all, activeId), [all, activeId]);
  const failed = (e: unknown) =>
    toast(t('toast.failed', { message: e instanceof Error ? e.message : String(e) }), 'danger');

  return (
    <div className="flex items-center gap-2">
      <div className="relative shrink-0">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label={t('picker.title')}
          onClick={() => setPickerOpen((o) => !o)}
          className="inline-flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="truncate">
            {activeId === '' ? t('all') : (all.find((v) => v.id === activeId)?.name ?? t('all'))}
          </span>
          <ChevronDownIcon className="size-3.5" />
        </button>
        <Popover
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          label={t('picker.title')}
          className="start-0 end-auto w-80"
        >
          <Picker
            views={all}
            activeId={activeId}
            canCreate={can.create}
            onCreate={() => {
              setPickerOpen(false);
              router.push('/contacts/views/new');
            }}
            onPick={(v) => {
              setPickerOpen(false);
              if (!v.isFavorite) pin.mutate({ id: v.id, pinned: true }, { onError: failed });
              onSelect(v);
            }}
          />
        </Popover>
      </div>
      {tabs
        .filter((v) => v.id === activeId)
        .map((v) => {
          const changed = viewChanged(v, filters, columnIds, defaultLimit);
          return (
            <div key={v.id} className="flex items-center">
              {changed && (
                <span
                  role="img"
                  aria-label={t('changed')}
                  title={t('changed')}
                  className="me-1.5 inline-block size-1.5 rounded-full bg-warning align-middle"
                />
              )}
              <span className="flex">
                <RowMenu label={t('more', { name: v.name })}>
                  {(close) => (
                    <>
                      {can.update && v.canEdit && (
                        <>
                          <RowMenuItem
                            onSelect={() => {
                              close();
                              router.push(`/contacts/views/${v.id}`);
                            }}
                          >
                            {t('menu.edit')}
                          </RowMenuItem>
                          <RowMenuItem
                            onSelect={() => {
                              close();
                              setDrawing({ mode: 'edit', view: v });
                            }}
                          >
                            {t('menu.rename')}
                          </RowMenuItem>
                          <RowMenuItem
                            onSelect={() => {
                              close();
                              update.mutate(
                                {
                                  view: v,
                                  patch: {
                                    filter: viewFilterOf(filters, keepsColumns ? columnIds : null),
                                  },
                                },
                                {
                                  onSuccess: () =>
                                    toast(t('toast.filtersSaved', { name: v.name }), 'success'),
                                  onError: failed,
                                },
                              );
                            }}
                          >
                            {t('menu.update')}
                          </RowMenuItem>
                        </>
                      )}
                      <RowMenuItem
                        onSelect={() => {
                          close();
                          pin.mutate({ id: v.id, pinned: !v.isFavorite }, { onError: failed });
                        }}
                      >
                        {v.isFavorite ? t('menu.unpin') : t('menu.pin')}
                      </RowMenuItem>
                      {can.delete && v.canManage && (
                        <>
                          <RowMenuSeparator />
                          <RowMenuItem
                            danger
                            onSelect={() => {
                              close();
                              setDeleting(v);
                            }}
                          >
                            {t('menu.delete')}
                          </RowMenuItem>
                        </>
                      )}
                    </>
                  )}
                </RowMenu>
              </span>
            </div>
          );
        })}

      <ViewDrawer
        key={drawing ? drawing.view.id : 'closed'}
        drawing={drawing}
        busy={update.isPending}
        onClose={() => setDrawing(null)}
        onSubmit={(v) => {
          if (!drawing) return;
          update.mutate(
            { view: drawing.view, patch: { name: v.name } },
            {
              onSuccess: () => {
                toast(t('toast.updated'), 'success');
                setDrawing(null);
              },
              onError: failed,
            },
          );
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('delete.title')}
        message={t('delete.message', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const v = deleting;
          if (!v) return;
          remove.mutate(v.id, {
            onSuccess: () => {
              toast(t('toast.deleted', { name: v.name }), 'success');
              if (v.id === activeId) onSelect(null);
              setDeleting(null);
            },
            onError: (e) => {
              failed(e);
              setDeleting(null);
            },
          });
        }}
      />
    </div>
  );
}

function Picker({
  views,
  activeId,
  canCreate,
  onCreate,
  onPick,
}: {
  views: readonly ContactViewResponse[];
  activeId: string;
  canCreate: boolean;
  onCreate: () => void;
  onPick: (v: ContactViewResponse) => void;
}) {
  const t = useTranslations(NS);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ViewKind>('all');
  const shown = pickerViews(views, q, kind);
  const chips: Array<[ViewKind, string]> = [
    ['all', t('picker.chipAll')],
    ['pinned', t('picker.chipPinned')],
    ['shared', t('picker.chipShared')],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t('picker.title')}</p>
        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <PlusIcon className="size-3.5" />
            {t('picker.create')}
          </button>
        )}
      </div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('picker.search')}
        aria-label={t('picker.search')}
        autoFocus
      />
      <div className="flex flex-wrap gap-1.5">
        {chips.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary',
              kind === k
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="max-h-64 space-y-0.5 overflow-y-auto">
        {shown.length === 0 && (
          <li className="py-4 text-center text-sm text-muted-foreground">{t('picker.empty')}</li>
        )}
        {shown.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onPick(v)}
              aria-current={v.id === activeId ? 'true' : undefined}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
                v.id === activeId && 'bg-muted',
              )}
            >
              <span className="min-w-0 truncate">{v.name}</span>
              {v.isFavorite && (
                <span className="shrink-0 text-xs text-muted-foreground">{t('picker.pinned')}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ViewDrawer({
  drawing,
  busy,
  onClose,
  onSubmit,
}: {
  drawing: Drawing;
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { name: string }) => void;
}) {
  const t = useTranslations(NS);
  const editing = drawing?.view ?? null;
  const [name, setName] = useState(editing?.name ?? '');
  const valid = name.trim().length > 0 && name.trim().length <= 255;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !busy) onSubmit({ name: name.trim() });
  };

  return (
    <Drawer
      open={drawing !== null}
      onClose={onClose}
      title={t('drawer.editTitle')}
      closeLabel={t('drawer.close')}
      className="w-[min(30rem,100vw)]"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('drawer.cancel')}
          </Button>
          <Button type="submit" form="view-form" variant="brand" disabled={!valid || busy}>
            {t('drawer.save')}
          </Button>
        </>
      }
    >
      <form id="view-form" onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="view-name" className="text-sm font-medium">
            {t('drawer.name')} <span className="text-danger">*</span>
          </label>
          <Input
            id="view-name"
            value={name}
            maxLength={255}
            placeholder={t('drawer.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </form>
    </Drawer>
  );
}
