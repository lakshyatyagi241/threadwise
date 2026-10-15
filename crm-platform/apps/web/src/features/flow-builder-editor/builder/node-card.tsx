'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import {
  FLB_NODE_TYPES,
  flbIsMultiPort,
  flbPortsFor,
  type FlbBuilderContext,
  type FlowNode,
  type FlbPortContext,
} from '@crm/contracts';
import { groupLabel, nodeLabel, portLabel } from '../lib/contract-text';
import { useFlb } from '../lib/msg';
import { lookOf } from '../lib/node-ui';
import { NODE_W } from '../lib/graph-ops';
import { AskFileCardBody, AskLocationCardBody } from './ask-media/cards';
import { opensNodeOnDoubleClick } from './node-open';
import { NodePreview } from './node-preview';
import { SubflowCardBody } from './subflow-card';

/** The two Ask for file / location cards carry their own title (as the other product draws them) and an editable body. */
const ASK_CARD_TITLE_KEY: Record<string, string> = {
  ask_file: 'file.cardTitle',
  ask_location: 'location.cardTitle',
};

export const Icon = ({ d, className = 'h-4 w-4' }: { d: string; className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

interface Props {
  node: FlowNode;
  ctx: FlbBuilderContext;
  portCtx: FlbPortContext;
  selected: boolean;
  invalid: boolean;
  dragging: boolean;
  /** While another node is selected: how this one relates to it (`dim` = not wired to it). */
  focus?: 'upstream' | 'downstream' | 'dim' | null;
  hoveredPort: string | null;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onSelect: (id: string) => void;
  /** Double-click on the card: select it and open the inspector. */
  onOpen?: (id: string) => void;
  onPortPointerDown: (e: React.PointerEvent, nodeId: string, handleId: string) => void;
  onPortHover: (key: string | null) => void;
  /** Writes keys of a node's data from a control on the card itself (the Ask for file / location cards). */
  onPatch?: (nodeId: string, patch: Record<string, unknown>) => void;
}

/**
 * A node on the canvas: input dot on the left (not on the Trigger), START ribbon, header chip, a read-only preview, and
 * either one output dot or one labelled port per branch. The handle ids on the ports are the routing contract with the runtime.
 */
export const NodeCard = memo(function NodeCard({
  node,
  ctx,
  portCtx,
  selected,
  invalid,
  dragging,
  focus,
  hoveredPort,
  onPointerDown,
  onSelect,
  onOpen,
  onPortPointerDown,
  onPortHover,
  onPatch,
}: Props) {
  const tAsk = useTranslations('flb.builder.askMedia');
  const tn = useTranslations('flb.builder.shell.nodeCard');
  const tf = useFlb();
  const def = FLB_NODE_TYPES[node.type];
  const look = lookOf(node.type);
  const askTitle = ASK_CARD_TITLE_KEY[node.type];
  const label = askTitle ? tAsk(askTitle) : def ? nodeLabel(tf, node.type) : node.type;
  const group = def ? groupLabel(tf, def.group) : tn('nodeFallback');
  const rows = flbPortsFor(node, portCtx);
  const isTrigger = node.type === 'trigger';
  const multi = flbIsMultiPort(node, portCtx);
  const terminal = rows.length === 0;

  return (
    <div
      data-node-id={node.id}
      data-node-type={node.type}
      className={`node-card absolute select-none ${selected ? 'selected ' : ''}${dragging ? 'dragging ' : ''}${invalid ? 'node-invalid ' : ''}${focus ? `node-${focus} ` : ''}`}
      style={{
        left: node.x,
        top: node.y,
        width: NODE_W,
        ...(invalid ? { boxShadow: '0 0 0 2px #E5484D, 0 8px 22px rgba(229,72,77,0.28)' } : {}),
      }}
      onPointerDown={(e) => onPointerDown(e, node.id)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id);
      }}
      onDoubleClick={(e) => {
        if (!onOpen || !opensNodeOnDoubleClick(e.target)) return;
        e.stopPropagation();
        onOpen(node.id);
      }}
    >
      {!isTrigger ? (
        <div
          data-port={`in:${node.id}`}
          className={`port in ${hoveredPort === `${node.id}:in` ? 'active' : ''}`}
          style={{ top: '50%' }}
          onMouseEnter={() => onPortHover(`${node.id}:in`)}
          onMouseLeave={() => onPortHover(null)}
          onMouseDown={(e) => e.stopPropagation()}
          title={tn('input')}
        />
      ) : null}

      {node.isStart ? (
        <div
          className="absolute -top-2.5 left-3 z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold"
          style={{ background: 'var(--brand)', color: '#fff' }}
        >
          <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor">
            <path d="M8 1.5l1.9 4 4.1.5-3 2.9.8 4-3.8-2-3.8 2 .8-4-3-2.9 4.1-.5z" />
          </svg>
          {tn('start')}
        </div>
      ) : null}

      <div className="flex items-center gap-2.5 border-b border-[var(--flb-rule)] px-3 pt-3 pb-2.5">
        <span className="chip-icon" style={{ background: look.bg, color: look.fg }}>
          <Icon d={look.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{label}</div>
          {askTitle ? null : (
            <div className="truncate font-mono text-[9.5px] text-muted-foreground">{node.id}</div>
          )}
        </div>
        {askTitle ? (
          <span
            data-testid="ask-step-number"
            title={tAsk('step', { id: node.id })}
            className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9.5px] tracking-wider text-muted-foreground"
          >
            {node.id}
          </span>
        ) : (
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
            {group}
          </span>
        )}
      </div>

      {node.type === 'end' ? (
        <div className="px-3 py-4 text-center text-[11.5px] italic text-muted-foreground">
          {tn('flowEnds')}
        </div>
      ) : null}

      {node.type === 'ask_file' ? (
        <AskFileCardBody node={node} onPatch={onPatch} />
      ) : node.type === 'ask_location' ? (
        <AskLocationCardBody node={node} onPatch={onPatch} />
      ) : node.type === 'subflow' ? (
        <SubflowCardBody node={node} ctx={ctx} onPatch={onPatch} />
      ) : (
        <NodePreview node={node} ctx={ctx} />
      )}

      {multi ? (
        <div className="border-t border-[var(--flb-rule)] px-2 pt-1 pb-2">
          {rows.map((r) => (
            <div key={r.id} className="node-row relative flex items-center gap-2 px-2 py-2">
              <span
                className="chip-icon-sm"
                style={{
                  background:
                    r.kind === 'yes'
                      ? 'var(--flb-mint)'
                      : r.kind === 'no'
                        ? '#FBE9E7'
                        : 'var(--muted)',
                  color:
                    r.kind === 'yes'
                      ? 'var(--brand)'
                      : r.kind === 'no'
                        ? '#A1431F'
                        : 'var(--flb-ink-600)',
                }}
              >
                <Icon
                  d={
                    r.kind === 'yes'
                      ? 'M3 8l3 3 7-7'
                      : r.kind === 'no'
                        ? 'M4 4l8 8M12 4l-8 8'
                        : 'M3 8h10M9 4l4 4-4 4'
                  }
                  className="h-3 w-3"
                />
              </span>
              <div
                className={`min-w-0 flex-1 truncate text-[12px] ${
                  r.kind === 'yes'
                    ? 'font-semibold text-[var(--flb-yes)]'
                    : r.kind === 'no'
                      ? 'font-semibold text-[var(--flb-coral)]'
                      : 'text-[var(--flb-ink-700)]'
                }`}
              >
                {portLabel(tf, node, r)}
              </div>
              <div
                data-port={`out:${node.id}:${r.id}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPortPointerDown(e, node.id, r.id);
                }}
                onMouseEnter={() => onPortHover(`${node.id}:${r.id}`)}
                onMouseLeave={() => onPortHover(null)}
                className={`port out ${r.kind === 'yes' ? 'is-yes ' : r.kind === 'no' ? 'is-no ' : ''}${hoveredPort === `${node.id}:${r.id}` ? 'active' : ''}`}
                title={tn('outPort', { label: portLabel(tf, node, r) })}
              />
            </div>
          ))}
        </div>
      ) : null}

      {!multi && !terminal ? (
        <div
          data-port={`out:${node.id}:${rows[0]!.id}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPortPointerDown(e, node.id, rows[0]!.id);
          }}
          onMouseEnter={() => onPortHover(`${node.id}:${rows[0]!.id}`)}
          onMouseLeave={() => onPortHover(null)}
          className={`port out ${hoveredPort === `${node.id}:${rows[0]!.id}` ? 'active' : ''}`}
          style={{ top: '50%' }}
          title={tn('output')}
        />
      ) : null}
    </div>
  );
});
