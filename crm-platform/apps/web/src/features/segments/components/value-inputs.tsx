'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Popover, Select, cn } from '@crm/ui';
import type { Choice, FieldDef } from '../lib/fields';
import type { EditorValue } from '../lib/model';
import {
  MAX_LIST_VALUES,
  MAX_RELATIVE_DAYS,
  MAX_TEXT_VALUE,
  inputKindOf,
  type Operator,
} from '../lib/operators';
import { PlusIcon, SearchIcon, XIcon } from './icons';

/** The input a condition's value needs, chosen from the field's kind and the operator (see `inputKindOf`). */

/** How many choices the picker lists at once; a longer list asks the person to search. */
const SHOWN = 100;

const chip =
  'inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium';

function Chip({
  label,
  color,
  stale,
  onRemove,
  removeLabel,
}: {
  label: string;
  color?: string;
  /** The value points at something deleted. */
  stale?: boolean;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <span className={cn(chip, stale && 'border-warning/50 bg-warning/10 text-warning')}>
      {color && !stale && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
      )}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-me-0.5 inline-flex size-4 items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

/** Several choices out of a list: chips for what is chosen, a searchable checklist to add more. */
function OptionPicker({
  options,
  value,
  onChange,
  disabled,
  invalid,
  label,
}: {
  options: readonly Choice[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
}) {
  const t = useTranslations('segments.value');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const known = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const needle = q.trim().toLocaleLowerCase();
  const matching = useMemo(
    () => (needle ? options.filter((o) => o.label.toLocaleLowerCase().includes(needle)) : options),
    [options, needle],
  );
  const toggle = (v: string) =>
    onChange(
      value.includes(v) ? value.filter((x) => x !== v) : [...value, v].slice(0, MAX_LIST_VALUES),
    );
  return (
    <div
      className={cn(
        'relative flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5',
        invalid ? 'border-danger' : 'border-border',
      )}
    >
      {value.map((v) => {
        const o = known.get(v);
        return (
          <Chip
            key={v}
            label={o?.label ?? t('deleted')}
            color={o?.color}
            stale={!o}
            removeLabel={t('remove', { name: o?.label ?? t('deleted') })}
            onRemove={disabled ? undefined : () => toggle(v)}
          />
        );
      })}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        <PlusIcon className="size-3" />
        {value.length === 0 ? t('choose') : t('add')}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        className="start-0 end-auto w-72 max-w-[calc(100vw-3rem)]"
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-8 ps-8 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <ul
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="thin-scrollbar max-h-56 overflow-y-auto"
        >
          {options.length === 0 && (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('noOptions')}
            </li>
          )}
          {options.length > 0 && matching.length === 0 && (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('noMatches')}
            </li>
          )}
          {matching.slice(0, SHOWN).map((o) => {
            const on = value.includes(o.value);
            return (
              <li key={o.value} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded border text-[10px]',
                      on ? 'border-brand bg-brand text-brand-foreground' : 'border-border',
                    )}
                  >
                    {on ? '✓' : ''}
                  </span>
                  {o.color && (
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: o.color }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </button>
              </li>
            );
          })}
          {matching.length > SHOWN && (
            <li className="px-2 py-2 text-center text-xs text-muted-foreground">
              {t('refine', { count: matching.length - SHOWN })}
            </li>
          )}
        </ul>
      </Popover>
    </div>
  );
}

/** Several typed values: type one and press Enter (or a comma); paste a comma- or line-separated list. */
function TokenInput({
  value,
  onChange,
  numeric,
  disabled,
  invalid,
  label,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  numeric: boolean;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
}) {
  const t = useTranslations('segments.value');
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);
  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return true;
    if (numeric && !parts.every((p) => Number.isFinite(Number(p)))) {
      setBad(true);
      return false;
    }
    setBad(false);
    const next = [...value];
    for (const p of parts)
      if (!next.includes(p) && next.length < MAX_LIST_VALUES) next.push(p.slice(0, MAX_TEXT_VALUE));
    onChange(next);
    return true;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (add(draft)) setDraft('');
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        'flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-primary',
        invalid || bad ? 'border-danger' : 'border-border',
      )}
    >
      {value.map((v) => (
        <Chip
          key={v}
          label={v}
          removeLabel={t('remove', { name: v })}
          onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== v))}
        />
      ))}
      <input
        value={draft}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || bad || undefined}
        inputMode={numeric ? 'decimal' : undefined}
        placeholder={
          value.length === 0 ? t(numeric ? 'numbersPlaceholder' : 'tokensPlaceholder') : ''
        }
        onChange={(e) => {
          setDraft(e.target.value);
          if (bad) setBad(false);
        }}
        onKeyDown={onKey}
        onBlur={() => {
          if (draft.trim() && add(draft)) setDraft('');
        }}
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function ValueInput({
  field,
  operator,
  value,
  onChange,
  disabled,
  invalid,
  label,
}: {
  field: FieldDef;
  operator: Operator;
  value: EditorValue;
  onChange: (next: EditorValue) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Accessible name of the value control ("Value of condition 2"). */
  label: string;
}) {
  const t = useTranslations('segments.value');
  const uid = useId();
  const kind = inputKindOf(field.kind, operator);
  const str = typeof value === 'string' ? value : '';
  const list = Array.isArray(value) ? value : [];
  const range =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { from: '', to: '' };

  switch (kind) {
    case 'none':
      return null;
    case 'text':
      return (
        <Input
          value={str}
          disabled={disabled}
          invalid={invalid}
          maxLength={MAX_TEXT_VALUE}
          aria-label={label}
          placeholder={t('textPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          inputMode="decimal"
          value={str}
          disabled={disabled}
          invalid={invalid}
          aria-label={label}
          placeholder={t('numberPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'date':
      return (
        <Input
          type="date"
          value={str}
          disabled={disabled}
          invalid={invalid}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'days':
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_RELATIVE_DAYS}
            step={1}
            value={str}
            disabled={disabled}
            invalid={invalid}
            aria-label={label}
            className="w-28"
            placeholder="30"
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">
            {t(operator === 'more_than_days_ago' ? 'daysAgo' : 'days')}
          </span>
        </div>
      );
    case 'numberRange':
    case 'dateRange': {
      const type = kind === 'dateRange' ? 'date' : 'number';
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type={type}
            value={range.from}
            disabled={disabled}
            invalid={invalid}
            aria-label={`${label}: ${t('from')}`}
            className="w-36"
            onChange={(e) => onChange({ ...range, from: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">{t('and')}</span>
          <Input
            type={type}
            value={range.to}
            disabled={disabled}
            invalid={invalid}
            aria-label={`${label}: ${t('to')}`}
            className="w-36"
            onChange={(e) => onChange({ ...range, to: e.target.value })}
          />
        </div>
      );
    }
    case 'one': {
      const options = field.options ?? [];
      const stale = str !== '' && !options.some((o) => o.value === str);
      return (
        <Select
          id={uid}
          value={str}
          disabled={disabled}
          invalid={invalid}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('choose')}</option>
          {stale && (
            <option value={str} disabled>
              {t('deleted')}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    case 'pick':
      return (
        <OptionPicker
          options={field.options ?? []}
          value={list}
          onChange={onChange}
          disabled={disabled}
          invalid={invalid}
          label={label}
        />
      );
    case 'tokens':
    case 'numberTokens':
      return (
        <TokenInput
          value={list}
          onChange={onChange}
          numeric={kind === 'numberTokens'}
          disabled={disabled}
          invalid={invalid}
          label={label}
        />
      );
  }
}
