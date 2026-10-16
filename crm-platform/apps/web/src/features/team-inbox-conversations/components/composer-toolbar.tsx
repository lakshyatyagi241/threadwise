'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Spinner, cn } from '@crm/ui';
import type { InboxRewriteAction } from '@crm/contracts';
import { inboxApi } from '../api/service';
import {
  activeFormats,
  toggleList,
  toggleMark,
  toggleUnderline,
  type ActiveFormats,
  type Edit,
  type Mark,
} from '../lib/format-text';
import { languageChoices } from '../lib/languages';

const ICON = 'size-4';
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const Bold = () => (
  <svg viewBox="0 0 24 24" className={ICON} {...stroke}>
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  </svg>
);
const Italic = () => (
  <svg viewBox="0 0 24 24" className={ICON} {...stroke}>
    <path d="M14 5h-4M14 19h-4M15 5l-6 14" />
  </svg>
);
const Underline = () => (
  <svg viewBox="0 0 24 24" className={ICON} {...stroke}>
    <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />
  </svg>
);
const Strike = () => (
  <svg viewBox="0 0 24 24" className={ICON} {...stroke}>
    <path d="M4 12h16M8 7a4 4 0 0 1 4-2c2.5 0 4 1.3 4 3M16 16c0 2-1.8 3-4 3a4.5 4.5 0 0 1-4-2" />
  </svg>
);
const Bullets = () => (
  <svg viewBox="0 0 24 24" className={ICON} {...stroke}>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </svg>
);
const Numbers = () => (
  <svg viewBox="0 0 24 24" className={ICON} {...stroke}>
    <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 14h3l-3 3h3" />
  </svg>
);
const Sparkle = () => (
  <svg viewBox="0 0 24 24" className={ICON} {...stroke}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);
const Condense = () => (
  <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
    <path d="M5 9h14M5 15h14M12 3v4M12 21v-4M9.5 5.5 12 7l2.5-1.5M9.5 18.5 12 17l2.5 1.5" />
  </svg>
);
const Grammar = () => (
  <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
    <path d="M3 18 8 6l5 12M5 14h6M15 14l2.5 3L22 10" />
  </svg>
);
const Smile = () => (
  <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </svg>
);
const Translate = () => (
  <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
    <path d="M4 5h8M8 3v2M5.5 5c.5 3 3 6 6 7M11 5c-.5 3-3 6-6.5 8M13 20l4-9 4 9M14.5 17h5" />
  </svg>
);

/** The model the Smart AI Assistant asks: the first one of a vendor the rewrite route can call (null: none is enabled). */
export interface AiModelChoice {
  provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter';
  value: string;
}

export interface ComposerToolbarProps {
  /** The attach, saved-reply and emoji buttons, drawn after the lists. */
  extras?: ReactNode;
  /** Null while there is none: the assistant button then stays off and says why. */
  model: AiModelChoice | null;
  area: RefObject<HTMLTextAreaElement | null>;
  text: string;
  max: number;
  disabled: boolean;
  /** Writes the new text into the box (and its draft). */
  onText: (value: string) => void;
}

/**
 * The formatting row above a chat message: bold, italic, strike, bullet and numbered lists (WhatsApp's own marks, written into the
 * text), and the Smart AI Assistant (condense, fix grammar, positive tone, translate). The assistant rewrites what is selected, or the
 * whole message when nothing is, and puts the result back in the box for the agent to read, edit and send: nothing is sent by it.
 */
