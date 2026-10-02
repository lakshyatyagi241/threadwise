'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Textarea, cn } from '@crm/ui';
import {
  DESCRIPTION_MAX,
  MAX_LINES,
  addLine,
  duplicateLine,
  isBlankLine,
  moveLine,
  removeLine,
  type DraftErrors,
  type DraftLine,
} from '../lib/builder';
import { currencySymbol, formatMoney } from '../lib/money';
import type { LineTotals } from '../lib/totals';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyDocIcon,
  GripIcon,
  PlusIcon,
  TrashIcon,
} from './icons';

const iconBtn =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

export interface LineItemsEditorProps {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  currency: string;
  /** Computed totals for the rows that count (blank rows have none). */
  totals: readonly LineTotals[];
  errors: DraftErrors['lines'];
  /** Show the field messages (after a failed save), not while typing the first row. */
  showErrors: boolean;
  /** The document's default tax rate, shown as the placeholder of each row's tax box. */
  defaultTax: string;
  /** Ask the editor to focus a row's description (after "add row" from a shortcut). */
  focusKey: string | null;
}

/**
 * The rows of the document. Each row is a small card: the description on top, then quantity, unit price, discount, tax and the
 * line amount in one line (two columns on a phone). Rows can be added, duplicated, removed and reordered (the handle drags; the
 * arrows and Alt+Up/Down move by keyboard). Every field is labelled for assistive technology.
 */
