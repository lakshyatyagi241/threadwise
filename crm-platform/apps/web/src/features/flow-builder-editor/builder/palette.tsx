'use client';

import { useMemo } from 'react';
import { flbPaletteFor, type FlowType, type FlbNodeTypeDef } from '@crm/contracts';
import { lookOf } from '../lib/node-ui';
import { Icon } from './node-card';

function ModeBadge({ mode }: { mode: FlowType }) {
  const base = 'ml-1.5 rounded px-1.5 py-0.5 font-sans text-[10px] normal-case tracking-normal';
  if (mode === 'instagram')
    return (
      <span
        className={`${base} text-white`}
        style={{ background: 'linear-gradient(135deg,#833AB4 0%,#E1306C 55%,#F77737 100%)' }}
      >
        Instagram
      </span>
    );
  if (mode === 'facebook')
    return <span className={`${base} bg-[#1877F2] text-white`}>Facebook</span>;
  if (mode === 'call')
    return <span className={`${base} bg-[var(--flb-rule)] text-[var(--flb-ink-700)]`}>Call</span>;
  if (mode === 'email') return <span className={`${base} bg-[#E8F0FE] text-[#1A73E8]`}>Email</span>;
  return <span className={`${base} bg-[var(--flb-mint)] text-brand`}>WhatsApp</span>;
}

/** Search matches label, description and group, case-insensitively (TW-FLB-016 rule 2). */
export function filterPalette(mode: FlowType, query: string): Array<[string, FlbNodeTypeDef[]]> {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, FlbNodeTypeDef[]>();
  for (const d of flbPaletteFor(mode)) {
    if (
      q &&
      !d.label.toLowerCase().includes(q) &&
      !d.desc.toLowerCase().includes(q) &&
      !d.group.toLowerCase().includes(q)
    )
      continue;
    groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  }
  return [...groups.entries()];
}

interface Props {
  mode: FlowType;
  query: string;
  onSearch: (q: string) => void;
  onAddCenter: (type: string) => void;
}

export function Palette({ mode, query, onSearch, onAddCenter }: Props) {
  const groups = useMemo(() => filterPalette(mode, query), [mode, query]);
  const total = groups.reduce((a, [, items]) => a + items.length, 0);
  const coarse = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  return (
    <aside
      className="flow-palette relative z-20 flex w-[260px] shrink-0 flex-col border-r border-border bg-background"
      aria-label="Node palette"
    >
      <div className="border-b border-border px-4 pt-4 pb-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Add a node
            <ModeBadge mode={mode} />
          </div>
          <span className="font-mono text-[9.5px] text-muted-foreground">{total}</span>
        </div>
        <div className="relative">
          <svg
            viewBox="0 0 16 16"
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="m11 11 3 3" />
          </svg>
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search nodes…"
            aria-label="Search nodes"
            className="w-full rounded-full border border-border bg-background py-2 pr-3 pl-9 text-[12.5px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {groups.map(([group, items]) => (
          <div key={group}>
            <div className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {group}
            </div>
            {items.map((v) => {
              const look = lookOf(v.id);
              return (
                <div
                  key={v.id}
                  draggable
                  data-palette-type={v.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('node-type', v.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => onAddCenter(v.id)}
                  onClick={() => {
                    if (coarse()) onAddCenter(v.id);
                  }}
                  className="pal-card mb-1.5 flex cursor-grab items-center gap-2.5 rounded-xl border border-border bg-background px-2.5 py-2 active:cursor-grabbing"
                >
                  <span className="chip-icon" style={{ background: look.bg, color: look.fg }}>
                    <Icon d={look.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold leading-tight">{v.label}</div>
                    <div className="truncate text-[10.5px] leading-snug text-muted-foreground">
                      {v.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {groups.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-muted-foreground">No nodes match.</div>
        ) : null}
      </div>
      <div className="border-t border-border bg-muted/40 px-4 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
        <span className="font-semibold text-[var(--flb-ink-700)]">Tip ·</span> drag onto canvas, or
        double-click to add at center.
      </div>
    </aside>
  );
}
