'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@crm/ui';
import type { AttributeCatalog, ComposeTemplate } from '@crm/contracts';
import {
  buildMeta,
  chipKeys,
  emptyState,
  hasFields,
  toOverrides,
  type ButtonMeta,
  type PanelMeta,
  type PanelState,
  type SectionMeta,
} from '../lib/overrides-model';
import { PlusIcon } from './icons';
import { UploadMediaButton } from './upload-media-button';

interface Attr {
  key: string;
  label: string;
  sample: string | null;
  group: string;
}

const flatten = (c: AttributeCatalog | undefined): Attr[] =>
  (c?.groups ?? []).flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));

const GROUP_LABEL: Record<string, string> = {
  contact: 'Contact',
  custom_field: 'Custom field',
  workspace: 'Workspace',
  system: 'System',
};

const insertAt = (input: HTMLInputElement | null, current: string, token: string): string => {
  const s = input?.selectionStart ?? current.length;
  const e = input?.selectionEnd ?? current.length;
  return current.slice(0, s) + token + current.slice(e);
};

/** The "+" beside a field: a searchable list of attributes that inserts `{{key}}` at the cursor. */
function InsertMenu({ attrs, onPick }: { attrs: Attr[]; onPick: (token: string) => void }) {
  const t = useTranslations('broadcasts.overrides');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (attrs.length === 0) return null;
  const shown = attrs.filter((a) =>
    `${a.label} ${a.key}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const groups = [...new Set(shown.map((a) => a.group))];
  return (
    <div ref={box} className="absolute end-1.5 top-1/2 -translate-y-1/2">
      <button
        type="button"
        title={t('insert')}
        aria-label={t('insert')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-muted-foreground hover:bg-muted"
      >
        <PlusIcon className="size-3.5" />
      </button>
      {open && (
        <div className="absolute end-0 z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg">
          <div className="sticky top-0 border-b border-border bg-background px-2.5 py-1.5">
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchAttributes')}
              aria-label={t('searchAttributes')}
              className="h-7 text-xs"
            />
          </div>
          {groups.map((g) => (
            <div key={g}>
              <div className="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {GROUP_LABEL[g] ?? g}
              </div>
              {shown
                .filter((a) => a.group === g)
                .map((a) => (
                  <button
                    key={`${g}-${a.key}`}
                    type="button"
                    onClick={() => {
                      onPick(`{{${a.key}}}`);
                      setOpen(false);
                      setQ('');
                    }}
                    className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-start hover:bg-muted"
                  >
                    <span className="flex-1 truncate text-xs">{a.label}</span>
                    <span className="max-w-[7rem] truncate font-mono text-[10px] text-muted-foreground">
                      {a.sample || a.key}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11.5px] font-semibold">{title}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/** One row per placeholder: its own name, what a blank field fills with, the input, and the one-click attribute chips. */
function SlotRows({
  section,
  values,
  onChange,
  attrs,
}: {
  section: SectionMeta;
  values: string[];
  onChange: (i: number, v: string) => void;
  attrs: Attr[];
}) {
  const t = useTranslations('broadcasts.overrides');
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const byKey = new Map(attrs.map((a) => [a.key, a]));
  const available = attrs.map((a) => a.key);
  return (
    <>
      {Array.from({ length: section.slots }, (_, i) => {
        const tok = section.tokens[i];
        const match = tok ? byKey.get(tok.key) : undefined;
        const fallback = section.defaults[i];
        return (
          <div key={i} className="rounded-lg border border-border bg-background p-2.5">
            <div className="mb-1 flex min-w-0 items-baseline gap-2">
              <span className="truncate text-xs font-semibold">
                {tok?.name ?? t('variable', { n: i + 1 })}
              </span>
              {tok && (
                <code className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">{`{{${tok.name}}}`}</code>
              )}
            </div>
            <div className="mb-1.5 break-words text-[10.5px] text-muted-foreground">
              {match ? (
                <>
                  {t('autoFrom')} <span className="font-medium text-foreground">{match.label}</span>
                  {match.sample ? (
                    <>
                      {' '}
                      — <span className="font-mono">{match.sample}</span>
                    </>
                  ) : null}
                </>
              ) : fallback ? (
                <>
                  {t('autoFrom')} <span className="font-mono">{fallback}</span>
                </>
              ) : (
                <span className="text-danger">{t('noMatch')}</span>
              )}
            </div>
            <div className="relative">
              <Input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                autoComplete="off"
                value={values[i] ?? ''}
                onChange={(e) => onChange(i, e.target.value)}
                placeholder={t('placeholder')}
                aria-label={tok?.name ?? t('variable', { n: i + 1 })}
                className="h-8 pe-8 text-[12.5px]"
              />
              <InsertMenu
                attrs={attrs}
                onPick={(token) =>
                  onChange(i, insertAt(refs.current[i] ?? null, values[i] ?? '', token))
                }
              />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {chipKeys(available, tok?.key ?? null).map((k) => {
                const a = byKey.get(k)!;
                return (
                  <button
                    key={k}
                    type="button"
                    title={a.sample || a.key}
                    onClick={() =>
                      onChange(
                        i,
                        insertAt(refs.current[i] ?? null, values[i] ?? '', `{{${a.key}}}`),
                      )
                    }
                    className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10.5px] hover:bg-muted"
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ButtonRow({
  b,
  value,
  onChange,
  attrs,
}: {
  b: ButtonMeta;
  value: string;
  onChange: (v: string) => void;
  attrs: Attr[];
}) {
  const t = useTranslations('broadcasts.overrides');
  const ref = useRef<HTMLInputElement | null>(null);
  const kind = b.kind === 'url' ? t('link') : b.kind === 'copy_code' ? t('code') : t('value');
  return (
    <div>
      <label className="mb-1 block text-[11px] text-muted-foreground">
        {b.label} <span className="opacity-70">· {kind}</span>
      </label>
      <div className="relative">
        <Input
          ref={ref}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={b.value || t('keepTemplate')}
          aria-label={b.label}
          className="h-8 pe-8 text-[12.5px]"
        />
        <InsertMenu
          attrs={attrs}
          onPick={(token) => onChange(insertAt(ref.current, value, token))}
        />
      </div>
    </div>
  );
}

/**
 * The send-time mapping panel (WD-BCAST-005): change a template's variables, header media link and button links for this one
 * send, without touching the template. A blank field keeps what the template does. Reports the `templateOverrides` body (or
 * null) on every change; a different template starts empty, because slot 1 of one template is not slot 1 of another.
 */
export function OverridesPanel({
  template,
  catalog,
  onChange,
}: {
  template: ComposeTemplate;
  catalog: AttributeCatalog | undefined;
  onChange: (overrides: Record<string, unknown> | null) => void;
}) {
  const t = useTranslations('broadcasts.overrides');
  const meta: PanelMeta = useMemo(() => buildMeta(template), [template]);
  const attrs = useMemo(() => flatten(catalog), [catalog]);
  const [state, setState] = useState<PanelState>(() => emptyState(meta));

  const update = (next: PanelState) => {
    setState(next);
    onChange(toOverrides(next, meta));
  };

  const notice = (msg: string) => (
    <div className="rounded-lg border border-warning/40 bg-warning/15 px-3 py-2 text-xs">{msg}</div>
  );
  if (!meta.editable) return <div className="mt-3">{notice(t('lockedAuth'))}</div>;
  if (!hasFields(meta)) return <div className="mt-3">{notice(t('nothing'))}</div>;

  const kind = meta.headerFormat.toLowerCase();
  const setSlot = (key: 'body' | 'footer') => (i: number, v: string) => {
    const list = [...state[key]];
    list[i] = v;
    update({ ...state, [key]: list });
  };

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3.5 py-2.5">
        <span className="flex-1 text-[15px] leading-none">{t('title')}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{t('scope')}</span>
      </div>
      <div className="space-y-4 p-3.5">
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">{t('intro')}</p>
        {meta.lockedReason === 'twilio' && notice(t('lockedTwilio'))}

        {meta.header.slots > 0 && (
          <Section title={t('header')}>
            <SlotRows
              section={meta.header}
              values={[state.header]}
              onChange={(_, v) => update({ ...state, header: v })}
              attrs={attrs}
            />
          </Section>
        )}
        {meta.mediaEditable && (
          <Section title={t('headerMedia')}>
            <div className="space-y-2">
              {kind === 'image' && (state.mediaUrl || meta.headerMediaUrl) ? (
                // The preview shows what will be sent: the pasted link, else the template's own file.
                <img
                  src={state.mediaUrl || meta.headerMediaUrl}
                  alt=""
                  className="max-h-32 rounded-lg border border-border"
                />
              ) : (
                <div className="break-all font-mono text-[11.5px] text-muted-foreground">
                  {state.mediaUrl || meta.headerMediaUrl || t('templateDefault')}
                </div>
              )}
              <div className="text-[10.5px] text-muted-foreground">
                {t(`limit.${kind === 'video' ? 'video' : kind === 'image' ? 'image' : 'document'}`)}
              </div>
              <Input
                type="url"
                autoComplete="off"
                value={state.mediaUrl}
                onChange={(e) => update({ ...state, mediaUrl: e.target.value })}
                placeholder="https://…"
                aria-label={t('pasteLink')}
                className="h-8 text-[12.5px]"
              />
              <div className="text-[10.5px] text-muted-foreground">{t('pasteLinkHint')}</div>
              <UploadMediaButton
                accept={
                  kind === 'video'
                    ? 'video/*'
                    : kind === 'image'
                      ? 'image/*'
                      : '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'
                }
                onUploaded={(m) => update({ ...state, mediaUrl: m.url })}
              />
            </div>
          </Section>
        )}
        {meta.body.slots > 0 && (
          <Section title={t('message')}>
            <SlotRows
              section={meta.body}
              values={state.body}
              onChange={setSlot('body')}
              attrs={attrs}
            />
          </Section>
        )}
        {meta.footer.slots > 0 && (
          <Section title={t('footer')}>
            <SlotRows
              section={meta.footer}
              values={state.footer}
              onChange={setSlot('footer')}
              attrs={attrs}
            />
          </Section>
        )}
        {meta.buttonsEditable && meta.buttons.some((b) => b.editable) && (
          <Section title={t('buttons')}>
            {meta.buttons
              .filter((b) => b.editable)
              .map((b) => (
                <ButtonRow
                  key={b.index}
                  b={b}
                  value={state.buttons[b.index] ?? ''}
                  onChange={(v) =>
                    update({ ...state, buttons: { ...state.buttons, [b.index]: v } })
                  }
                  attrs={attrs}
                />
              ))}
          </Section>
        )}
      </div>
    </div>
  );
}
