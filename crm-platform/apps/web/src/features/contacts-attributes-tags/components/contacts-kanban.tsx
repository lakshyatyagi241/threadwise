'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Select, Spinner, cn } from '@crm/ui';
import type { ContactRow } from '../api/schemas';
import { useStageColumn, type ContactFilters } from '../api/contacts';
import type { Choice } from '../lib/option-sets';
import type { RowView } from '../lib/row-view';
import { ContactAvatar, MoreChip, TagChip } from './chips';

const DRAG_TYPE = 'application/x-contact-id';

export interface KanbanHandlers {
  /** Present when the caller may edit contacts: cards can then be moved to another stage. */
  onStageChange?: (id: string, stage: string) => void;
  stageBusyId: string | null;
}

/**
 * The Contact Hub as a board: one column per stage, the contacts of that stage as cards. A card moves to another stage by
 * dragging it onto the column, or with the stage list on the card (the way for a keyboard, a phone, a screen reader). A move
 * goes through the same save as the table's stage menu, so a lost stage still asks why. Every column loads its own pages.
 */
export function ContactsKanban({
  filters,
  stages,
  toView,
  ...h
}: {
  filters: ContactFilters;
  stages: readonly Choice[];
  toView: (row: ContactRow) => RowView;
} & KanbanHandlers) {
  const t = useTranslations('contacts-attributes-tags.kanban');
  // A stage chosen in Filters narrows the board to that one column.
  const shown = filters.lifecycleStage
    ? stages.filter((s) => s.value === filters.lifecycleStage)
    : stages;
  const [over, setOver] = useState<string | null>(null);
  return (
    <div
      role="list"
      aria-label={t('board')}
      className="thin-scrollbar flex min-h-0 flex-1 gap-3 overflow-x-auto p-4"
    >
      {shown.map((stage) => (
        <Column
          key={stage.value}
          stage={stage}
          stages={stages}
          filters={filters}
          toView={toView}
          over={over === stage.value}
          onOver={(on) => setOver(on ? stage.value : null)}
          {...h}
        />
      ))}
    </div>
  );
}

function Column({
  stage,
  stages,
  filters,
  toView,
  over,
  onOver,
  onStageChange,
  stageBusyId,
}: {
  stage: Choice;
  stages: readonly Choice[];
  filters: ContactFilters;
  toView: (row: ContactRow) => RowView;
  over: boolean;
  onOver: (on: boolean) => void;
} & KanbanHandlers) {
  const t = useTranslations('contacts-attributes-tags.kanban');
  const q = useStageColumn(filters, stage.value);
  const rows = (q.data?.pages ?? []).flatMap((p) => p.data);
  const total = q.data?.pages[0]?.meta?.total;
  return (
    <section
      role="listitem"
      aria-label={stage.label}
      onDragOver={(e) => {
        if (!onStageChange || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        onOver(true);
      }}
      onDragLeave={() => onOver(false)}
      onDrop={(e) => {
        onOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (!id || !onStageChange) return;
        e.preventDefault();
        if (!rows.some((r) => r.id === id)) onStageChange(id, stage.value);
      }}
      className={cn(
        'flex max-h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/40',
        over && 'border-brand bg-brand/5',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold">{stage.label}</h3>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {total ?? rows.length}
        </span>
      </header>
      <ul className="thin-scrollbar flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {q.isPending ? (
          <li className="flex justify-center p-4">
            <Spinner />
          </li>
        ) : q.isError ? (
          <li className="p-2 text-xs text-danger" role="alert">
            {t('failed')}{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void q.refetch()}
            >
              {t('retry')}
            </button>
          </li>
        ) : rows.length === 0 ? (
          <li className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {t('empty')}
          </li>
        ) : (
          rows.map((row) => (
            <Card
              key={row.id}
              view={toView(row)}
              stages={stages}
              busy={stageBusyId === row.id}
              onStageChange={onStageChange}
            />
          ))
        )}
        {q.hasNextPage && (
          <li className="flex justify-center py-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              {q.isFetchingNextPage && <Spinner />}
              {t('loadMore')}
            </Button>
          </li>
        )}
      </ul>
    </section>
  );
}

function Card({
  view,
  stages,
  busy,
  onStageChange,
}: {
  view: RowView;
  stages: readonly Choice[];
  busy: boolean;
  onStageChange?: (id: string, stage: string) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.kanban');
  const tl = useTranslations('contacts-attributes-tags.list');
  return (
    <li
      draggable={Boolean(onStageChange) && !busy}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, view.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'space-y-2 rounded-md border border-border bg-background p-3 text-sm shadow-sm',
        onStageChange && 'cursor-grab active:cursor-grabbing',
        busy && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <ContactAvatar id={view.id} name={view.name} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/contacts/${view.id}`}
            className="block truncate font-semibold hover:text-primary hover:underline"
          >
            {view.name || tl('unnamed')}
          </Link>
          <div className="truncate text-xs tabular-nums text-muted-foreground" dir="ltr">
            {view.phone || view.email || '-'}
          </div>
        </div>
        {view.optedOut && (
          <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
            {t('optedOut')}
          </span>
        )}
      </div>
      {view.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {view.tags.slice(0, 3).map((tag) => (
            <TagChip key={tag.id} name={tag.name} color={tag.color} />
          ))}
          {view.tags.length > 3 && (
            <MoreChip
              count={view.tags.length - 3}
              title={view.tags
                .slice(3)
                .map((x) => x.name)
                .join(', ')}
            />
          )}
        </div>
      )}
      {onStageChange && (
        <Select
          aria-label={t('moveTo', { name: view.name || tl('unnamed') })}
          value={view.stage}
          disabled={busy}
          onChange={(e) => onStageChange(view.id, e.target.value)}
          className="h-8 text-xs"
        >
          {stages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      )}
    </li>
  );
}
