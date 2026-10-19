'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useLeadScoringEnabled } from '@/features/lead-scoring';
import { useStoredValue } from '@/lib/use-stored-value';
import type { ContactViewResponse } from '@crm/contracts';
import { Button, ConfirmDialog, Drawer, Input, Popover, cn, useToast } from '@crm/ui';
import type { ContactFilters } from '../api/contacts';
import { useContactViews, useViewMutations } from '../api/views';
import { pickerViews, tabViews, viewChanged, viewFilterOf } from '../lib/views';
import { ChevronDownIcon, PlusIcon } from './icons';
import { RowMenu, RowMenuItem, RowMenuSeparator } from './row-menu';

import {
  activePreset,
  availablePresets,
  parsePresetFavorites,
  PRESET_FAVORITES_KEY,
  PRESET_VIEWS,
  QUICK_PRESETS,
  togglePresetFavorite,
  type PresetView,
} from '../lib/preset-views';

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
  onPreset,
  meId,
  count,
  can,
  hasUncontacted = false,
  hasFollowUp = false,
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
  /** A built-in view was chosen from "Default filters". */
  onPreset: (preset: PresetView) => void;
  /** The signed-in person (what "My contacts" means). */
  meId: string;
  /** How many contacts the open view holds, shown in a pill beside its name; absent while that is not known. */
  count?: number;
  can: { create: boolean; update: boolean; delete: boolean };
  /** Some contact is marked uncontacted: only then is the "Uncontacted" view offered (it stays while it is the open view). */
  hasUncontacted?: boolean;
  /** Some contact has an open follow-up: only then are the follow-up views offered (the open one stays). */
  hasFollowUp?: boolean;
}) {
  const t = useTranslations(NS);
  const router = useRouter();
  const { toast } = useToast();
  const views = useContactViews(true);
  const { update, remove, pin } = useViewMutations();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawing, setDrawing] = useState<Drawing>(null);
  const [deleting, setDeleting] = useState<ContactViewResponse | null>(null);
  // Without lead scoring there is no "Hot leads" to choose: it filters by the score.
  const scoringOn = useLeadScoringEnabled();

  const all = useMemo(() => views.data ?? [], [views.data]);
  const preset = useMemo(
    () => (activeId === '' ? activePreset(filters, meId) : null),
    [activeId, filters, meId],
  );
  const showUncontacted = hasUncontacted || preset === 'uncontacted';
  const showFollowUps = hasFollowUp || (preset !== null && preset.startsWith('followUp'));
  const quick = useMemo(
    () => availablePresets(QUICK_PRESETS, scoringOn, showUncontacted, showFollowUps),
    [scoringOn, showUncontacted, showFollowUps],
  );
  const [favRaw, setFavRaw] = useStoredValue(PRESET_FAVORITES_KEY);
  const favPresets = useMemo(() => parsePresetFavorites(favRaw), [favRaw]);
  const tabs = useMemo(() => tabViews(all, activeId), [all, activeId]);
  const failed = (e: unknown) =>
    toast(t('toast.failed', { message: e instanceof Error ? e.message : String(e) }), 'danger');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative shrink-0">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label={t('picker.title')}
          onClick={() => setPickerOpen((o) => !o)}
          className="inline-flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="truncate">
            {activeId === ''
              ? preset
                ? t(`presets.${preset}`)
                : t('all')
              : (all.find((v) => v.id === activeId)?.name ?? t('all'))}
          </span>
          {count !== undefined && (
            <span className="rounded-full bg-primary/10 px-2 text-[11px] font-semibold leading-5 tabular-nums">
              {count.toLocaleString()}
            </span>
          )}
          <ChevronDownIcon className="size-3.5" />
        </button>
        <Popover
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          label={t('picker.title')}
          className="start-0 end-auto w-80 space-y-0 overflow-hidden p-0"
        >
          <Picker
            views={all}
            activeId={activeId}
            preset={preset}
            showUncontacted={showUncontacted}
            showFollowUps={showFollowUps}
            favPresets={favPresets}
            onToggleFavPreset={(p) => setFavRaw(togglePresetFavorite(favRaw, p))}
            canCreate={can.create}
            onPreset={(p) => {
              setPickerOpen(false);
              onPreset(p);
            }}
            onAll={() => {
              setPickerOpen(false);
              onSelect(null);
            }}
            onCreate={() => {
              setPickerOpen(false);
              router.push('/contacts/views/new');
            }}
            onToggleFav={(v) =>
              pin.mutate({ id: v.id, pinned: !v.isFavorite }, { onError: failed })
            }
            onPick={(v) => {
              setPickerOpen(false);
              onSelect(v);
            }}
          />
        </Popover>
      </div>
      <div
        role="group"
        aria-label={t('quick.label')}
        className="flex flex-wrap items-center gap-1.5"
      >
        {quick.map((p) => {
          const on = activeId === '' && preset === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              // Choosing the chip that is on again goes back to all contacts.
              onClick={() => (on ? onSelect(null) : onPreset(p))}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                on
                  ? 'border-brand bg-brand/10 text-brand dark:text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(`presets.${p}`)}
            </button>
          );
        })}
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
  preset,
  showUncontacted,
  showFollowUps,
  favPresets,
  onToggleFavPreset,
  canCreate,
  onPreset,
  onAll,
  onCreate,
  onPick,
  onToggleFav,
}: {
  views: readonly ContactViewResponse[];
  activeId: string;
  preset: PresetView | null;
  showUncontacted: boolean;
  showFollowUps: boolean;
  favPresets: readonly PresetView[];
  onToggleFavPreset: (p: PresetView) => void;
  canCreate: boolean;
  onPreset: (p: PresetView) => void;
  onAll: () => void;
  onCreate: () => void;
  onPick: (v: ContactViewResponse) => void;
  onToggleFav: (v: ContactViewResponse) => void;
}) {
  const t = useTranslations(NS);
  const [q, setQ] = useState('');
  const shown = pickerViews(views, q, 'all');
  const favorites = shown.filter((v) => v.isFavorite);
  const scoringOn = useLeadScoringEnabled();
  const presets = availablePresets(PRESET_VIEWS, scoringOn, showUncontacted, showFollowUps).filter(
    (p) => q.trim() === '' || t(`presets.${p}`).toLowerCase().includes(q.trim().toLowerCase()),
  );
  const favPresetsShown = presets.filter((p) => favPresets.includes(p));
  const allMatches = q.trim() === '' || t('all').toLowerCase().includes(q.trim().toLowerCase());
  const showAll = allMatches || presets.length > 0;
  const searching = q.trim() !== '';
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const isOpen = (key: string) => searching || !closed[key];
  const row = (active: boolean) =>
    cn(
      'flex min-w-0 flex-1 items-center px-4 py-2.5 text-start text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
      active && 'bg-primary/10 font-semibold',
    );
  /** A group header: a chevron, the title in capitals and how many rows it holds; a click folds the group. */
  const group = (key: string, title: string, count: number) => (
    <li key={`g-${key}`}>
      <button
        type="button"
        aria-expanded={isOpen(key)}
        onClick={() => !searching && setClosed((c) => ({ ...c, [key]: isOpen(key) }))}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-[12px] font-bold uppercase tracking-wide text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <ChevronDownIcon
          className={cn('size-3 shrink-0 transition', !isOpen(key) && '-rotate-90 rtl:rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      </button>
    </li>
  );
  const star = (on: boolean, toggle: () => void, name: string) => (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={`${t(on ? 'picker.unmarkFavorite' : 'picker.markFavorite')}: ${name}`}
      title={t(on ? 'picker.unmarkFavorite' : 'picker.markFavorite')}
      className={cn(
        'me-3 shrink-0 rounded px-1 text-lg leading-none outline-none focus-visible:ring-2 focus-visible:ring-primary',
        on ? 'text-amber-400' : 'text-muted-foreground/50 hover:text-amber-400',
      )}
    >
      {on ? '★' : '☆'}
    </button>
  );
  const item = 'flex items-center border-t border-border';
  const presetRow = (p: PresetView, scope: string) => (
    <li key={`${scope}-${p}`} className={item}>
      <button
        type="button"
        onClick={() => onPreset(p)}
        aria-current={activeId === '' && preset === p ? 'true' : undefined}
        className={row(activeId === '' && preset === p)}
      >
        <span className="min-w-0 truncate">{t(`presets.${p}`)}</span>
      </button>
      {star(favPresets.includes(p), () => onToggleFavPreset(p), t(`presets.${p}`))}
    </li>
  );
  const viewRow = (v: ContactViewResponse, scope: string) => (
    <li key={`${scope}-${v.id}`} className={item}>
      <button
        type="button"
        onClick={() => onPick(v)}
        aria-current={v.id === activeId ? 'true' : undefined}
        className={row(v.id === activeId)}
      >
        <span className="min-w-0 truncate">{v.name}</span>
      </button>
      {star(v.isFavorite, () => onToggleFav(v), v.name)}
    </li>
  );
  const favCount = favorites.length + favPresetsShown.length;
  return (
    <div>
      <h2 className="sr-only">{t('picker.title')}</h2>
      <div className="p-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('picker.search')}
          aria-label={t('picker.search')}
          autoFocus
        />
      </div>
      <ul className="max-h-80 overflow-y-auto border-b border-border">
        {favCount > 0 && (
          <>
            {group('fav', t('picker.favorites'), favCount)}
            {isOpen('fav') && (
              <>
                {favPresetsShown.map((p) => presetRow(p, 'fav'))}
                {favorites.map((v) => viewRow(v, 'fav'))}
              </>
            )}
          </>
        )}
        {showAll && (
          <>
            {group('def', t('picker.defaultFilters'), (allMatches ? 1 : 0) + presets.length)}
            {isOpen('def') && (
              <>
                {allMatches && (
                  <li className={item}>
                    <button
                      type="button"
                      onClick={onAll}
                      aria-current={activeId === '' && preset === null ? 'true' : undefined}
                      className={row(activeId === '' && preset === null)}
                    >
                      {t('all')}
                    </button>
                  </li>
                )}
                {presets.map((p) => presetRow(p, 'def'))}
              </>
            )}
          </>
        )}
        {group('made', t('picker.createdViews'), shown.length)}
        {isOpen('made') && (
          <>
            {shown.length === 0 && (
              <li className="border-t border-border py-4 text-center text-sm text-muted-foreground">
                {t('picker.empty')}
              </li>
            )}
            {shown.map((v) => viewRow(v, 'all'))}
          </>
        )}
      </ul>
      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center gap-2 px-4 py-3 text-[13px] font-medium text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <PlusIcon className="size-3.5" />
          {t('picker.addView')}
        </button>
      )}
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
