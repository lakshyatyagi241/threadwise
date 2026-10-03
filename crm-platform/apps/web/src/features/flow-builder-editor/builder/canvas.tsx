'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FlbBuilderContext, FlbPortContext } from '@crm/contracts';
import {
  NODE_W,
  bezierPath,
  clampZoom,
  moveNode,
  zoomAround,
  type CanvasState,
} from '../lib/graph-ops';
import { Icon, NodeCard } from './node-card';

interface Props {
  state: CanvasState;
  ctx: FlbBuilderContext;
  portCtx: FlbPortContext;
  selectedId: string | null;
  invalidIds: ReadonlySet<string>;
  pan: { x: number; y: number };
  zoom: number;
  setPan: (p: { x: number; y: number } | ((p: { x: number; y: number }) => { x: number; y: number })) => void;
  setZoom: (z: number) => void;
  onSelect: (id: string | null) => void;
  /** A change that should not enter the undo history yet (a node being dragged). */
  onLive: (next: CanvasState) => void;
  /** The drag ended: record one history entry if the node moved. */
  onMoved: (next: CanvasState) => void;
  onConnect: (from: { nodeId: string; handleId: string }, targetId: string) => void;
  onDropNode: (type: string, x: number, y: number) => void;
  onDeleteEdge: (id: string) => void;
  wrapperRef: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * The pannable, zoomable dot-grid with node cards and bezier connectors (TW-FLB-015). Wheel pans; Ctrl/Cmd + wheel zooms
 * around the pointer; two fingers pinch; one finger (or the mouse) pans, drags a node or draws a connection from a port.
 * Port centres are measured from the DOM after layout, so an edge always meets the dot it belongs to.
 */
export function Canvas({
  state,
  ctx,
  portCtx,
  selectedId,
  invalidIds,
  pan,
  zoom,
  setPan,
  setZoom,
  onSelect,
  onLive,
  onMoved,
  onConnect,
  onDropNode,
  onDeleteEdge,
  wrapperRef,
  children,
}: Props) {
  const { nodes, edges } = state;
  const [hoveredPort, setHoveredPort] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [pendingFrom, setPendingFrom] = useState<{ nodeId: string; handleId: string } | null>(null);
  const [tempEdge, setTempEdge] = useState<Pt | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [edgePopup, setEdgePopup] = useState<{ id: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [portOffsets, setPortOffsets] = useState<Record<string, Pt>>({});

  const dragNode = useRef<{ id: string; offX: number; offY: number; startX: number; startY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const pinch = useRef<{ d: number } | null>(null);
  // The latest state for the window listeners, which are installed once per interaction change.
  const live = useRef({ state, pan, zoom });
  useLayoutEffect(() => {
    live.current = { state, pan, zoom };
  });

  const measurePorts = useCallback(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const next: Record<string, Pt> = {};
    wrap.querySelectorAll<HTMLElement>('[data-port]').forEach((el) => {
      const card = el.closest<HTMLElement>('[data-node-id]');
      if (!card) return;
      const cr = card.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (cr.width === 0 || er.width === 0) return;
      next[el.getAttribute('data-port')!] = {
        x: (er.left + er.width / 2 - cr.left) / zoom,
        y: (er.top + er.height / 2 - cr.top) / zoom,
      };
    });
    setPortOffsets(next);
  }, [zoom, wrapperRef]);

  // Re-measure when the layout can have changed: nodes (ports appear/disappear), edges, zoom, and after fonts settle.
  const portSignature = useMemo(
    () => nodes.map((n) => `${n.id}:${n.type}:${JSON.stringify(n.data).length}`).join('|'),
    [nodes],
  );
  useLayoutEffect(() => {
    measurePorts();
  }, [portSignature, edges.length, zoom, measurePorts]);
  useEffect(() => {
    const t1 = requestAnimationFrame(measurePorts);
    const t2 = setTimeout(measurePorts, 80);
    const t3 = setTimeout(measurePorts, 300);
    void document.fonts?.ready?.then(measurePorts);
    return () => {
      cancelAnimationFrame(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [measurePorts]);

  // Moving a node moves its ports with it: edge geometry follows `nodes` x/y, offsets are relative to the card.
  const edgePaths = useMemo(() => {
    return edges
      .map((edge) => {
        const src = nodes.find((n) => n.id === edge.source);
        const tgt = nodes.find((n) => n.id === edge.target);
        if (!src || !tgt) return null;
        const o = portOffsets[`out:${edge.source}:${edge.sourceHandle || 'out'}`];
        const i = portOffsets[`in:${edge.target}`];
        if (!o || !i) return null;
        return {
          id: edge.id,
          kind: edge.kind,
          d: bezierPath(src.x + o.x, src.y + o.y, tgt.x + i.x, tgt.y + i.y),
        };
      })
      .filter((e): e is { id: string; kind: 'no' | null | undefined; d: string } => e !== null);
  }, [nodes, edges, portOffsets]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Pt => {
      const r = wrapperRef.current!.getBoundingClientRect();
      const { pan: p, zoom: z } = live.current;
      return { x: (clientX - r.left - p.x) / z, y: (clientY - r.top - p.y) / z };
    },
    [wrapperRef],
  );

  // --- pointer handling ---------------------------------------------------------------------------------------------------
  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) return;
    if (e.button !== 0) return;
    onSelect(id);
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const w = toWorld(e.clientX, e.clientY);
    dragNode.current = { id, offX: w.x - n.x, offY: w.y - n.y, startX: n.x, startY: n.y };
    setDraggingId(id);
  };

  const onPortPointerDown = useCallback((e: React.PointerEvent, nodeId: string, handleId: string) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setPendingFrom({ nodeId, handleId });
  }, []);

  useEffect(() => {
    const dist = () => {
      const pts = [...pointers.current.values()];
      return pts.length < 2 ? 0 : Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
    };
    const onMove = (e: PointerEvent) => {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const { pan: p, zoom: z, state: st } = live.current;
      if (pointers.current.size >= 2) {
        dragNode.current = null;
        panRef.current = null;
        if (pendingFrom) {
          setPendingFrom(null);
          setTempEdge(null);
        }
        const d = dist();
        if (pinch.current && pinch.current.d > 0 && d > 0) {
          const pts = [...pointers.current.values()];
          const r = wrap.getBoundingClientRect();
          const mx = (pts[0]!.x + pts[1]!.x) / 2 - r.left;
          const my = (pts[0]!.y + pts[1]!.y) / 2 - r.top;
          const res = zoomAround(p, z, z * (d / pinch.current.d), mx, my);
          setPan(res.pan);
          setZoom(res.zoom);
        }
        pinch.current = { d };
        return;
      }
      if (dragNode.current) {
        const { id, offX, offY } = dragNode.current;
        const w = toWorld(e.clientX, e.clientY);
        onLive(moveNode(st, id, w.x - offX, w.y - offY));
        return;
      }
      if (panRef.current) {
        const pr = panRef.current;
        setPan({ x: pr.panX + (e.clientX - pr.startX), y: pr.panY + (e.clientY - pr.startY) });
        return;
      }
      if (pendingFrom) setTempEdge(toWorld(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (dragNode.current) {
        const { id, startX, startY } = dragNode.current;
        const n = live.current.state.nodes.find((x) => x.id === id);
        if (n && (n.x !== startX || n.y !== startY)) onMoved(live.current.state);
        dragNode.current = null;
        setDraggingId(null);
      }
      if (panRef.current) {
        panRef.current = null;
        setPanning(false);
      }
      if (pendingFrom) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const portEl = el?.closest('[data-port]');
        if (portEl) {
          const parts = portEl.getAttribute('data-port')!.split(':');
          if (parts[0] === 'in') onConnect(pendingFrom, parts[1]!);
        } else {
          const card = el?.closest('[data-node-id]');
          if (card) onConnect(pendingFrom, card.getAttribute('data-node-id')!);
        }
        setPendingFrom(null);
        setTempEdge(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [pendingFrom, onConnect, onLive, onMoved, setPan, setZoom, toWorld, wrapperRef]);

  // Wheel: plain scroll pans, Ctrl/Cmd + wheel zooms around the pointer. Needs a non-passive listener to prevent the page scroll.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { pan: p, zoom: z } = live.current;
      if (!(e.ctrlKey || e.metaKey)) {
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY });
        return;
      }
      const r = el.getBoundingClientRect();
      const res = zoomAround(p, z, z * (1 + -e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      setPan(res.pan);
      setZoom(res.zoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setPan, setZoom, wrapperRef]);

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      panRef.current = null;
      return;
    }
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('canvas-empty')) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setPanning(true);
  };
  const onCanvasClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-empty')) {
      onSelect(null);
      setEdgePopup(null);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('node-type');
    if (!type || !wrapperRef.current) return;
    const w = toWorld(e.clientX, e.clientY);
    onDropNode(type, w.x - NODE_W / 2, w.y - 30);
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  void selectedNode;

  return (
    <div
      ref={wrapperRef as RefObject<HTMLDivElement>}
      data-testid="canvas"
      onPointerDown={onCanvasPointerDown}
      onClick={onCanvasClick}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      className={`canvas-empty canvas-dots fb-touch-canvas relative flex-1 overflow-hidden ${panning ? 'dragging' : ''}`}
      style={{ cursor: pendingFrom ? 'crosshair' : 'default' }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform' }}
      >
        <svg width={4000} height={3000} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <g style={{ pointerEvents: 'auto' }}>
            {edgePaths.map((e) => (
              <g key={e.id} data-edge-id={e.id}>
                <path
                  d={e.d}
                  className="edge-hit"
                  onMouseEnter={() => setHoveredEdge(e.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    const w = toWorld(ev.clientX, ev.clientY);
                    setEdgePopup({ id: e.id, x: w.x, y: w.y });
                  }}
                />
                <path
                  d={e.d}
                  className={`edge-path ${e.kind === 'no' ? 'no ' : ''}${hoveredEdge === e.id ? 'hover' : ''}`}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            ))}
            {tempEdge && pendingFrom
              ? (() => {
                  const src = nodes.find((n) => n.id === pendingFrom.nodeId);
                  const o = portOffsets[`out:${pendingFrom.nodeId}:${pendingFrom.handleId}`];
                  if (!src || !o) return null;
                  return <path className="edge-path preview" d={bezierPath(src.x + o.x, src.y + o.y, tempEdge.x, tempEdge.y)} />;
                })()
              : null}
          </g>
        </svg>

        {nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            ctx={ctx}
            portCtx={portCtx}
            selected={selectedId === node.id}
            invalid={invalidIds.has(node.id)}
            dragging={draggingId === node.id}
            hoveredPort={hoveredPort}
            onPointerDown={onNodePointerDown}
            onSelect={onSelect}
            onPortPointerDown={onPortPointerDown}
            onPortHover={setHoveredPort}
          />
        ))}

        {edgePopup ? (
          <div
            className="edge-popup"
            style={{ left: edgePopup.x, top: edgePopup.y - 4 }}
            role="button"
            tabIndex={0}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteEdge(edgePopup.id);
              setEdgePopup(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onDeleteEdge(edgePopup.id);
                setEdgePopup(null);
              }
            }}
          >
            <Icon d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" />
            <span>Delete</span>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export { clampZoom };