export function LineItemsEditor(p: LineItemsEditorProps) {
  const t = useTranslations('sales-docs.builder.items');
  const te = useTranslations('sales-docs.builder.problems');
  const locale = useLocale();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<string | null>(null);
  const symbol = currencySymbol(p.currency, locale);

  const set = (key: string, patch: Partial<DraftLine>) =>
    p.onChange(p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Totals are for the rows that count; map them back onto the visible rows.
  const countable = p.lines.filter((l) => !isBlankLine(l));
  const totalOf = (key: string): LineTotals | undefined => {
    const at = countable.findIndex((l) => l.key === key);
    return at >= 0 ? p.totals[at] : undefined;
  };

  // After a row is added (or moved by keyboard) its description takes the focus once the row exists.
  useEffect(() => {
    const key = pendingFocus.current;
    pendingFocus.current = null;
    if (key) refs.current.get(key)?.focus();
  }, [p.lines]);
  // The builder's own shortcut (Alt+N) asks for focus by naming the new row.
  useEffect(() => {
    if (p.focusKey) refs.current.get(p.focusKey)?.focus();
  }, [p.focusKey]);

  const add = () => {
    const next = addLine(p.lines);
    p.onChange(next);
    const added = next[next.length - 1];
    if (added && next.length !== p.lines.length) pendingFocus.current = added.key;
  };

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {p.lines.map((l, i) => {
          const err = p.showErrors ? p.errors[l.key] : undefined;
          const first = err ? (Object.values(err)[0] ?? null) : null;
          const total = totalOf(l.key);
          return (
            <li
              key={l.key}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) p.onChange(moveLine(p.lines, dragFrom, i));
                setDragFrom(null);
                setDragOver(null);
              }}
              className={cn(
                'rounded-lg border border-border bg-background p-2.5 transition-colors',
                dragOver === i && dragFrom !== null && dragFrom !== i && 'border-brand bg-brand/5',
                dragFrom === i && 'opacity-50',
              )}
            >
              <div className="flex items-start gap-2">
                {/* move handle: drag with the mouse, or use the arrows */}
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', l.key);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  title={t('drag')}
                  aria-hidden="true"
                  className="mt-2 inline-flex size-6 shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-0.5 text-muted-foreground active:cursor-grabbing"
                >
                  <GripIcon className="size-4" />
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start gap-1">
                    <Textarea
                      ref={(el) => {
                        if (el) refs.current.set(l.key, el);
                        else refs.current.delete(l.key);
                      }}
                      rows={1}
                      value={l.description}
                      placeholder={t('descriptionPlaceholder')}
                      aria-label={t('descriptionFor', { n: i + 1 })}
                      maxLength={DESCRIPTION_MAX + 50}
                      invalid={!!err?.description}
                      dir="auto"
                      onChange={(e) =>
                        set(l.key, { description: e.target.value.replace(/\n/g, ' ') })
                      }
                      onKeyDown={(e) => {
                        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                          e.preventDefault();
                          p.onChange(moveLine(p.lines, i, i + (e.key === 'ArrowUp' ? -1 : 1)));
                          pendingFocus.current = l.key;
                        }
                      }}
                      className="min-h-10 min-w-0 flex-1 resize-none py-2"
                    />
                    <RowButtons p={p} l={l} i={i} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[4.25rem_7rem_5.5rem_5.5rem_minmax(5.5rem,1fr)]">
                    <NumberBox
                      label={t('qtyFor', { n: i + 1 })}
                      caption={t('qty')}
                      value={l.qty}
                      invalid={!!err?.qty}
                      onChange={(v) => set(l.key, { qty: v })}
                    />
                    <NumberBox
                      label={t('unitFor', { n: i + 1 })}
                      caption={t('unit')}
                      value={l.unit}
                      invalid={!!err?.unit}
                      placeholder="0.00"
                      onChange={(v) => set(l.key, { unit: v })}
                    />
                    <NumberBox
                      label={t('discountFor', { n: i + 1 })}
                      caption={t('discount')}
                      value={l.discount}
                      invalid={!!err?.discount}
                      placeholder="0"
                      suffix={l.discountKind === 'percent' ? '%' : symbol}
                      toggle={{
                        label: t(
                          l.discountKind === 'percent' ? 'discountToAmount' : 'discountToPercent',
                          { n: i + 1 },
                        ),
                        onClick: () =>
                          set(l.key, {
                            discountKind: l.discountKind === 'percent' ? 'amount' : 'percent',
                          }),
                      }}
                      onChange={(v) => set(l.key, { discount: v })}
                    />
                    <NumberBox
                      label={t('taxFor', { n: i + 1 })}
                      caption={t('tax')}
                      value={l.tax}
                      invalid={!!err?.tax}
                      placeholder={p.defaultTax || '0'}
                      suffix="%"
                      onChange={(v) => set(l.key, { tax: v })}
                    />
                    <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:block">
                      <span className="text-xs text-muted-foreground sm:mb-1 sm:block">
                        {t('amount')}
                      </span>
                      <output
                        aria-label={t('amountFor', { n: i + 1 })}
                        className="block text-end text-sm font-semibold tabular-nums sm:pt-2.5"
                        dir="ltr"
                      >
                        {total ? formatMoney(total.netMinor, p.currency, locale) : '-'}
                      </output>
                    </div>
                  </div>
                </div>
              </div>
              {first && (
                <p role="alert" className="mt-1.5 ps-8 text-xs text-danger">
                  {t('row', { n: i + 1 })}: {te(first)}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <Button
        variant="secondary"
        size="sm"
        onClick={add}
        disabled={p.lines.length >= MAX_LINES}
        aria-keyshortcuts="Alt+N"
      >
        <PlusIcon /> {t('add')}
      </Button>
    </div>
  );
}

function RowButtons({ p, l, i }: { p: LineItemsEditorProps; l: DraftLine; i: number }) {
  const t = useTranslations('sales-docs.builder.items');
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        className={iconBtn}
        disabled={i === 0}
        onClick={() => p.onChange(moveLine(p.lines, i, i - 1))}
        aria-label={t('moveUp', { n: i + 1 })}
        title={t('moveUp', { n: i + 1 })}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        className={iconBtn}
        disabled={i === p.lines.length - 1}
        onClick={() => p.onChange(moveLine(p.lines, i, i + 1))}
        aria-label={t('moveDown', { n: i + 1 })}
        title={t('moveDown', { n: i + 1 })}
      >
        <ChevronDownIcon />
      </button>
      <button
        type="button"
        className={cn(iconBtn, 'hidden sm:inline-flex')}
        disabled={p.lines.length >= MAX_LINES}
        onClick={() => p.onChange(duplicateLine(p.lines, l.key))}
        aria-label={t('duplicate', { n: i + 1 })}
        title={t('duplicate', { n: i + 1 })}
      >
        <CopyDocIcon />
      </button>
      <button
        type="button"
        className={cn(iconBtn, 'hover:text-danger')}
        onClick={() => p.onChange(removeLine(p.lines, l.key))}
        aria-label={t('remove', { n: i + 1 })}
        title={t('remove', { n: i + 1 })}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/** A small numeric box with its caption above: right-aligned digits, an optional unit after them. */
function NumberBox({
  label,
  caption,
  value,
  onChange,
  invalid,
  placeholder,
  suffix,
  toggle,
}: {
  label: string;
  caption: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  placeholder?: string;
  suffix?: string;
  /** Makes the suffix a button (the discount's % / currency switch). */
  toggle?: { label: string; onClick: () => void };
}) {
  return (
    <div className="relative min-w-0">
      <span aria-hidden="true" className="mb-1 block truncate text-xs text-muted-foreground">
        {caption}
      </span>
      <Input
        value={value}
        placeholder={placeholder}
        aria-label={label}
        inputMode="decimal"
        dir="ltr"
        invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        className={cn('text-end tabular-nums', suffix && (toggle ? 'pe-9' : 'pe-7'))}
      />
      {suffix &&
        (toggle ? (
          <button
            type="button"
            onClick={toggle.onClick}
            aria-label={toggle.label}
            title={toggle.label}
            className="absolute bottom-1 end-1 flex h-8 min-w-6 items-center justify-center rounded px-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            {suffix}
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 end-2.5 flex h-10 items-center text-xs text-muted-foreground"
          >
            {suffix}
          </span>
        ))}
    </div>
  );
}
