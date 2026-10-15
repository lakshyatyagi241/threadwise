'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { useFlb } from '../lib/msg';
import { attrEntries, filterAttrs } from './inspector/attr-picker';
import { EMOJIS, searchEmoji } from '../lib/emoji-data';
import {
  clip,
  insertText,
  toggleList,
  toggleMark,
  variableToken,
  type ListKind,
  type MarkKind,
  type TextEdit,
} from '../lib/message-tools';

type Panel = 'format' | 'emoji' | 'variable' | null;

const Glyph = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 16 16"
    className="size-[18px]"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const FORMAT_BUTTONS: ReadonlyArray<{
  id: MarkKind | ListKind;
  label: 'bold' | 'italic' | 'strike' | 'mono' | 'bullet' | 'numbered';
  face: string;
}> = [
  { id: 'bold', label: 'bold', face: 'B' },
  { id: 'italic', label: 'italic', face: 'I' },
  { id: 'strike', label: 'strike', face: 'S' },
  { id: 'mono', label: 'mono', face: '</>' },
  { id: 'bullet', label: 'bullet', face: '•≡' },
  { id: 'numbered', label: 'numbered', face: '1≡' },
];

/**
 * A text box with the message toolbar under it, as the console has it: formatting (bold, italic, strike, monospace, lists), an emoji
 * picker with search, and a menu that inserts a variable ({{name}}): the customer's and contact's properties, and what this flow has
 * saved so far. The edits are WhatsApp's own marks; `max` keeps the box inside the channel's limit.
 */
