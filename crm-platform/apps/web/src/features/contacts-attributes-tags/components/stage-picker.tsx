'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@crm/ui';
import type { Choice } from '../lib/option-sets';
import { optionColor } from '../lib/stage-model';
import { StageBadge } from './chips';
import { CheckIcon, ChevronDownIcon } from './icons';

/** More stages than this and the list gets a search box. */
export const SEARCH_FROM = 8;

const PANEL_W = 272;
const SHEET_BELOW = 640;

export type StagePickerLook =
  /** The stage as a coloured chip with a caret (the list, the quick view). */
  | 'chip'
  /** "Stage: Qualified" as a field-like button (the record page, the bulk update form). */
  | 'field';

export interface StagePickerProps {
  /** The current stage's value; empty when there is none (a form field that keeps what each contact has). */
  value: string;
  /** The status the contact holds, to mark it under its stage. */
  status?: string | null;
  stages: readonly Choice[];
  /** The statuses that may be chosen in a stage (the small choices shown under it). */
  statusesOf?: (stage: string) => readonly Choice[];
  /** The stage's default status (marked "default" among its choices). */
  defaultStatusOf?: (stage: string) => string | null;
  /** What moving to a stage does to the status already held ("Status becomes X"), shown under the stage. */
  hint?: (stage: string) => string | null;
  /** The person may not change it: the same thing is drawn, as plain text. */
  readOnly?: boolean;
  busy?: boolean;
  look?: StagePickerLook;
  /** The contact's name, for the accessible name of the control. */
  name?: string;
  /** Text of the trigger when the caller already worded it ("Stage: Qualified"); the chip look uses the stage's own label. */
  triggerText?: string;
  /** Adds a first choice that means "change nothing" (value `''`), worded like this (the bulk form's "Keep"). */
  keepLabel?: string;
  /** The caret shows only while the row is hovered or has focus (inside a `group`). */
  quietCaret?: boolean;
  /** "3 of 9" beside the label. */
  progress?: boolean;
  className?: string;
  /** The id of the trigger button (a form label points at it) and whether it takes the cursor when drawn. */
  id?: string;
  autoFocus?: boolean;
  /** The person chose: a stage, and a status if they picked one under it (`undefined` = the default rule). `stage === ''` is "Keep". */
  onPick: (stage: string, status?: string | null) => void;
}

/**
 * The ONE lifecycle stage control of the CRM: a popover list (always vertical, never a horizontal scroller; a bottom sheet on a phone)
 * with a coloured dot per stage and the current stage checked. Choosing a stage that has statuses opens them under it as small choices
 * and a "Move" button (the stage's default status applies); choosing a status moves and sets it in one go; a stage without statuses
 * moves at once. A search box shows when there are more than eight stages. Arrow keys move, Enter chooses, Escape closes. The owner of
 * the contact data does the saving (optimistic, with undo): this is only the picker.
 */
export function StagePicker(p: StagePickerProps) {
  const t = useTranslations('contacts-attributes-tags.contact.record.stagePicker');
  const tm = useTranslations('contacts-attributes-tags.stageMenu');
  const [open, setOpen] = useState(false);
  const current = p.stages.find((s) => s.value === p.value);
  const text =
    p.triggerText ?? (p.value === '' && p.keepLabel ? p.keepLabel : (current?.label ?? p.value));
  const index = p.stages.findIndex((s) => s.value === p.value);
  const aria = p.name ? tm('change', { name: p.name }) : t('menu');

  const badge = p.value ? (
    <StageBadge stage={p.value} label={current?.label ?? p.value} color={current?.color} />
  ) : null;

  if (p.readOnly) {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-2', p.className)}>
        {p.look === 'field' ? <span className="truncate text-[13px] font-medium">{text}</span> : badge}
        {p.progress && index >= 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t('progress', { current: index + 1, total: p.stages.length })}
          </span>
        )}
      </span>
    );
  }

  return (
    <Trigger {...p} open={open} setOpen={setOpen} aria={aria} text={text} badge={badge} index={index} />
  );
}

