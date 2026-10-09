'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import {
  apiLibraryTokensOf,
  type ApiLibraryContactProperty,
  type ApiLibraryOption,
} from '@crm/contracts';
import { Button, Input, Popover, Textarea, cn } from '@crm/ui';
import { insertAt, removeTokenBefore, tokenText } from '../lib/paths';

/** Where a `{{variable}}` can come from, as the old chip menu offered it: contact properties, other saved APIs, or a flow variable. */
export interface VariableSources {
  contacts: ApiLibraryContactProperty[];
  apis: ApiLibraryOption[];
  /** The API being edited: it cannot read its own answer. */
  selfName: string;
}
export const VariableSourcesContext = createContext<VariableSources>({
  contacts: [],
  apis: [],
  selfName: '',
});

interface Props {
  value: string;
  onChange: (next: string) => void;
  label: string;
  multiline?: boolean;
  rows?: number;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Monospaced text (a payload). */
  mono?: boolean;
  /** Show the tokens used as chips under the field. */
  chips?: boolean;
}

/**
 * A text field with an "insert variable" menu. A variable goes in as `{{name}}`; Backspace right after one removes it whole. The
 * form declares every token it finds (with a default value to fill in), so there is nothing to register by hand.
 */
export function VariableField({
  value,
  onChange,
  label,
  multiline,
  rows = 3,
  id,
  placeholder,
  invalid,
  disabled,
  mono,
  chips = true,
}: Props) {
  const t = useTranslations('api-library.variables');
  const sources = useContext(VariableSourcesContext);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const caret = useRef<[number, number] | null>(null);

  function remember() {
    const el = ref.current;
    if (el) caret.current = [el.selectionStart ?? value.length, el.selectionEnd ?? value.length];
  }

  function insert(name: string) {
    const [s, e] = caret.current ?? [value.length, value.length];
    const r = insertAt(value, s, e, tokenText(name));
    onChange(r.text);
    setOpen(false);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Backspace' || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = ref.current;
    if (!el || el.selectionStart !== el.selectionEnd) return;
    const r = removeTokenBefore(value, el.selectionStart ?? 0);
    if (!r) return;
    e.preventDefault();
    onChange(r.text);
    requestAnimationFrame(() => ref.current?.setSelectionRange(r.caret, r.caret));
  }

  const common = {
    id,
    ref,
    value,
    placeholder,
    disabled,
    invalid,
    'aria-label': id ? undefined : label,
    onKeyDown,
    onKeyUp: remember,
    onClick: remember,
    onSelect: remember,
    onBlur: remember,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  const used = chips ? apiLibraryTokensOf(value) : [];

  return (
    <div className="space-y-1.5">
      <div className="relative">
        {multiline ? (
          <Textarea
            {...common}
            rows={rows}
            dir="ltr"
            spellCheck={false}
            className={cn('pe-10', mono && 'font-mono text-xs')}
          />
        ) : (
          <Input {...common} dir="ltr" spellCheck={false} className="pe-10" />
        )}
        <button
          type="button"
          disabled={disabled}
          onMouseDown={remember}
          onClick={() => setOpen((o) => !o)}
          aria-label={t('insertFor', { label })}
          aria-haspopup="true"
          aria-expanded={open}
          title={t('insert')}
          className="absolute end-1 top-1 flex size-8 items-center justify-center rounded-md font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {'{ }'}
        </button>
        <VariableMenu
          open={open}
          onClose={() => setOpen(false)}
          onPick={insert}
          sources={sources}
        />
      </div>
      {used.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t('used')}>
          {used.map((name) => (
            <li
              key={name}
              className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary"
              dir="ltr"
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VariableMenu({
  open,
  onClose,
  onPick,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (name: string) => void;
  sources: VariableSources;
}) {
  const t = useTranslations('api-library.variables');
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState('');
  const inputId = useId();
  const needle = q.trim().toLowerCase();
  const match = (s: string) => needle === '' || s.toLowerCase().includes(needle);

  const contacts = sources.contacts.filter((c) => match(c.label) || match(c.key));
  const apis = sources.apis
    .filter((a) => a.name.toLowerCase() !== sources.selfName.toLowerCase())
    .flatMap((a) =>
      a.responseVariables.map((p) => ({ name: `${a.name}.${p}`, api: a.name, path: p })),
    )
    .filter((x) => match(x.name));
  const customName = custom.trim();
  const customOk = customName !== '' && !/[{}]/.test(customName);

  return (
    <Popover open={open} onClose={onClose} label={t('menu')} className="w-80 max-w-[85vw]">
      <div className="space-y-2">
        <Input
          type="search"
          value={q}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-64 space-y-3 overflow-y-auto">
          <Group title={t('contactGroup')} empty={t('noContactMatch')} show={contacts.length > 0}>
            {contacts.map((c) => (
              <Item key={c.key} onClick={() => onPick(c.key)} primary={c.label} secondary={c.key} />
            ))}
          </Group>
          <Group title={t('apiGroup')} empty={t('noApiMatch')} show={apis.length > 0}>
            {apis.map((x) => (
              <Item
                key={x.name}
                onClick={() => onPick(x.name)}
                primary={x.name}
                secondary={t('fromApi')}
              />
            ))}
          </Group>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">{t('flowGroup')}</p>
            <div className="flex gap-1">
              <Input
                id={inputId}
                value={custom}
                placeholder={t('flowPlaceholder')}
                aria-label={t('flowPlaceholder')}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customOk) {
                    e.preventDefault();
                    onPick(customName);
                    setCustom('');
                  }
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!customOk}
                onClick={() => {
                  onPick(customName);
                  setCustom('');
                }}
              >
                {t('add')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Popover>
  );
}

function Group({
  title,
  empty,
  show,
  children,
}: {
  title: string;
  empty: string;
  show: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      {show ? (
        <ul className="space-y-0.5">{children}</ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function Item({
  onClick,
  primary,
  secondary,
}: {
  onClick: () => void;
  primary: string;
  secondary: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      >
        <span className="truncate">{primary}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
          {secondary}
        </span>
      </button>
    </li>
  );
}
