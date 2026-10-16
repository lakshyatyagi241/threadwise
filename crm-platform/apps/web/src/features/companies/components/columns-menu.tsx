'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Popover } from '@crm/ui';
import { LOCKED_COLUMNS, type ColumnDef, type ColumnId } from '../lib/columns';
import { ColumnsIcon } from './icons';

/**
 * "Columns": which columns the table shows (BL-196). A checkbox per column, changes apply at once and are remembered in this
 * browser; the company column cannot be turned off. Company properties are columns too.
 */
export function ColumnsMenu({
  allColumns,
  current,
  onChange,
  onReset,
}: {
  allColumns: readonly ColumnDef[];
  current: readonly ColumnId[];
  onChange: (ids: ColumnId[]) => void;
  onReset: () => void;
}) {
  const t = useTranslations('companies.columns');
  const tt = useTranslations('companies.table');
  const [open, setOpen] = useState(false);
  const labelOf = (c: ColumnDef) => ('key' in c.label ? tt(c.label.key) : c.label.text);
  const toggle = (id: ColumnId, on: boolean) =>
    onChange(
      allColumns
        .map((c) => c.id)
        .filter((cid) => (cid === id ? on : current.includes(cid) || LOCKED_COLUMNS.includes(cid))),
    );

  return (
    <div className="relative">
      <Button
        variant="secondary"
        className="h-10 gap-2"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ColumnsIcon /> {t('button')}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('label')}
        className="w-64 max-w-[calc(100vw-2rem)]"
      >
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
        <ul className="max-h-72 overflow-y-auto">
          {allColumns.map((c) => {
            const locked = LOCKED_COLUMNS.includes(c.id);
            return (
              <li key={c.id}>
                <label className="flex items-center gap-3 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={current.includes(c.id) || locked}
                    disabled={locked}
                    onChange={(e) => toggle(c.id, e.target.checked)}
                    className="size-4 accent-[var(--brand)]"
                  />
                  <span className="truncate" dir="auto">
                    {labelOf(c)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={onReset}
          className="text-sm text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary"
        >
          {t('reset')}
        </button>
      </Popover>
    </div>
  );
}
