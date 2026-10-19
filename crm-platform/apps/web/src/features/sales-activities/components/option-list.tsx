'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, Spinner } from '@crm/ui';
import {
  ACTIVITY_OPTION_NAME_MAX,
  PHONE_COUNTS_AS,
  type ActivityOption,
  type PhoneCountsAs,
} from '@crm/contracts';

export interface OptionListProps {
  /** Heading of the list ("Task types", "Outcomes"). */
  title: string;
  hint?: string;
  items: ActivityOption[];
  /** The visible name of an item (a default one has none in the data). */
  nameOf: (o: ActivityOption) => string;
  disabled: boolean;
  busy: boolean;
  /** Phone outcomes say what they count as in the call log. */
  withCountsAs?: boolean;
  addLabel: string;
  placeholder: string;
  onAdd: (name: string, countsAs?: PhoneCountsAs) => Promise<boolean>;
  onRemove: (o: ActivityOption) => void;
  onReorder: (ids: string[]) => void;
}

const move = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
};

/**
 * An ordered list a person can add to, remove from and sort (drag a row, or the arrow buttons for keyboard and touch). Every change goes
 * straight to the server; the parent shows the answer. A removed item leaves the list but stays readable on the records that hold it.
 */
export function OptionList(p: OptionListProps) {
  const t = useTranslations('sales-activities.drawer');
  const [name, setName] = useState('');
  const [countsAs, setCountsAs] = useState<PhoneCountsAs>('connected');
  const [dragging, setDragging] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v || adding) return;
    setAdding(true);
    const ok = await p.onAdd(v, p.withCountsAs ? countsAs : undefined);
    setAdding(false);
    if (ok) setName('');
  };

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= p.items.length || from === to) return;
    p.onReorder(move(p.items, from, to).map((o) => o.id));
  };

  return (
    <section className="space-y-2" aria-label={p.title}>
      <div>
        <h3 className="text-sm font-semibold">{p.title}</h3>
        {p.hint && <p className="text-xs text-muted-foreground">{p.hint}</p>}
      </div>
      {p.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          {t('listEmpty')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {p.items.map((o, i) => (
            <li
              key={o.id}
              draggable={!p.disabled}
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => {
                if (dragging !== null) e.preventDefault();
              }}
              onDrop={() => {
                if (dragging !== null) reorder(dragging, i);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
              className={`flex items-center gap-2 px-2 py-1.5 ${dragging === i ? 'opacity-50' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`select-none px-1 text-muted-foreground ${p.disabled ? '' : 'cursor-grab'}`}
              >
                ⋮⋮
              </span>
              <span dir="auto" className="min-w-0 flex-1 truncate text-sm">
                {p.nameOf(o)}
                {o.countsAs && (
                  <span className="ms-2 text-xs text-muted-foreground">
                    {t('countsAsShort', { as: t(`countsAs.${o.countsAs}`) })}
                  </span>
                )}
              </span>
              {!p.disabled && (
                <span className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('moveUp', { name: p.nameOf(o) })}
                    disabled={p.busy || i === 0}
                    onClick={() => reorder(i, i - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('moveDown', { name: p.nameOf(o) })}
                    disabled={p.busy || i === p.items.length - 1}
                    onClick={() => reorder(i, i + 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('remove', { name: p.nameOf(o) })}
                    disabled={p.busy}
                    onClick={() => p.onRemove(o)}
                  >
                    ✕
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!p.disabled && (
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={p.addLabel}
            value={name}
            maxLength={ACTIVITY_OPTION_NAME_MAX}
            dir="auto"
            placeholder={p.placeholder}
            onChange={(e) => setName(e.target.value)}
            className="min-w-40 flex-1"
          />
          {p.withCountsAs && (
            <Select
              aria-label={t('countsAsLabel')}
              value={countsAs}
              onChange={(e) => setCountsAs(e.target.value as PhoneCountsAs)}
              className="w-auto"
            >
              {PHONE_COUNTS_AS.map((c) => (
                <option key={c} value={c}>
                  {t('countsAsOption', { as: t(`countsAs.${c}`) })}
                </option>
              ))}
            </Select>
          )}
          <Button type="submit" size="sm" variant="secondary" disabled={!name.trim() || adding || p.busy}>
            {adding && <Spinner />}
            {p.addLabel}
          </Button>
        </form>
      )}
    </section>
  );
}
