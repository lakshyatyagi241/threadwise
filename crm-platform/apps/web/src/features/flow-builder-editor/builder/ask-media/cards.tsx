'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { flbAskFileSummary, flbCleanAskFileExtensions, type FlowNode } from '@crm/contracts';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { Icon } from '../node-card';
import { ExtensionsPanel } from './extension-panel';
import { PromptBox } from './prompt-box';

/** Stops a click or drag inside the card's controls from moving the node or starting a connection. */
const own = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
};

export const PENCIL = 'M3 13l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.7 12 3 13zM9.5 4.2l2.3 2.3';
export const PAPER_PLANE = 'M14 2L7 9M14 2l-4.5 12-2.5-5.5L1.5 6z';
export const CROSSHAIR =
  'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z';

/** The "(?)" help next to a checkbox: the text opens on hover or keyboard focus. */
export function HelpTip({ label, children }: { label: string; children: string }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        data-testid="ask-help"
        className="grid h-4 w-4 place-items-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-[200px] -translate-x-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-[10.5px] leading-snug text-background shadow-lg group-focus-within:block group-hover:block"
      >
        {children}
      </span>
    </span>
  );
}

/** What the "Img/File" card shows under its header: an editable prompt, the allowed extensions, and the save-as-property box. */
export function AskFileCardBody({
  node,
  onPatch,
}: {
  node: FlowNode;
  onPatch?: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('flb.builder.askMedia.file');
  const d = node.data ?? {};
  const [open, setOpen] = useState(false);
  const feed = usePickerFeed();
  const patch = (p: Record<string, unknown>) => onPatch?.(node.id, p);
  const extensions = flbCleanAskFileExtensions(d.extensions);
  const properties = feed.data?.custom ?? [];
  const checked = d.saveProperty === true;

  return (
    <div className="space-y-2.5 px-3 pt-2.5 pb-3" data-testid="ask-file-card" {...own}>
      <PromptBox
        value={d.prompt}
        placeholder={t('promptPlaceholder')}
        onChange={(v) => patch({ prompt: v })}
      />
      <div className="relative flex items-center justify-between gap-2 rounded-lg border border-[var(--flb-rule)] bg-muted/40 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="text-[11.5px] font-semibold">{t('allowExtensions')}</div>
          <div
            className="truncate font-mono text-[10.5px] text-muted-foreground"
            data-testid="ask-extension-summary"
          >
            {extensions.length === 0 ? t('anyFile') : flbAskFileSummary(extensions)}
          </div>
        </div>
        <button
          type="button"
          data-testid="ask-extensions-edit"
          aria-label={t('editExtensions')}
          title={t('editExtensions')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:border-brand hover:text-brand"
        >
          <Icon d={PENCIL} className="h-3.5 w-3.5" />
        </button>
        {open ? (
          <ExtensionsPanel
            saved={extensions}
            idPrefix={`card-${node.id}`}
            onClose={() => setOpen(false)}
            onSave={(next) => {
              patch({ extensions: next });
              setOpen(false);
            }}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-[11.5px]">
          <input
            type="checkbox"
            data-testid="ask-save-property"
            checked={checked}
            onChange={(e) => patch({ saveProperty: e.target.checked })}
            className="rounded border-border text-brand focus:ring-brand/30"
          />
          {t('saveAsProperty')}
        </label>
        <HelpTip label={t('helpLabel')}>{t('saveAsPropertyHelp')}</HelpTip>
      </div>
      {checked ? (
        <select
          aria-label={t('propertyLabel')}
          data-testid="ask-property-select"
          value={typeof d.propertyKey === 'string' ? d.propertyKey : ''}
          onChange={(e) => patch({ propertyKey: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] outline-none focus:border-brand"
        >
          <option value="">{t('propertyChoose')}</option>
          {properties.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

/** What the "Share Location" card shows: two full-width buttons (what the customer is asked), under an editable prompt. */
export function AskLocationCardBody({
  node,
  onPatch,
}: {
  node: FlowNode;
  onPatch?: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('flb.builder.askMedia.location');
  const d = node.data ?? {};
  return (
    <div className="space-y-2 px-3 pt-2.5 pb-3" data-testid="ask-location-card" {...own}>
      <PromptBox
        value={d.prompt}
        placeholder={t('promptPlaceholder')}
        onChange={(v) => onPatch?.(node.id, { prompt: v })}
      />
      {/* The two buttons are the picture of what the customer sees; they do nothing on the canvas. */}
      {[
        { id: 'share', label: t('share'), icon: PAPER_PLANE },
        { id: 'current', label: t('current'), icon: CROSSHAIR },
      ].map((b) => (
        <div
          key={b.id}
          data-location-button={b.id}
          aria-hidden="true"
          className="pointer-events-none flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-[12px] font-semibold text-white"
        >
          <Icon d={b.icon} className="h-3.5 w-3.5" />
          {b.label}
        </div>
      ))}
    </div>
  );
}
