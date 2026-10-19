'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { FLB_NODE_TYPES, type FlowEdge, type FlowNode, type FlbNodeData } from '@crm/contracts';
import { groupLabel, nodeLabel } from '../lib/contract-text';
import { NODE_W } from '../lib/graph-ops';
import { useFlb } from '../lib/msg';
import { lookOf } from '../lib/node-ui';
import { Icon } from './node-card';
import { NODE_FORMS } from './inspector/registry';
import type { FormEnv } from './inspector/types';

/** The floating bar above the selected node: pin as START, edit, duplicate, delete. */
export function NodeActionBar({
  node,
  pan,
  zoom,
  onEdit,
  onDelete,
  onPin,
  onDuplicate,
}: {
  node: FlowNode;
  pan: { x: number; y: number };
  zoom: number;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onDuplicate: () => void;
}) {
  const t = useTranslations('flb.builder.shell.overlays');
  const left = pan.x + (node.x + NODE_W / 2) * zoom;
  const top = pan.y + (node.y - 14) * zoom;
  const pinned = !!node.isStart;
  return (
    <div
      className="node-actions"
      style={{ left, top, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onPin}
        title={pinned ? t('startPinned') : t('startMake')}
        aria-label={t('startPoint')}
        aria-pressed={pinned}
        style={pinned ? { background: 'var(--flb-mint)', color: 'var(--brand)' } : undefined}
      >
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill={pinned ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 1.5l1.9 4 4.1.5-3 2.9.8 4-3.8-2-3.8 2 .8-4-3-2.9 4.1-.5z" />
        </svg>
      </button>
      <button type="button" onClick={onEdit} title={t('editTitle')} aria-label={t('edit')}>
        <Icon d="M11 2.5l2.5 2.5L5 13.5H2.5V11zM9.5 4l2.5 2.5" />
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        title={t('duplicateTitle')}
        aria-label={t('duplicate')}
      >
        <Icon d="M5 5h8v8H5zM3 10.5H2.5A.5.5 0 0 1 2 10V2.5A.5.5 0 0 1 2.5 2H10a.5.5 0 0 1 .5.5V3" />
      </button>
      <button
        type="button"
        className="danger"
        onClick={onDelete}
        title={t('deleteTitle')}
        aria-label={t('deleteNode')}
      >
        <Icon d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" />
      </button>
    </div>
  );
}

/** Bottom-right overview with a draggable viewport rectangle. */
export function Minimap({
  nodes,
  pan,
  zoom,
  setPan,
  viewport,
}: {
  nodes: FlowNode[];
  pan: { x: number; y: number };
  zoom: number;
  setPan: (p: { x: number; y: number }) => void;
  viewport: { width: number; height: number };
}) {
  const W = 170,
    H = 110,
    PAD = 8;
  const bbox = useMemo(() => {
    if (!nodes.length) return { minX: 0, minY: 0, maxX: 600, maxY: 400 };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + 100);
    }
    return { minX: minX - 60, minY: minY - 60, maxX: maxX + 60, maxY: maxY + 60 };
  }, [nodes]);
  const bw = Math.max(1, bbox.maxX - bbox.minX);
  const bh = Math.max(1, bbox.maxY - bbox.minY);
  const scale = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  const offX = PAD + (W - PAD * 2 - bw * scale) / 2;
  const offY = PAD + (H - PAD * 2 - bh * scale) / 2;
  const project = (x: number, y: number) => ({
    x: offX + (x - bbox.minX) * scale,
    y: offY + (y - bbox.minY) * scale,
  });
  const v = project(-pan.x / zoom, -pan.y / zoom);
  const vw = viewport.width / zoom;
  const vh = viewport.height / zoom;
  const dragging = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const d = dragging.current;
      if (!d) return;
      setPan({
        x: d.px - ((ev.clientX - d.x) / scale) * zoom,
        y: d.py - ((ev.clientY - d.y) / scale) * zoom,
      });
    };
    const onUp = () => (dragging.current = null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [scale, zoom, setPan]);

  return (
    <div className="minimap" onMouseDown={(e) => e.stopPropagation()} data-testid="minimap">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {nodes.map((n) => {
          const p = project(n.x, n.y);
          return (
            <rect
              key={n.id}
              x={p.x}
              y={p.y}
              width={Math.max(2, NODE_W * scale)}
              height={Math.max(2, 60 * scale)}
              rx="2"
              className="mm-node"
            />
          );
        })}
        <rect
          x={v.x}
          y={v.y}
          width={Math.max(2, vw * scale)}
          height={Math.max(2, vh * scale)}
          className="mm-view"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragging.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          }}
        />
      </svg>
    </div>
  );
}

