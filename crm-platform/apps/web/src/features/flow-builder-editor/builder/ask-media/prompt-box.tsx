'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { attrEntries, filterAttrs } from '../inspector/attr-picker';
import { TextArea } from '../inspector/kit';

/** WhatsApp's own text markers: the "text format" tool wraps the selection in one of them. */
export const FORMAT_MARKS = [
  { id: 'bold', open: '*', close: '*', glyph: 'B' },
  { id: 'italic', open: '_', close: '_', glyph: 'I' },
  { id: 'strike', open: '~', close: '~', glyph: 'S' },
  { id: 'mono', open: '```', close: '```', glyph: '</>' },
] as const;

export const EMOJIS = [
  '😀',
  '😊',
  '😍',
  '👍',
  '🙏',
  '🎉',
  '✅',
  '📎',
  '📷',
  '📄',
  '📍',
  '📞',
  '👋',
  '❤️',
  '🔥',
  '⭐',
  '💬',
  '🕐',
  '📝',
  '🚀',
  '👇',
  '👉',
  '✨',
  '🤝',
];

/** Wraps `[start, end)` of `text` in the markers; with nothing selected the markers go around the caret. Pure. */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string,
): { text: string; start: number; end: number } {
  const before = text.slice(0, start);
  const mid = text.slice(start, end);
  const after = text.slice(end);
  return {
    text: `${before}${open}${mid}${close}${after}`,
    start: start + open.length,
    end: start + open.length + mid.length,
  };
}

/** Puts `insert` at the caret (replacing a selection). Pure. */
export function insertAt(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; start: number; end: number } {
  const caret = start + insert.length;
  return { text: `${text.slice(0, start)}${insert}${text.slice(end)}`, start: caret, end: caret };
}

const iconBtn =
  'grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

type Tool = 'format' | 'emoji' | 'variable' | null;

/**
 * The prompt box of the Ask for file / image card: the same text area every prompt field uses (type "/" to insert a variable),
 * with a small toolbar under it: text format (WhatsApp bold, italic, strike, monospace), emoji and insert variable.
 */
export function PromptBox({
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const t = useTranslations('flb.builder.askMedia.toolbar');
  const box = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [query, setQuery] = useState('');
  const text = value === null || value === undefined ? '' : String(value);
  const feed = usePickerFeed();
  const entries = useMemo(() => attrEntries(feed.data), [feed.data]);
  const matches = useMemo(() => filterAttrs(entries, query).slice(0, 40), [entries, query]);

  const area = () => box.current?.querySelector('textarea') ?? null;
  const apply = (fn: (s: number, e: number) => { text: string; start: number; end: number }) => {
    const el = area();
    const s = el?.selectionStart ?? text.length;
    const e = el?.selectionEnd ?? text.length;
    const next = fn(Math.min(s, text.length), Math.min(e, text.length));
    onChange(next.text);
    setTool(null);
    requestAnimationFrame(() => {
      const a = area();
      if (!a) return;
      a.focus();
      a.setSelectionRange(next.start, next.end);
    });
  };

  const toggle = (next: Exclude<Tool, null>) => {
    setTool((cur) => (cur === next ? null : next));
    setQuery('');
  };

  const pop = (children: ReactNode) => (
    <div
      className="absolute bottom-full left-0 z-30 mb-1 rounded-lg border border-border bg-background p-1.5 shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );

  return (
    <div ref={box} className="relative" data-testid="ask-prompt-box">
      <TextArea value={text} placeholder={placeholder} rows={rows} compact onChange={onChange} />
      <div
        role="toolbar"
        aria-label={t('label')}
        className="mt-1 flex items-center gap-0.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-tool="format"
          aria-label={t('format')}
          title={t('format')}
          aria-expanded={tool === 'format'}
          onClick={() => toggle('format')}
          className={iconBtn}
        >
          <span className="text-[12px] font-bold leading-none">Aa</span>
        </button>
        <button
          type="button"
          data-tool="emoji"
          aria-label={t('emoji')}
          title={t('emoji')}
          aria-expanded={tool === 'emoji'}
          onClick={() => toggle('emoji')}
          className={iconBtn}
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <circle cx="8" cy="8" r="6" />
            <path
              d="M5.8 9.5c.5.8 1.3 1.2 2.2 1.2s1.7-.4 2.2-1.2M6 6.5h.01M10 6.5h.01"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          data-tool="variable"
          aria-label={t('variable')}
          title={t('variable')}
          aria-expanded={tool === 'variable'}
          onClick={() => toggle('variable')}
          className={iconBtn}
        >
          <span className="font-mono text-[11px] font-bold leading-none">{'{}'}</span>
        </button>
      </div>
      {tool === 'format'
        ? pop(
            <div className="flex gap-1" data-testid="ask-format-menu">
              {FORMAT_MARKS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-format={m.id}
                  aria-label={t(m.id)}
                  title={t(m.id)}
                  onClick={() => apply((s, e) => wrapSelection(text, s, e, m.open, m.close))}
                  className="grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-[12px] font-semibold hover:bg-muted"
                >
                  {m.glyph}
                </button>
              ))}
            </div>,
          )
        : null}
      {tool === 'emoji'
        ? pop(
            <div className="grid w-[200px] grid-cols-8 gap-0.5" data-testid="ask-emoji-menu">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => apply((s, e) => insertAt(text, s, e, em))}
                  className="grid h-6 w-6 place-items-center rounded text-[14px] hover:bg-muted"
                >
                  {em}
                </button>
              ))}
            </div>,
          )
        : null}
      {tool === 'variable'
        ? pop(
            <div className="w-[240px]" data-testid="ask-variable-menu">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('variableSearch')}
                aria-label={t('variableSearch')}
                className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[11.5px] outline-none focus:border-brand"
              />
              <div className="max-h-[150px] overflow-y-auto">
                {matches.map((m) => (
                  <button
                    key={`${m.kind}:${m.key}`}
                    type="button"
                    data-variable={m.key}
                    onClick={() => apply((s, e) => insertAt(text, s, e, `{{${m.key}}}`))}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11.5px] hover:bg-muted"
                  >
                    <span className="truncate">{m.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {m.key}
                    </span>
                  </button>
                ))}
                {matches.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">
                    {t('variableEmpty')}
                  </div>
                ) : null}
              </div>
            </div>,
          )
        : null}
    </div>
  );
}
