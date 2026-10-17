'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  FLB_ASK_FILE_GROUPS,
  flbCleanAskFileExtensions,
  type FlbAskFileGroup,
} from '@crm/contracts';
import { Icon } from '../node-card';
import { lookOf } from '../../lib/node-ui';

/**
 * The Allow Extensions checklist of the Ask for file / image node: one header per group (Images, Audio, Video, Documents) with a
 * "Select All" box, then one box per extension. Shared by the panel on the canvas card and the inspector form. Controlled: the
 * parent owns the list of selected extensions.
 */
export function ExtensionChecklist({
  value,
  onChange,
  idPrefix,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}) {
  const t = useTranslations('flb.builder.askMedia.extensions');
  const selected = useMemo(() => new Set(value), [value]);
  const toggle = (exts: readonly string[], on: boolean) => {
    const next = new Set(selected);
    for (const e of exts) {
      if (on) next.add(e);
      else next.delete(e);
    }
    onChange(flbCleanAskFileExtensions([...next]));
  };
  return (
    <div className="space-y-3" data-testid="ask-extension-checklist">
      {FLB_ASK_FILE_GROUPS.map((g: FlbAskFileGroup) => {
        const exts = g.extensions.map((e) => e.ext);
        const all = exts.every((e) => selected.has(e));
        return (
          <fieldset key={g.id} data-ext-group={g.id}>
            <legend className="sr-only">{t(`group.${g.id}`)}</legend>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t(`group.${g.id}`)}
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--flb-ink-700)]">
                <input
                  type="checkbox"
                  data-select-all={g.id}
                  checked={all}
                  onChange={(e) => toggle(exts, e.target.checked)}
                  className="rounded border-border text-brand focus:ring-brand/30"
                />
                {t('selectAll')}
              </label>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1">
              {exts.map((e) => (
                <label
                  key={e}
                  htmlFor={`${idPrefix}-${e}`}
                  className="flex cursor-pointer items-center gap-1.5 text-[11.5px]"
                >
                  <input
                    id={`${idPrefix}-${e}`}
                    type="checkbox"
                    data-ext={e}
                    checked={selected.has(e)}
                    onChange={(ev) => toggle([e], ev.target.checked)}
                    className="rounded border-border text-brand focus:ring-brand/30"
                  />
                  <span className="font-mono">{e}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** True when the draft differs from what was saved (Save stays disabled until something changes). */
export function extensionsChanged(saved: readonly string[], draft: readonly string[]): boolean {
  const a = flbCleanAskFileExtensions([...saved]);
  const b = flbCleanAskFileExtensions([...draft]);
  return a.length !== b.length || a.some((e, i) => e !== b[i]);
}

/**
 * The "Img/File" panel the pencil on the card opens: the checklist with Cancel and Save. Save is disabled until the selection
 * changes; Cancel, Escape and a click outside drop the draft. The panel works on a copy, so nothing is saved until Save.
 */
export function ExtensionsPanel({
  saved,
  onSave,
  onClose,
  idPrefix,
}: {
  saved: readonly string[];
  onSave: (next: string[]) => void;
  onClose: () => void;
  idPrefix: string;
}) {
  const t = useTranslations('flb.builder.askMedia.extensions');
  const [draft, setDraft] = useState<string[]>(() => flbCleanAskFileExtensions([...saved]));
  const ref = useRef<HTMLDivElement>(null);
  const dirty = extensionsChanged(saved, draft);
  const look = lookOf('ask_file');

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('panelTitle')}
      data-testid="ask-extensions-panel"
      className="absolute start-0 top-full z-30 mt-1.5 w-[300px] rounded-xl border border-border bg-background p-3 shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="chip-icon-sm" style={{ background: look.bg, color: look.fg }}>
          <Icon d={look.icon} className="h-3 w-3" />
        </span>
        <span className="text-[12.5px] font-semibold">{t('panelTitle')}</span>
      </div>
      <ExtensionChecklist value={draft} onChange={setDraft} idPrefix={idPrefix} />
      <p className="mt-2 text-[10.5px] text-muted-foreground">{t('empty')}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          data-action="cancel"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-[11.5px] font-semibold hover:bg-muted"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          data-action="save"
          disabled={!dirty}
          onClick={() => onSave(draft)}
          className="rounded-lg bg-brand px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('save')}
        </button>
      </div>
    </div>
  );
}