/** The red popup that lists why Save or Publish was blocked (TW-FLB-018). */
export function ValidationPopup({
  items,
  nodes = [],
  onGoTo,
  onClose,
}: {
  items: string[];
  /** The nodes that need attention: each one is a button that takes the canvas to it. */
  nodes?: Array<{ id: string; label: string }>;
  onGoTo?: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('flb.builder.shell.overlays');
  const tc = useTranslations('flb.common');
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-[90] flex justify-center px-4"
      role="alert"
    >
      <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border-2 border-[var(--flb-coral)] bg-background shadow-xl">
        <div className="flex items-start gap-3 bg-[var(--flb-coral)]/10 px-4 py-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--flb-coral)]/15 text-[var(--flb-coral)]">
            <Icon d="M8 5v3.5M8 11h.01M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">
              {t('cantSave', { count: items.length })}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 ps-4 text-[12px] text-[var(--flb-ink-600)]">
              {items.slice(0, 6).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
            {items.length > 6 ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t('andMore', { count: items.length - 6 })}
              </div>
            ) : null}
            {onGoTo && nodes.length > 0 ? (
              <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {nodes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    data-goto-node={n.id}
                    onClick={() => onGoTo(n.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--flb-coral)]/50 bg-background px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-[var(--flb-coral)]/10"
                  >
                    {n.label}
                    <Icon d="M6 4l4 4-4 4" className="h-3 w-3" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-1.5 text-[11px] text-muted-foreground">{t('outlined')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={tc('dismiss')}
            aria-label={tc('dismiss')}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[var(--flb-coral)]/10"
          >
            <Icon d="M4 4l8 8M12 4l-8 8" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The right-hand panel: node header, preview-bearing form from the registry, delete and close. */
export function InspectorPanel({
  node,
  open,
  env,
  onClose,
  onDelete,
  onSet,
  onSetMany,
  onAddOption,
  onRemoveOption,
}: {
  node: FlowNode | null;
  open: boolean;
  env: FormEnv;
  onClose: () => void;
  onDelete: () => void;
  onSet: (key: string, value: unknown) => void;
  onSetMany: (patch: Record<string, unknown>) => void;
  onAddOption: () => void;
  onRemoveOption: (i: number) => void;
}) {
  const t = useTranslations('flb.builder.shell.overlays');
  const tf = useFlb();
  if (!open) return null;
  if (!node) {
    return (
      <aside
        className="ins-panel z-20 flex w-[360px] shrink-0 flex-col border-s border-border bg-background"
        aria-label={t('inspector')}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="chip-icon bg-muted">
              <Icon
                d="M8 1.5a4.5 4.5 0 0 0-2.5 8.3V12h5V9.8A4.5 4.5 0 0 0 8 1.5z"
                className="h-4 w-4 text-muted-foreground"
              />
            </span>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('inspector')}
              </div>
              <div className="font-serif text-[16px] leading-tight">{t('selectNode')}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"
            title={t('hidePanel')}
            aria-label={t('hidePanel')}
          >
            <Icon d="M4 4l8 8M12 4l-8 8" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 text-center text-[12.5px] text-muted-foreground">
          <svg
            viewBox="0 0 16 16"
            className="mx-auto h-12 w-12 text-border"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          >
            <circle cx="3.5" cy="8" r="1.8" />
            <circle cx="12.5" cy="3.5" r="1.8" />
            <circle cx="12.5" cy="12.5" r="1.8" />
            <path d="M5 7l6-3M5 9l6 3" />
          </svg>
          <div className="mt-3 font-serif text-[16px] text-foreground/80">
            {t('nothingSelected')}
          </div>
          <div className="mt-1.5 text-[12px] leading-snug">
            {t.rich('nothingHint', { br: () => <br /> })}
          </div>
        </div>
      </aside>
    );
  }
  const def = FLB_NODE_TYPES[node.type];
  const look = lookOf(node.type);
  const Form = NODE_FORMS[node.type];
  const data: FlbNodeData = node.data ?? {};
  return (
    <aside
      className="ins-panel z-20 flex w-[360px] shrink-0 flex-col border-s border-border bg-background"
      aria-label={t('inspector')}
      data-testid="inspector"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="chip-icon" style={{ background: look.bg, color: look.fg }}>
            <Icon d={look.icon} />
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {def ? groupLabel(tf, def.group) : t('nodeFallback')}
            </div>
            <div className="truncate font-serif text-[16px] leading-tight">
              {def ? nodeLabel(tf, node.type) : node.type}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="grid h-8 w-8 place-items-center rounded-full text-[var(--flb-coral)] hover:bg-[var(--flb-coral)]/15"
            title={t('deleteTitle')}
            aria-label={t('deleteNode')}
          >
            <Icon d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"
            title={t('hidePanel')}
            aria-label={t('hidePanel')}
          >
            <Icon d="M4 4l8 8M12 4l-8 8" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-[12.5px] text-muted-foreground">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
          <span>{t('id')}</span>
          <span className="text-foreground/80">{node.id}</span>
        </div>
        {Form ? (
          <Form
            node={node}
            data={data}
            set={onSet}
            setMany={onSetMany}
            env={env}
            addOption={onAddOption}
            removeOption={onRemoveOption}
          />
        ) : (
          <div className="text-[12.5px] leading-relaxed text-foreground/80">{t('noSettings')}</div>
        )}
      </div>
    </aside>
  );
}

export type { FlowEdge };