function Trigger({
  open,
  setOpen,
  aria,
  text,
  badge,
  index,
  ...p
}: StagePickerProps & {
  open: boolean;
  setOpen: (v: boolean) => void;
  aria: string;
  text: string;
  badge: ReactNode;
  index: number;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.stagePicker');
  const button = useRef<HTMLButtonElement>(null);
  const field = p.look === 'field';
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', field && 'w-full', p.className)}>
      <button
        ref={button}
        id={p.id}
        autoFocus={p.autoFocus}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={aria}
        title={aria}
        disabled={p.busy}
        onClick={() => setOpen(!open)}
        className={cn(
          field
            ? 'inline-flex h-8 min-w-0 flex-1 items-center justify-between gap-1 rounded-md border border-border bg-background px-2.5 text-start text-[13px] font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60'
            : 'inline-flex max-w-full min-w-0 items-center rounded-full outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60',
        )}
      >
        {field ? (
          <>
            <span className="truncate">{text}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-0.5">
            {badge ?? <span className="truncate text-sm">{text}</span>}
            <ChevronDownIcon
              className={cn(
                'size-3 shrink-0 text-muted-foreground',
                p.quietCaret &&
                  'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
              )}
            />
          </span>
        )}
      </button>
      {p.progress && index >= 0 && p.stages.length > 1 && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {t('progress', { current: index + 1, total: p.stages.length })}
        </span>
      )}
      {open && (
        <Panel
          {...p}
          anchor={button}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) button.current?.focus();
          }}
        />
      )}
    </span>
  );
}

