'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Input, Spinner, cn } from '@crm/ui';
import type { Deal, Stage, StageSummary } from '../api/schemas';
import type { ColumnState } from '../lib/board-state';
import { dropIndex } from '../lib/drop';
import { formatMoney } from '../lib/money';
import { DealCard } from './deal-card';
import { PlusIcon } from './icons';

export interface BoardColumnProps {
  stage: Stage;
  stages: readonly Stage[];
  column: ColumnState | undefined;
  deals: readonly Deal[];
  summary: StageSummary | undefined;
  currency: string;
  canWrite: boolean;
  canCreate: boolean;
  canDelete: boolean;
  draggingId: string | null;
  /** Index among the other cards where a drop would land; null when nothing is dragged over this column. */
  dropAt: number | null;
  filtered: boolean;
  onDragOverColumn: (stageId: string, index: number) => void;
  onDragLeaveColumn: (stageId: string) => void;
  onDropOnColumn: (stageId: string, index: number) => void;
  onCardDragStart: (id: string) => void;
  onCardDragEnd: () => void;
  onOpen: (id: string) => void;
  onMove: (deal: Deal, stageId: string) => void;
  onDelete: (deal: Deal) => void;
  onLoadMore: (stageId: string) => void;
  onRetry: (stageId: string) => void;
  onQuickAdd: (stageId: string, title: string) => Promise<boolean>;
}

export function BoardColumn(p: BoardColumnProps) {
  const t = useTranslations('deals-pipelines.board');
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const status = p.column?.status ?? 'loading';
  const count = p.summary?.count ?? p.deals.length;

  const indexFor = (e: DragEvent) => {
    const nodes = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-deal-id]') ?? [])];
    return dropIndex(
      e.clientY,
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.dataset.dealId ?? '', top: r.top, bottom: r.bottom };
      }),
      p.draggingId,
    );
  };

  async function submit() {
    const text = title.trim();
    if (!text || saving) return;
    setSaving(true);
    const ok = await p.onQuickAdd(p.stage.id, text);
    setSaving(false);
    if (ok) {
      setTitle('');
      setAdding(false);
    }
  }

  // The indicator sits before the n-th card that is not the dragged one.
  const rows: ReactNode[] = [];
  let others = 0;
  const indicator = (key: string) => (
    <div key={key} aria-hidden="true" className="h-1 rounded-full bg-primary" />
  );
  for (const d of p.deals) {
    if (p.dropAt !== null && d.id !== p.draggingId) {
      if (others === p.dropAt) rows.push(indicator(`i-${others}`));
      others++;
    }
    rows.push(
      <DealCard
        key={d.id}
        deal={d}
        stage={p.stage}
        stages={p.stages}
        canWrite={p.canWrite}
        canDelete={p.canDelete}
        dragging={p.draggingId === d.id}
        onOpen={p.onOpen}
        onMove={p.onMove}
        onDelete={p.onDelete}
        onDragStart={p.onCardDragStart}
        onDragEnd={p.onCardDragEnd}
      />,
    );
  }
  if (p.dropAt !== null && others === p.dropAt) rows.push(indicator('i-end'));

  const remaining = Math.max(0, count - p.deals.length);

  return (
    <section
      aria-label={p.stage.name}
      className={cn(
        'flex w-[19rem] shrink-0 flex-col rounded-xl border border-border bg-muted/40',
        p.dropAt !== null && 'border-primary/60 bg-primary/5',
      )}
    >
      <header className="rounded-t-xl border-b border-border px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: p.stage.color }}
          />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{p.stage.name}</h2>
          <span
            className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
            aria-label={t('countLabel', { count })}
          >
            {count}
          </span>
          {p.canCreate && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              aria-label={t('addToStage', { stage: p.stage.name })}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <PlusIcon />
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {formatMoney(p.summary?.valueMinor ?? 0, p.currency, locale, { compact: true })}
          </span>
          {p.stage.kind === 'open' ? (
            <span title={t('weightedHint')}>
              {t('probability', { n: p.stage.probability })}
              {' · '}
              <span className="tabular-nums">
                {formatMoney(p.summary?.weightedMinor ?? 0, p.currency, locale, { compact: true })}
              </span>
            </span>
          ) : (
            <span>{p.stage.kind === 'won' ? t('closedWon') : t('closedLost')}</span>
          )}
        </div>
      </header>

      <div
        ref={listRef}
        onDragOver={(e) => {
          if (!p.canWrite || !p.draggingId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          p.onDragOverColumn(p.stage.id, indexFor(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            p.onDragLeaveColumn(p.stage.id);
          }
        }}
        onDrop={(e) => {
          if (!p.canWrite || !p.draggingId) return;
          e.preventDefault();
          p.onDropOnColumn(p.stage.id, indexFor(e));
        }}
        className="flex min-h-24 flex-1 flex-col gap-2 p-2"
      >
        {status === 'loading' && p.deals.length === 0 && (
          <div className="space-y-2" aria-busy="true" aria-label={t('loading')}>
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-background/70" />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
            <p>{t('columnFailed')}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => p.onRetry(p.stage.id)}>
              {t('retry')}
            </Button>
          </div>
        )}

        {status !== 'loading' && status !== 'error' && p.deals.length === 0 && p.dropAt === null && (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {p.filtered ? t('noMatches') : t('noDeals')}
          </div>
        )}

        {rows}

        {p.column?.hasMore && (
          <Button
            variant="secondary"
            size="sm"
            disabled={status === 'loadingMore'}
            onClick={() => p.onLoadMore(p.stage.id)}
          >
            {status === 'loadingMore' && <Spinner />}
            {remaining > 0 ? t('loadMoreCount', { count: remaining }) : t('loadMore')}
          </Button>
        )}
      </div>

      {adding && (
        <form
          className="border-t border-border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            value={title}
            maxLength={191}
            disabled={saving}
            aria-label={t('quickAddLabel', { stage: p.stage.name })}
            placeholder={t('quickAddPlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false);
                setTitle('');
              }
            }}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setTitle('');
              }}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saving || title.trim() === ''}>
              {saving && <Spinner />}
              {t('add')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