export function MessageField({
  value,
  onChange,
  rows = 4,
  max,
  placeholder,
  variables,
  invalid = false,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  max?: number;
  placeholder?: string;
  /** What the flow has saved so far (`{{name}}` reads them). */
  variables: readonly string[];
  invalid?: boolean;
  /** The accessible name of the box. */
  label: string;
}) {
  const t = useTranslations('flb.builder.messageTools');
  const tf = useFlb();
  const feed = usePickerFeed();
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const [panel, setPanel] = useState<Panel>(null);
  const [q, setQ] = useState('');
  /** Where the selection goes once the new text is in the box. */
  const pending = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const sel = pending.current;
    if (!sel || !ref.current) return;
    pending.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(sel.start, sel.end);
  }, [value]);

  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [panel]);

  const open = (p: Exclude<Panel, null>) => {
    setQ('');
    setPanel((cur) => (cur === p ? null : p));
  };
  const selection = () => {
    const el = ref.current;
    return { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  };
  const apply = (edit: TextEdit) => {
    const next = max === undefined ? edit : clip(edit, max);
    pending.current = { start: next.start, end: next.end };
    if (next.text === value) {
      // Nothing changed (the limit was reached): the selection still moves, and the effect above will not run.
      ref.current?.focus();
      pending.current = null;
      return;
    }
    onChange(next.text);
  };

  const format = (kind: MarkKind | ListKind) => {
    const { start, end } = selection();
    apply(
      kind === 'bullet' || kind === 'numbered'
        ? toggleList(value, start, end, kind)
        : toggleMark(value, start, end, kind),
    );
  };
  const put = (text: string) => {
    const { start, end } = selection();
    apply(insertText(value, start, end, text));
    setPanel(null);
  };

  const emojis = useMemo(() => (panel === 'emoji' ? searchEmoji(q) : EMOJIS), [panel, q]);
  const contactEntries = useMemo(
    () => filterAttrs(attrEntries(feed.data, tf), q),
    [feed.data, tf, q],
  );
  const flowNames = useMemo(
    () => variables.filter((v) => !q.trim() || v.toLowerCase().includes(q.trim().toLowerCase())),
    [variables, q],
  );

  const tool =
    'grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';
  const panelBox =
    'absolute start-0 top-full z-30 mt-1 w-[min(19rem,calc(100vw-3rem))] rounded-xl border border-border bg-background p-2 shadow-lg';

  return (
    <div ref={box} className="relative">
      <div
        className={cn(
          'rounded-lg border bg-background focus-within:ring-2 focus-within:ring-primary',
          invalid ? 'border-danger' : 'border-border',
        )}
      >
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          value={value}
          aria-label={label}
          placeholder={placeholder}
          onChange={(e) =>
            onChange(max === undefined ? e.target.value : e.target.value.slice(0, max))
          }
          className="block w-full resize-y rounded-t-lg bg-transparent px-3 pt-2.5 text-[13px] outline-none"
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1">
          <button
            type="button"
            className={cn(tool, panel === 'format' && 'bg-muted text-foreground')}
            aria-label={t('format')}
            title={t('format')}
            aria-expanded={panel === 'format'}
            onClick={() => open('format')}
          >
            <Glyph d="M3 13.5 8 2.5l5 11M5 10h6" />
          </button>
          <button
            type="button"
            className={cn(tool, panel === 'emoji' && 'bg-muted text-foreground')}
            aria-label={t('emoji')}
            title={t('emoji')}
            aria-expanded={panel === 'emoji'}
            onClick={() => open('emoji')}
          >
            <Glyph d="M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM5.5 9.5c.6 1 1.4 1.5 2.5 1.5s1.9-.5 2.5-1.5M6 6.5h.01M10 6.5h.01" />
          </button>
          <button
            type="button"
            className={cn(tool, panel === 'variable' && 'bg-muted text-foreground')}
            aria-label={t('variable')}
            title={t('variable')}
            aria-expanded={panel === 'variable'}
            onClick={() => open('variable')}
          >
            <Glyph d="M2 4h8M2 8h8M2 12h5M12 9v5M9.5 11.5h5" />
          </button>
          {max !== undefined ? (
            <span
              className={cn(
                'ms-auto pe-1.5 font-mono text-[10.5px]',
                value.length > max ? 'text-danger' : 'text-muted-foreground',
              )}
            >
              {value.length}/{max}
            </span>
          ) : null}
        </div>
      </div>

      {panel === 'format' ? (
        <div
          role="toolbar"
          aria-label={t('format')}
          className="absolute bottom-full start-1 z-30 mb-1 flex gap-0.5 rounded-xl border border-border bg-background p-1 shadow-lg"
        >
          {FORMAT_BUTTONS.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-label={t(b.label)}
              title={t(b.label)}
              onClick={() => format(b.id)}
              className={cn(
                'grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-[13px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
                b.id === 'bold' && 'font-bold',
                b.id === 'italic' && 'italic',
                b.id === 'strike' && 'line-through',
                b.id === 'mono' && 'font-mono text-[11px]',
              )}
            >
              {b.face}
            </button>
          ))}
        </div>
      ) : null}

      {panel === 'emoji' ? (
        <div className={panelBox}>
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('emojiSearch')}
            aria-label={t('emojiSearch')}
            className="mb-2 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {emojis.length === 0 ? (
            <p className="px-1 py-3 text-center text-[12px] text-muted-foreground">
              {t('emojiNone')}
            </p>
          ) : (
            <div className="grid max-h-52 grid-cols-7 gap-0.5 overflow-y-auto">
              {emojis.map((e) => (
                <button
                  key={e.emoji}
                  type="button"
                  title={e.words.split(' ')[0]}
                  aria-label={e.words.split(' ')[0]}
                  onClick={() => put(e.emoji)}
                  className="grid size-9 place-items-center rounded-md text-[20px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {e.emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {panel === 'variable' ? (
        <div className={panelBox}>
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('variableSearch')}
            aria-label={t('variableSearch')}
            className="mb-2 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="max-h-56 overflow-y-auto">
            {contactEntries.length > 0 ? (
              <div className="mb-1">
                <div className="px-1.5 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('groupContact')}
                </div>
                {contactEntries.map((a) => (
                  <button
                    key={`${a.kind}-${a.key}`}
                    type="button"
                    onClick={() => put(variableToken(a.key))}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="min-w-0 truncate">{a.name}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                      {variableToken(a.key)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {flowNames.length > 0 ? (
              <div>
                <div className="px-1.5 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('groupFlow')}
                </div>
                {flowNames.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => put(variableToken(v))}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="min-w-0 truncate">{v}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                      {variableToken(v)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {contactEntries.length === 0 && flowNames.length === 0 ? (
              <p className="px-1 py-3 text-center text-[12px] text-muted-foreground">
                {t('variableNone')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
