'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Textarea, cn } from '@crm/ui';
import Link from 'next/link';
import { pickerEntries, usePickerFeed } from '../api/attributes';
import {
  filterPicker,
  findSlashQuery,
  insertToken,
  type PickerEntry,
} from '../lib/attribute-model';

/**
 * A textarea that opens an "Insert attribute" list when "/" starts a word (TW-CON-046). Arrow keys move, Enter or Tab
 * insert the `{{key}}` token, Escape closes. Other domains' composers (templates, broadcasts, flows) use this same
 * component, so the feed (system tokens plus the active custom attributes) has one source.
 *
 * Unlike Reference's popover it opens under the field, not at the caret; that keeps it reachable by keyboard and screen
 * reader on every viewport without measuring text.
 */
export function SlashTextarea({
  value,
  onChange,
  label,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder?: string;
  rows?: number;
}) {
  const t = useTranslations('contacts-attributes-tags.attributes');
  const picker = usePickerFeed();
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const feed = useMemo(
    () => pickerEntries(picker.data, (key) => (t.has(`system.${key}`) ? t(`system.${key}`) : '')),
    [picker.data, t],
  );
  const slash = findSlashQuery(value, caret);
  const open = slash !== null && dismissedAt !== slash.start;
  const matches = useMemo(() => (slash ? filterPicker(feed, slash.query) : []), [feed, slash]);
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  function pick(entry: PickerEntry) {
    if (!slash) return;
    const next = insertToken(value, caret, slash.start, entry.key);
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissedAt(slash!.start);
    } else if (matches.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + matches.length) % matches.length);
    } else if (matches.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      pick(matches[current]!);
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={rows}
        value={value}
        aria-label={label}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && matches.length > 0 ? `${listId}-${current}` : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setDismissedAt(slash?.start ?? null)}
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>{t('picker.title')}</span>
            <span dir="ltr" className="font-mono normal-case">
              /{slash!.query}
            </span>
          </div>
          {matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {t('picker.none')}{' '}
              <Link href="/attributes" className="font-medium text-primary underline">
                {t('picker.create')}
              </Link>
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('picker.title')}
              className="max-h-56 overflow-y-auto py-1"
            >
              {matches.map((m, i) => (
                <li
                  key={`${m.kind}-${m.key}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  // mouse-down, not click: the textarea would lose focus (and close the list) before a click lands
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(m);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                    i === current && 'bg-muted',
                  )}
                >
                  <Badge
                    tone={m.kind === 'system' ? 'neutral' : 'success'}
                    className="w-5 justify-center px-0"
                  >
                    {m.kind === 'system' ? 'S' : 'C'}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span
                    dir="ltr"
                    className="shrink-0 truncate font-mono text-xs text-muted-foreground"
                  >
                    {m.key}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