export function ComposerToolbar({
  extras,
  model,
  area,
  text,
  max,
  disabled,
  onText,
}: ComposerToolbarProps) {
  const t = useTranslations('team-inbox-conversations.composer.toolbar');
  const locale = useLocale();
  const [menu, setMenu] = useState(false);
  const [langs, setLangs] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<ActiveFormats>(() => activeFormats('', 0, 0));

  // The buttons show pressed while the caret (or the selection) is inside that formatting, and follow it as it moves.
  useEffect(() => {
    const read = () => {
      const el = area.current;
      if (!el) return;
      setActive(activeFormats(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0));
    };
    read();
    const onSel = () => {
      if (document.activeElement === area.current) read();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [area, text]);

  useEffect(() => {
    if (!menu) return;
    const onPress = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setMenu(false);
        setLangs(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(false);
        setLangs(false);
      }
    };
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const choices = useMemo(() => languageChoices(locale, query), [locale, query]);

  function apply(edit: Edit) {
    if (edit.text.length > max) return;
    onText(edit.text);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(edit.start, edit.end);
    });
  }
  const sel = () => ({
    start: area.current?.selectionStart ?? text.length,
    end: area.current?.selectionEnd ?? text.length,
  });
  const mark = (m: Mark) => {
    const { start, end } = sel();
    apply(toggleMark(text, start, end, m));
  };
  const list = (kind: 'bullet' | 'number') => {
    const { start, end } = sel();
    apply(toggleList(text, start, end, kind));
  };

  async function run(action: InboxRewriteAction, language?: string) {
    if (!model || busy) return;
    const { start, end } = sel();
    const part = start !== end;
    const source = (part ? text.slice(start, end) : text).trim();
    setMenu(false);
    setLangs(false);
    if (source === '') {
      setError(t('ai.empty'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const out = await inboxApi.rewrite({
        provider: model.provider,
        model: model.value,
        action,
        text: source,
        ...(language ? { language } : {}),
      });
      const next = part ? text.slice(0, start) + out.text + text.slice(end) : out.text;
      apply({
        text: next.slice(0, max),
        start: part ? start : 0,
        end: part ? start + out.text.length : Math.min(out.text.length, max),
      });
    } catch {
      setError(t('ai.failed'));
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40';
  const fmt = (label: string, icon: ReactNode, onClick: () => void, id: string, on = false) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={`composer-${id}`}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(btn, on && 'bg-primary/10 text-primary')}
    >
      {icon}
    </button>
  );
  const item = (
    id: InboxRewriteAction,
    icon: ReactNode,
    title: string,
    hint: string,
    onClick: () => void,
  ) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      data-testid={`composer-ai-${id}`}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-start hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
        id === 'translate' && langs && 'bg-muted',
      )}
    >
      <span className="mt-0.5 shrink-0 text-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );

  return (
    <div className="px-3 pb-2" data-testid="composer-toolbar">
      <div
        className="relative flex items-center gap-0.5"
        ref={wrap}
        role="toolbar"
        aria-label={t('label')}
      >
        <>
          {fmt(t('bold'), <Bold />, () => mark('*'), 'bold', active.bold)}
          {fmt(t('italic'), <Italic />, () => mark('_'), 'italic', active.italic)}
          {fmt(
            t('underline'),
            <Underline />,
            () => {
              const { start, end } = sel();
              apply(toggleUnderline(text, start, end));
            },
            'underline',
            active.underline,
          )}
          {fmt(t('strike'), <Strike />, () => mark('~'), 'strike', active.strike)}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {fmt(t('bullets'), <Bullets />, () => list('bullet'), 'bullets', active.bullets)}
          {fmt(t('numbers'), <Numbers />, () => list('number'), 'numbers', active.numbers)}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        </>
        {extras}
        <>
          <button
            type="button"
            title={model ? t('ai.open') : t('ai.noModel')}
            aria-label={t('ai.open')}
            aria-haspopup="menu"
            aria-expanded={menu}
            data-testid="composer-ai"
            disabled={disabled || !model || busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setMenu((v) => !v);
              setLangs(false);
            }}
            className={cn(btn, menu && 'bg-muted text-foreground')}
          >
            {busy ? <Spinner /> : <Sparkle />}
          </button>
          {busy && (
            <span role="status" className="ps-1 text-xs text-muted-foreground">
              {t('ai.working')}
            </span>
          )}
          {menu && (
            <div className="absolute bottom-full start-0 z-30 mb-2 flex items-end gap-2">
              <div
                role="menu"
                aria-label={t('ai.title')}
                className="w-72 rounded-xl border border-border bg-background shadow-lg"
              >
                <p className="border-b border-border px-4 py-3 text-sm font-semibold">
                  {t('ai.title')}
                </p>
                <div className="p-1">
                  {item(
                    'condense',
                    <Condense />,
                    t('ai.condense'),
                    t('ai.condenseHint'),
                    () => void run('condense'),
                  )}
                  {item('fix', <Grammar />, t('ai.fix'), t('ai.fixHint'), () => void run('fix'))}
                  {item(
                    'positive',
                    <Smile />,
                    t('ai.positive'),
                    t('ai.positiveHint'),
                    () => void run('positive'),
                  )}
                  {item('translate', <Translate />, t('ai.translate'), t('ai.translateHint'), () =>
                    setLangs((v) => !v),
                  )}
                </div>
              </div>
              {langs && (
                <div
                  className="flex max-h-80 w-64 flex-col rounded-xl border border-border bg-background shadow-lg"
                  data-testid="composer-ai-languages"
                >
                  <p className="px-4 pt-3 text-sm font-semibold">{t('ai.selectLanguage')}</p>
                  <div className="px-3 py-2">
                    <input
                      type="search"
                      value={query}
                      autoFocus
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label={t('ai.searchLanguages')}
                      placeholder={t('ai.searchLanguages')}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                  </div>
                  <ul
                    role="listbox"
                    aria-label={t('ai.selectLanguage')}
                    className="thin-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-border"
                  >
                    {choices.map((l) => (
                      <li key={l.code} role="option" aria-selected="false">
                        <button
                          type="button"
                          data-testid={`composer-lang-${l.code}`}
                          onClick={() => void run('translate', l.english)}
                          className="w-full px-4 py-2 text-start text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {l.label}
                        </button>
                      </li>
                    ))}
                    {choices.length === 0 && (
                      <li className="px-4 py-3 text-xs text-muted-foreground">
                        {t('ai.noLanguage')}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      </div>
      {error && (
        <p role="alert" className="pt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
