'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { FieldResponse, FieldSectionResponse } from '@crm/contracts';
import { Badge, Button, ConfirmDialog, EmptyState, Input, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  deactivateField,
  deleteSection,
  invalidateProperties,
  reorderFields,
  reorderSections,
  updateField,
  useContactFields,
  useFieldDependencies,
  useFieldSections,
  useFieldUsage,
} from '../api/properties';
import { errorKind } from '../lib/errors';
import {
  BUILT_IN_PROPERTIES,
  describeCondition,
  dependentsOf,
  groupBySection,
  matchesSearch,
  moveRelative,
  type SectionGroup,
} from '../lib/property-model';
import { moveItem } from '../lib/stage-model';
import { ErrorLine } from './error-line';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GripIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from './icons';
import { PropertyModal } from './property-modal';
import { SectionModal } from './section-modal';

/**
 * `/contact-properties`: every property a contact has in one place. The built-in ones (fixed), then the workspace's
 * own, grouped by section, with what type each is, whether it is required and shown, and how many contacts hold a value.
 */
export function PropertiesScreen() {
  const t = useTranslations('contacts-attributes-tags.properties');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreate = useCan('record.contact-properties.create');
  const canUpdate = useCan('record.contact-properties.update');
  const canDelete = useCan('record.contact-properties.delete');

  const fields = useContactFields(true);
  const sections = useFieldSections();
  const usage = useFieldUsage();
  const deps = useFieldDependencies();

  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [builtInOpen, setBuiltInOpen] = useState(false);
  const [editing, setEditing] = useState<{ field?: FieldResponse; sectionId?: string } | null>(
    null,
  );
  const [sectionEditing, setSectionEditing] = useState<FieldSectionResponse | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<FieldResponse | null>(null);
  const [deletingSection, setDeletingSection] = useState<SectionGroup | null>(null);
  /** Sections the owner folded away (by id); a section is open until they do. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  /** The order just chosen for one section's properties, until the server's list catches up. */
  const [pending, setPending] = useState<{ sectionId: string; ids: string[] } | null>(null);

  const allFields = useMemo(() => (fields.data ?? []).filter((f) => !f.isSystem), [fields.data]);
  const allSections = useMemo(
    () => [...(sections.data ?? [])].sort((a, b) => a.position - b.position),
    [sections.data],
  );
  const dependencies = deps.data ?? [];
  const fieldsById = useMemo(() => new Map(allFields.map((f) => [f.id, f])), [allFields]);
  const inactiveCount = allFields.filter((f) => !f.isActive).length;
  const searching = query.trim() !== '';

  const visible = allFields.filter((f) => (showInactive || f.isActive) && matchesSearch(f, query));
  const groups = groupBySection(allSections, visible).filter(
    (g) => !searching || g.fields.length > 0,
  );

  const failToast = (e: unknown) => {
    const k = errorKind(e);
    toast(
      t(
        k === 'conflict'
          ? 'toast.conflict'
          : k === 'forbidden'
            ? 'toast.forbidden'
            : 'toast.failed',
      ),
      'danger',
    );
  };

  /** All of a section's property ids in saved order, shown or not. */
  const sectionIds = (sectionId: string) =>
    allFields
      .filter((f) => f.sectionId === sectionId)
      .sort((a, b) => a.position - b.position)
      .map((f) => f.id);

  async function moveField(sectionId: string, id: string, targetId: string) {
    const next = moveRelative(sectionIds(sectionId), id, targetId);
    setPending({ sectionId, ids: next });
    try {
      await reorderFields(sectionId, next);
      await invalidateProperties(qc);
    } catch (e) {
      failToast(e);
      await invalidateProperties(qc);
    } finally {
      setPending(null);
    }
  }

  async function moveSection(id: string, delta: number) {
    const ids = allSections.map((s) => s.id);
    const next = moveItem(ids, ids.indexOf(id), ids.indexOf(id) + delta);
    try {
      await reorderSections(next);
      await invalidateProperties(qc);
    } catch (e) {
      failToast(e);
    }
  }

  const reactivate = useMutation({
    mutationFn: (f: FieldResponse) =>
      updateField(f.id, { isActive: true, rowVersion: f.rowVersion }),
    onSuccess: async () => {
      await invalidateProperties(qc);
      toast(t('toast.reactivated'), 'success');
    },
    onError: failToast,
  });

  const deactivate = useMutation({
    mutationFn: (f: FieldResponse) => deactivateField(f.id),
    onSuccess: async () => {
      await invalidateProperties(qc);
      toast(t('toast.deactivated'), 'success');
      setDeactivating(null);
    },
    onError: (e) => {
      failToast(e);
      setDeactivating(null);
    },
  });

  const removeSection = useMutation({
    mutationFn: (s: FieldSectionResponse) => deleteSection(s.id),
    onSuccess: async () => {
      await invalidateProperties(qc);
      toast(t('toast.sectionDeleted'), 'success');
      setDeletingSection(null);
    },
    onError: (e) => {
      failToast(e);
      setDeletingSection(null);
    },
  });

  function newProperty(sectionId?: string) {
    if (allSections.length === 0) {
      setSectionEditing('new');
      toast(t('toast.needSection'), 'info');
      return;
    }
    setEditing({ sectionId });
  }

  const loading = fields.isPending || sections.isPending;
  const loadError = fields.error ?? sections.error;
  const heldBy = (f: FieldResponse) => usage.data?.get(f.id);
  const deactivatingHolders = deactivating ? (heldBy(deactivating) ?? 0) : 0;
  const deactivatingDependents = deactivating
    ? dependentsOf(deactivating.id, dependencies).length
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canCreate && (
            <Button variant="secondary" onClick={() => setSectionEditing('new')}>
              <PlusIcon /> {t('newSection')}
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => newProperty()}>
              <PlusIcon /> {t('newProperty')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed">
          <div className="mb-1 font-semibold">{t('related.attributesTitle')}</div>
          <p className="text-muted-foreground">{t('related.attributesBody')}</p>
          <Link
            href="/attributes"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {t('related.attributesLink')} <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
          </Link>
        </div>
        <div className="rounded-md border border-border bg-background p-4 text-sm leading-relaxed">
          <div className="mb-1 font-semibold">{t('related.stagesTitle')}</div>
          <p className="text-muted-foreground">{t('related.stagesBody')}</p>
          <Link
            href="/contact-stages"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {t('related.stagesLink')} <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm flex-1">
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
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          {t('showInactive', { count: inactiveCount })}
        </label>
      </div>

      <BuiltInCard
        open={builtInOpen && !searching}
        onToggle={() => setBuiltInOpen((v) => !v)}
        query={query}
      />

      {loading ? (
        <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : loadError ? (
        <ErrorLine error={loadError} onRetry={() => void invalidateProperties(qc)} />
      ) : allSections.length === 0 && allFields.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('empty')}
          actions={
            canCreate && (
              <Button onClick={() => setSectionEditing('new')}>
                <PlusIcon /> {t('newSection')}
              </Button>
            )
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title={t('noMatchTitle')}
          message={t('noMatch')}
          actions={
            <Button variant="secondary" onClick={() => setQuery('')}>
              {t('clearSearch')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g, gi) => {
            const section = g.section;
            const ordered =
              section && pending?.sectionId === section.id
                ? [
                    ...pending.ids
                      .map((id) => g.fields.find((f) => f.id === id))
                      .filter((f): f is FieldResponse => Boolean(f)),
                  ]
                : g.fields;
            const key = section?.id ?? 'loose';
            const open = !folded.has(key);
            return (
              <section
                key={section?.id ?? 'loose'}
                aria-label={section?.name ?? t('noSection')}
                className="rounded-md border border-border bg-background"
              >
                <header
                  className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${open ? 'border-b border-border' : ''}`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={section?.name ?? t('noSection')}
                    onClick={() =>
                      setFolded((cur) => {
                        const next = new Set(cur);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="flex min-w-0 items-center gap-2 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <ChevronRightIcon
                      className={`size-4 shrink-0 text-muted-foreground transition-transform rtl:-scale-x-100 ${open ? 'rotate-90 rtl:-rotate-90' : ''}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold" dir="auto">
                        {section?.name ?? t('noSection')}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {section
                          ? t('sectionCount', { count: g.fields.length })
                          : t('noSectionHint')}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    {canCreate && section && (
                      <Button variant="secondary" size="sm" onClick={() => newProperty(section.id)}>
                        <PlusIcon /> {t('addHere')}
                      </Button>
                    )}
                    {canUpdate && section && !searching && (
                      <>
                        <MiniButton
                          label={t('section.moveUp', { name: section.name })}
                          disabled={gi === 0}
                          onClick={() => void moveSection(section.id, -1)}
                        >
                          <ArrowUpIcon className="size-3.5" />
                        </MiniButton>
                        <MiniButton
                          label={t('section.moveDown', { name: section.name })}
                          disabled={gi >= allSections.length - 1}
                          onClick={() => void moveSection(section.id, 1)}
                        >
                          <ArrowDownIcon className="size-3.5" />
                        </MiniButton>
                      </>
                    )}
                    {canUpdate && section && (
                      <MiniButton
                        label={t('section.rename', { name: section.name })}
                        onClick={() => setSectionEditing(section)}
                      >
                        <PencilIcon className="size-3.5" />
                      </MiniButton>
                    )}
                    {canDelete && section && (
                      <MiniButton
                        label={t('section.delete', { name: section.name })}
                        danger
                        onClick={() => setDeletingSection(g)}
                      >
                        <TrashIcon className="size-3.5" />
                      </MiniButton>
                    )}
                  </div>
                </header>

                {!open ? null : ordered.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground">{t('sectionEmpty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[46rem] text-sm">
                      <thead className="border-b border-border bg-muted text-muted-foreground">
                        <tr>
                          {(['name', 'key', 'type', 'required', 'visible', 'inUse'] as const).map(
                            (c) => (
                              <th
                                key={c}
                                className="px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-wider first:ps-4"
                              >
                                {t(`col.${c}`)}
                              </th>
                            ),
                          )}
                          <th className="w-36 px-3 py-2 pe-4 text-end text-[11px] font-semibold uppercase tracking-wider">
                            {t('col.actions')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {ordered.map((f) => (
                          <PropertyRow
                            key={f.id}
                            f={f}
                            holders={heldBy(f)}
                            conditions={dependencies
                              .filter((d) => d.fieldId === f.id)
                              .flatMap((d) => describeCondition(d, fieldsById) ?? [])}
                            canUpdate={canUpdate}
                            canDelete={canDelete}
                            canReorder={canUpdate && section !== null && !searching}
                            first={f.id === ordered[0]!.id}
                            last={f.id === ordered[ordered.length - 1]!.id}
                            onMove={(delta) => {
                              const at = ordered.findIndex((x) => x.id === f.id);
                              const target = ordered[at + delta];
                              if (target && section) void moveField(section.id, f.id, target.id);
                            }}
                            onDropOn={(dragged) =>
                              section && void moveField(section.id, dragged, f.id)
                            }
                            onEdit={() => setEditing({ field: f })}
                            onDeactivate={() => setDeactivating(f)}
                            onReactivate={() => reactivate.mutate(f)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <PropertyModal
        open={editing !== null}
        field={editing?.field}
        sectionId={editing?.sectionId}
        sections={allSections}
        fields={allFields}
        dependencies={dependencies}
        onClose={() => setEditing(null)}
      />
      <SectionModal
        open={sectionEditing !== null}
        section={sectionEditing === 'new' || sectionEditing === null ? undefined : sectionEditing}
        sections={allSections}
        onClose={() => setSectionEditing(null)}
      />
      <ConfirmDialog
        open={deactivating !== null}
        tone="danger"
        busy={deactivate.isPending}
        title={t('deactivate.title', { name: deactivating?.label ?? '' })}
        message={
          <div className="space-y-2">
            <p>
              {deactivatingHolders > 0
                ? t('deactivate.inUse', { count: deactivatingHolders })
                : t('deactivate.unused')}
            </p>
            <p>{t('deactivate.mergeTag', { key: `{{${deactivating?.key ?? ''}}}` })}</p>
            {deactivatingDependents > 0 && (
              <p>{t('deactivate.dependents', { count: deactivatingDependents })}</p>
            )}
            <p>{t('deactivate.undo')}</p>
          </div>
        }
        confirmLabel={t('deactivate.confirm')}
        cancelLabel={t('deactivate.keep')}
        onClose={() => setDeactivating(null)}
        onConfirm={() => deactivating && deactivate.mutate(deactivating)}
      />
      <ConfirmDialog
        open={deletingSection !== null}
        tone="danger"
        busy={removeSection.isPending}
        title={t('section.deleteTitle', { name: deletingSection?.section?.name ?? '' })}
        message={
          deletingSection && deletingSection.fields.length > 0
            ? t('section.deleteWithFields', { count: deletingSection.fields.length })
            : t('section.deleteEmpty')
        }
        confirmLabel={t('section.deleteConfirm')}
        cancelLabel={t('deactivate.keep')}
        onClose={() => setDeletingSection(null)}
        onConfirm={() => deletingSection?.section && removeSection.mutate(deletingSection.section)}
      />
    </div>
  );
}

function BuiltInCard({
  open,
  onToggle,
  query,
}: {
  open: boolean;
  onToggle: () => void;
  query: string;
}) {
  const t = useTranslations('contacts-attributes-tags.properties');
  const tb = useTranslations('contacts-attributes-tags.properties.builtin');
  const rows = BUILT_IN_PROPERTIES.filter((p) =>
    query.trim() === ''
      ? true
      : `${tb(p.key)} ${p.key}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  if (query.trim() !== '' && rows.length === 0) return null;
  const expanded = open || query.trim() !== '';
  return (
    <section
      className="rounded-md border border-border bg-background"
      aria-label={t('builtinCard.title')}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-start"
      >
        {expanded ? (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 text-muted-foreground rtl:rotate-180" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-base font-semibold">
            <LockIcon className="size-3.5 text-muted-foreground" /> {t('builtinCard.title')}
            <Badge>{rows.length}</Badge>
          </span>
          <span className="block text-xs text-muted-foreground">{t('builtinCard.subtitle')}</span>
        </span>
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {(['name', 'key', 'type', 'required', 'visible'] as const).map((c) => (
                  <th
                    key={c}
                    className="px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-wider first:ps-4"
                  >
                    {t(`col.${c}`)}
                  </th>
                ))}
                <th className="w-36 px-3 py-2 pe-4 text-end text-[11px] font-semibold uppercase tracking-wider">
                  {t('col.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => (
                <tr key={p.key}>
                  <td className="px-3 py-2.5 font-medium first:ps-4">{tb(p.key)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs" dir="ltr">
                    <span className="block text-start">{p.key}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{t(`types.${p.type}`)}</td>
                  <td className="px-3 py-2.5">
                    {p.required ? <Tick label={t('yes')} /> : <Dash />}
                  </td>
                  <td className="px-3 py-2.5">
                    <Tick label={t('yes')} />
                  </td>
                  <td className="px-3 py-2.5 pe-4 text-end">
                    {p.manage ? (
                      <Link
                        href={p.manage}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        {t(
                          p.manage === '/contact-stages'
                            ? 'builtinCard.manageStages'
                            : 'builtinCard.manageGroups',
                        )}
                        <ArrowRightIcon className="size-3 rtl:rotate-180" />
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <LockIcon className="size-3" /> {t('builtinCard.locked')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PropertyRow({
  f,
  holders,
  conditions,
  canUpdate,
  canDelete,
  canReorder,
  first,
  last,
  onMove,
  onDropOn,
  onEdit,
  onDeactivate,
  onReactivate,
}: {
  f: FieldResponse;
  holders: number | undefined;
  conditions: Array<{ field: string; value: string }>;
  canUpdate: boolean;
  canDelete: boolean;
  canReorder: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onDropOn: (draggedId: string) => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.properties');
  const [over, setOver] = useState(false);
  const description = typeof f.config.description === 'string' ? f.config.description : '';
  return (
    <tr
      draggable={canReorder}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-property', f.id);
      }}
      onDragOver={(e) => {
        if (!canReorder || !e.dataTransfer.types.includes('text/x-property')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData('text/x-property');
        if (id && id !== f.id) {
          e.preventDefault();
          onDropOn(id);
        }
      }}
      className={cn(
        'hover:bg-muted/50',
        !f.isActive && 'bg-muted/40 text-muted-foreground',
        over && 'bg-primary/5 shadow-[inset_0_2px_0_0_var(--primary)]',
      )}
    >
      <td className="px-3 py-3 first:ps-4">
        <div className="flex items-start gap-2">
          {canReorder && (
            <span
              aria-hidden="true"
              title={t('row.drag')}
              className="mt-0.5 cursor-grab text-muted-foreground"
            >
              <GripIcon className="size-3.5" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium" dir="auto">
                {f.label}
              </span>
              {!f.isActive && <Badge>{t('row.inactive')}</Badge>}
              {f.isReadOnly && <Badge>{t('row.readOnly')}</Badge>}
            </div>
            {description && (
              <p
                className="max-w-xs truncate text-xs text-muted-foreground"
                dir="auto"
                title={description}
              >
                {description}
              </p>
            )}
            {conditions.map((c, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {t('row.shownWhen', { field: c.field, value: c.value })}
              </p>
            ))}
          </div>
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-xs" dir="ltr">
        <span className="block text-start">{f.key}</span>
      </td>
      <td className="px-3 py-3">
        <span>{t(`types.${f.fieldType}`)}</span>
        {f.options && f.options.length > 0 && (
          <span className="block text-xs text-muted-foreground">
            {t('row.optionCount', { count: f.options.length })}
          </span>
        )}
      </td>
      <td className="px-3 py-3">{f.isRequired ? <Tick label={t('yes')} /> : <Dash />}</td>
      <td className="px-3 py-3">
        {f.isHidden ? (
          <span className="text-xs">{t('row.hidden')}</span>
        ) : (
          <Tick label={t('yes')} />
        )}
      </td>
      <td className="px-3 py-3 tabular-nums">
        {holders === undefined ? '—' : t('row.contacts', { count: holders })}
      </td>
      <td className="whitespace-nowrap px-3 py-3 pe-4 text-end">
        {canReorder && f.isActive && (
          <>
            <MiniButton
              label={t('row.moveUp', { name: f.label })}
              disabled={first}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon className="size-3.5" />
            </MiniButton>
            <MiniButton
              label={t('row.moveDown', { name: f.label })}
              disabled={last}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon className="size-3.5" />
            </MiniButton>
          </>
        )}
        {canUpdate && (
          <MiniButton label={t('row.edit', { name: f.label })} onClick={onEdit}>
            <PencilIcon className="size-3.5" />
          </MiniButton>
        )}
        {f.isActive
          ? canDelete && (
              <MiniButton
                label={t('row.deactivate', { name: f.label })}
                danger
                onClick={onDeactivate}
              >
                <TrashIcon className="size-3.5" />
              </MiniButton>
            )
          : canUpdate && (
              <Button variant="secondary" size="sm" className="ms-1" onClick={onReactivate}>
                {t('row.reactivate')}
              </Button>
            )}
      </td>
    </tr>
  );
}

const Tick = ({ label }: { label: string }) => (
  <span className="inline-flex text-success" role="img" aria-label={label}>
    <CheckIcon className="size-4" />
  </span>
);

const Dash = () => (
  <span className="text-muted-foreground" aria-hidden="true">
    &mdash;
  </span>
);

function MiniButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent',
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
