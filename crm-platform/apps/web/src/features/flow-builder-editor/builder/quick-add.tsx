'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FlowType } from '@crm/contracts';
import { groupLabel, nodeLabel } from '../lib/contract-text';
import { useFlb } from '../lib/msg';
import { lookOf } from '../lib/node-ui';
import { Icon } from './node-card';
import { filterPalette } from './palette';

/**
 * The small "what comes next?" menu that opens where a dragged connection is let go on empty canvas (after a Button
 * node, a branch, any output). Picking a node adds it there and wires it to the port that was dragged.
 */
export function QuickAddMenu({
  mode,
  x,
  y,
  onPick,
  onClose,
}: {
  mode: FlowType;
  /** Position inside the canvas wrapper, in pixels. */
  x: number;
  y: number;
  onPick: (type: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('flb.builder.shell.palette');
  const tf = useFlb();
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => filterPalette(mode, query, tf), [mode, query, tf]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={t('addNode')}
      data-quick-add
      style={{ left: x, top: y }}
      className="absolute z-40 flex max-h-[min(380px,70%)] w-[250px] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="border-b border-border p-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          className="w-full rounded-full border border-border bg-background px-3 py-1.5 text-[12.5px] outline-none focus:border-brand"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.map(([group, items]) => (
          <div key={group} className="mb-2">
            <div className="mb-1 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {groupLabel(tf, group)}
            </div>
            {items.map((v) => {
              const look = lookOf(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  data-quick-add-type={v.id}
                  onClick={() => onPick(v.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-muted"
                >
                  <span className="chip-icon" style={{ background: look.bg, color: look.fg }}>
                    <Icon d={look.icon} />
                  </span>
                  <span className="text-[12.5px] font-semibold">{nodeLabel(tf, v.id)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
