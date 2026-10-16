'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Popover, cn } from '@crm/ui';
import { LOCKED_COLUMNS, moveColumn, type ColumnDef, type ColumnId } from '../lib/columns';
import { GripIcon, TrashIcon } from './icons';

/**
 * "Modify columns" panel anchored under its (relatively positioned) button: every column with a checkbox on the left (searchable, with Select All) and the chosen ones on the
 * right in the order they are drawn (drag to re-order). Nothing changes until Save. The name column stays first.
 */
export function ColumnsModal({
  open,
  allColumns,
  current,
  onSave,
  onReset,
  onAddField,
  onClose,
}: {
  open: boolean;
  allColumns: readonly ColumnDef[];
  /** The columns drawn now, in order. */
  current: readonly ColumnId[];
  onSave: (ids: ColumnId[]) => void;
  onReset: () => void;
  onAddField?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  return (
    <Popover
      open={open}
      onClose={onClose}
      label={t('modifyColumns')}
      className="start-0 end-auto z-40 w-[min(40rem,calc(100vw-2rem))] space-y-0 p-4 max-sm:inset-x-0 max-sm:w-auto"
    >
      {open && (
        <Body
          allColumns={allColumns}
          current={current}
          onSave={onSave}
          onReset={onReset}
          onAddField={onAddField}
          onClose={onClose}
        />
      )}
    </Popover>
  );
}

function Body({
  allColumns,
  current,
  onSave,
  onReset,
  onAddField,
  onClose,
}: Omit<Parameters<typeof ColumnsModal>[0], 'open'>) {
  const t = useTranslations('contacts-attributes-tags.list');
  const [chosen, setChosen] = useState<ColumnId[]>([...current]);
  const [q, setQ] = useState('');
  const [dragId, setDragId] = useState<ColumnId | null>(null);

  const labelOf = (c: ColumnDef) => ('key' in c.label ? t(c.label.key) : c.label.text);
  const byId = useMemo(() => new Map(allColumns.map((c) => [c.id, c] as const)), [allColumns]);
  const shown = allColumns.filter((c) => labelOf(c).toLowerCase().includes(q.trim().toLowerCase()));
  const pickable = allColumns.filter((c) => !LOCKED_COLUMNS.includes(c.id));
  const allOn = pickable.every((c) => chosen.includes(c.id));

  const toggle = (id: ColumnId, on: boolean) =>
    setChosen((cur) =>
      on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((c) => c !== id),
    );
  const toggleAll = (on: boolean) =>
    setChosen((cur) => [
      ...cur.filter((c) => LOCKED_COLUMNS.includes(c) || on || false),
      ...(on ? pickable.map((c) => c.id).filter((id) => !cur.includes(id)) : []),
    ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchColumns')}
            aria-label={t('searchColumns')}
          />
          <label className="mt-3 flex items-center gap-3 border-b border-border pb-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allOn}
              onChange={(e) => toggleAll(e.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            {t('columnsSelectAll')}
          </label>
          <ul className="max-h-80 overflow-y-auto">
            {shown.map((c) => {
              const locked = LOCKED_COLUMNS.includes(c.id);
              return (
                <li key={c.id}>
                  <label
                    className={cn(
                      'flex items-center gap-3 py-2 text-sm text-muted-foreground',
                      locked && 'opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.includes(c.id)}
                      disabled={locked}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                      className="size-4 accent-[var(--brand)]"
                    />
                    {labelOf(c)}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-center text-sm text-muted-foreground">{t('dragToReorder')}</p>
          <ul className="space-y-2">
            {chosen.map((id) => {
              const c = byId.get(id);
              if (!c) return null;
              const locked = LOCKED_COLUMNS.includes(id);
              return (
                <li
                  key={id}
                  draggable={!locked}
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => dragId && e.preventDefault()}
                  onDrop={() => dragId && setChosen((cur) => moveColumn(cur, dragId, id))}
                  className={cn('flex items-center gap-2', dragId === id && 'opacity-50')}
                >
                  <GripIcon
                    className={cn('size-4 text-muted-foreground', !locked && 'cursor-grab')}
                    aria-hidden
                  />
                  <span className="flex-1 truncate rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                    {labelOf(c)}
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => toggle(id, false)}
                      aria-label={t('removeColumn', { name: labelOf(c) })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {onAddField && (
          <Button variant="secondary" onClick={onAddField}>
            {t('addColumnField')}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            onReset();
            onClose();
          }}
        >
          {t('resetColumns')}
        </Button>
        <div className="ms-auto flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => {
              onSave(chosen);
              onClose();
            }}
          >
            {t('columnsSave')}
          </Button>
        </div>
      </div>
    </div>
  );
}
