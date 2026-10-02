'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CouponOptionsResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { filterPlanOptions } from '../lib/form';
import { NS } from './parts';

type PlanOption = CouponOptionsResponse['plans'][number];

/**
 * The "Applicable plans" multi-select: chosen plans are chips with a remove button, "Clear all" empties the selection, and a
 * filterable list offers the rest. An empty selection means any plan.
 */
export function PlanPicker({
  id,
  options,
  value,
  onChange,
  invalid,
}: {
  id: string;
  options: readonly PlanOption[];
  value: readonly string[];
  onChange: (slugs: string[]) => void;
  invalid?: boolean;
}) {
  const t = useTranslations(`${NS}.form.fields.applicablePlanSlugs`);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const nameOf = (slug: string) => options.find((o) => o.slug === slug)?.name ?? slug;
  const available = filterPlanOptions(options, value, filter);

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5',
          invalid ? 'border-danger' : 'border-border',
        )}
      >
        <ul aria-label={t('chosen')} className="contents">
          {value.map((slug) => (
            <li
              key={slug}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
            >
              {nameOf(slug)}
              <button
                type="button"
                aria-label={t('remove', { name: nameOf(slug) })}
                onClick={() => onChange(value.filter((s) => s !== slug))}
                className="rounded-full px-1 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={filter}
          placeholder={value.length === 0 ? t('placeholder') : ''}
          onChange={(e) => {
            setFilter(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = available[0];
              if (first) {
                onChange([...value, first.slug]);
                setFilter('');
              }
            }
            if (e.key === 'Backspace' && filter === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t('clear')}
          </button>
        )}
      </div>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={t('options')}
          className="max-h-48 overflow-y-auto rounded-md border border-border bg-background py-1 shadow-sm"
        >
          {available.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('none')}</p>
          ) : (
            available.map((o) => (
              <button
                key={o.slug}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange([...value, o.slug]);
                  setFilter('');
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start text-sm hover:bg-muted"
              >
                <span>{o.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{o.slug}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
