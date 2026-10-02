'use client';

import { useState } from 'react';
import type { Deal, Pipeline } from '../api/schemas';
import { stageDeals, type BoardState } from '../lib/board-state';
import { BoardColumn } from './board-column';

export interface BoardProps {
  pipeline: Pipeline;
  state: BoardState;
  canWrite: boolean;
  canCreate: boolean;
  canDelete: boolean;
  filtered: boolean;
  onOpen: (id: string) => void;
  /** A card was dropped (or picked from "Move to") on a stage at a position. */
  onMoveDeal: (deal: Deal, stageId: string, index: number) => void;
  onDelete: (deal: Deal) => void;
  onLoadMore: (stageId: string) => void;
  onRetry: (stageId: string) => void;
  onQuickAdd: (stageId: string, title: string) => Promise<boolean>;
}

/** The stage columns side by side, scrolling sideways on a narrow screen, with the drag-and-drop state. */
export function Board(p: BoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [over, setOver] = useState<{ stageId: string; index: number } | null>(null);

  const endDrag = () => {
    setDraggingId(null);
    setOver(null);
  };

  return (
    <div
      className="flex min-h-[26rem] items-stretch gap-3 overflow-x-auto pb-6"
      data-dragging={draggingId ? 'true' : undefined}
    >
      {p.pipeline.stages.map((stage) => (
        <BoardColumn
          key={stage.id}
          stage={stage}
          stages={p.pipeline.stages}
          column={p.state.columns[stage.id]}
          deals={stageDeals(p.state, stage.id)}
          summary={p.state.summary[stage.id]}
          currency={p.pipeline.currency}
          canWrite={p.canWrite}
          canCreate={p.canCreate}
          canDelete={p.canDelete}
          draggingId={draggingId}
          dropAt={over?.stageId === stage.id ? over.index : null}
          filtered={p.filtered}
          onDragOverColumn={(stageId, index) => {
            setOver((cur) =>
              cur?.stageId === stageId && cur.index === index ? cur : { stageId, index },
            );
          }}
          onDragLeaveColumn={(stageId) => setOver((cur) => (cur?.stageId === stageId ? null : cur))}
          onDropOnColumn={(stageId, index) => {
            const deal = draggingId ? p.state.deals[draggingId] : undefined;
            endDrag();
            if (deal) p.onMoveDeal(deal, stageId, index);
          }}
          onCardDragStart={setDraggingId}
          onCardDragEnd={endDrag}
          onOpen={p.onOpen}
          onMove={(deal, stageId) => p.onMoveDeal(deal, stageId, 0)}
          onDelete={p.onDelete}
          onLoadMore={p.onLoadMore}
          onRetry={p.onRetry}
          onQuickAdd={p.onQuickAdd}
        />
      ))}
    </div>
  );
}