function Panel({
  anchor,
  onClose,
  ...p
}: StagePickerProps & {
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: (refocus: boolean) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.stagePicker');
  const uid = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const searchable = p.stages.length > SEARCH_FROM;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.stages.filter((s) => q === '' || s.label.toLowerCase().includes(q));
  }, [p.stages, query]);

  useLayoutEffect(() => {
    const narrow = window.innerWidth < SHEET_BELOW;
    setSheet(narrow);
    if (narrow || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 320;
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below;
    const rtl = getComputedStyle(anchor.current).direction === 'rtl';
    const left = rtl ? r.right - PANEL_W : r.left;
    setPos({ top, left: Math.min(Math.max(8, left), window.innerWidth - PANEL_W - 8) });
  }, [anchor, expanded]);

  const focusables = () => [
    ...(panel.current?.querySelectorAll<HTMLElement>('[data-stage-row]') ?? []),
  ];
  useEffect(() => {
    // The cursor goes to the search box when there is one, else to the current stage.
    const target = searchable
      ? panel.current?.querySelector<HTMLElement>('input[type="search"]')
      : (focusables().find((e) => e.getAttribute('aria-checked') === 'true') ?? focusables()[0]);
    target?.focus();
    const onPress = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!panel.current?.contains(el) && !anchor.current?.contains(el)) onClose(false);
    };
    const onScroll = (e: Event) => {
      // The list scrolls inside; the page scrolling away closes it.
      if (!panel.current?.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', onPress);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      window.removeEventListener('scroll', onScroll, true);
    };
    // Only once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (stage: string, status?: string | null) => {
    onClose(true);
    p.onPick(stage, status);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (e.key === 'Tab') {
      // Tab leaves the panel (it is not a trap: a popover, not a dialog).
      onClose(false);
      return;
    }
    const list = focusables();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(at + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (at <= 0 && searchable) {
        panel.current?.querySelector<HTMLElement>('input[type="search"]')?.focus();
      } else list[(at <= 0 ? list.length : at) - 1]?.focus();
    } else if (e.key === 'Home' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      list.at(-1)?.focus();
    }
  };

  const body = (
    <div
      ref={panel}
      role="dialog"
      aria-label={t('menu')}
      onKeyDown={onKey}
      style={sheet ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: PANEL_W }}
      className={cn(
        'z-[70] flex flex-col overflow-hidden border border-border bg-background text-foreground shadow-xl',
        sheet
          ? 'fixed inset-x-0 bottom-0 max-h-[75dvh] rounded-t-2xl'
          : 'fixed max-h-[min(22rem,calc(100dvh-1rem))] rounded-lg',
      )}
    >
      {sheet && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" />}
      <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t('menu')}
      </div>
      {searchable && (
        <div className="px-2 pb-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('search')}
            placeholder={t('search')}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      )}
      <ul className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-1" role="menu">
        {p.keepLabel && query === '' && (
          <Row
            id={`${uid}-keep`}
            checked={p.value === ''}
            label={p.keepLabel}
            onChoose={() => pick('')}
          />
        )}
        {rows.length === 0 && (
          <li className="px-3 py-3 text-center text-sm text-muted-foreground">{t('none')}</li>
        )}
        {rows.map((s) => {
          const statuses = p.statusesOf?.(s.value) ?? [];
          const isOpen = expanded === s.value;
          const hint = s.value === p.value ? null : (p.hint?.(s.value) ?? null);
          return (
            <li key={s.value} role="none">
              <Row
                id={`${uid}-${s.value}`}
                checked={s.value === p.value}
                label={s.label}
                color={optionColor({ value: s.value, color: s.color })}
                hint={hint}
                expandable={statuses.length > 0}
                expanded={isOpen}
                onChoose={() => {
                  if (statuses.length > 0) setExpanded(isOpen ? null : s.value);
                  else if (s.value !== p.value) pick(s.value);
                  else onClose(true);
                }}
              />
              {isOpen && (
                <div className="mx-2 mb-1 rounded-md bg-muted/50 px-2.5 py-2">
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    {t('statusIn', { stage: s.label })}
                  </p>
                  <div role="group" aria-label={t('statusIn', { stage: s.label })} className="flex flex-wrap gap-1.5">
                    {statuses.map((st) => {
                      const isDefault = p.defaultStatusOf?.(s.value) === st.value;
                      const held = s.value === p.value && p.status === st.value;
                      return (
                        <button
                          key={st.value}
                          type="button"
                          aria-pressed={held}
                          onClick={() => pick(s.value, st.value)}
                          className={cn(
                            'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                            held
                              ? 'border-primary bg-primary/10 font-medium text-primary'
                              : 'border-border bg-background hover:bg-muted',
                          )}
                        >
                          {st.label}
                          {isDefault && (
                            <span className="text-[10px] text-muted-foreground">{t('default')}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {s.value !== p.value && (
                    <Button
                      size="sm"
                      className="mt-2 h-7 w-full"
                      onClick={() => pick(s.value)}
                    >
                      {t('moveTo', { stage: s.label })}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return createPortal(
    sheet ? (
      <>
        <div aria-hidden="true" className="fixed inset-0 z-[69] bg-black/40" onClick={() => onClose(true)} />
        {body}
      </>
    ) : (
      body
    ),
    document.body,
  );
}

function Row({
  id,
  checked,
  label,
  color,
  hint,
  expandable,
  expanded,
  onChoose,
}: {
  id: string;
  checked: boolean;
  label: string;
  color?: string;
  hint?: string | null;
  expandable?: boolean;
  expanded?: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      id={id}
      data-stage-row=""
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-expanded={expandable ? expanded : undefined}
      onClick={onChoose}
      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm outline-none transition hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full border border-border"
        style={color ? { background: color, borderColor: color } : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      {checked && <CheckIcon className="size-3.5 shrink-0 text-primary" />}
      {expandable && (
        <ChevronDownIcon
          className={cn('size-3 shrink-0 text-muted-foreground transition', expanded && 'rotate-180')}
        />
      )}
    </button>
  );
}
