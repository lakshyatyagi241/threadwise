'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Menu, MenuItem, MenuLabel, MenuRadioItem, MenuSeparator, cn } from '@crm/ui';
import type { Deal, Stage } from '../api/schemas';
import { ageParts, dueState, formatDay } from '../lib/format';
import { formatMoney } from '../lib/money';
import { Avatar, StatusChip, useSourceLabel } from './parts';
import { CalendarIcon, DotsIcon, TrashIcon } from './icons';

export interface DealCardProps {
  deal: Deal;
  stage: Stage;
  /** Every stage of the pipeline, for the "Move to" menu. */
  stages: readonly Stage[];
  canWrite: boolean;
  canDelete: boolean;
  dragging: boolean;
  onOpen: (id: string) => void;
  onMove: (deal: Deal, stageId: string) => void;
  onDelete: (deal: Deal) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}

/** The colour of the thin probability bar: strong chances read green, weak ones neutral. */
const probabilityTone = (p: number) =>
  p >= 75 ? 'bg-success' : p >= 50 ? 'bg-warning' : 'bg-primary';

/**
 * One deal on the board. The card is draggable with a pointer; the "..." menu is the keyboard and touch way to do
 * the same (Move to), plus Won, Lost and Delete.
 */
export function DealCard({
  deal,
  stage,
  stages,
  canWrite,
  canDelete,
  dragging,
  onOpen,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
}: DealCardProps) {
  const t = useTranslations('deals-pipelines.card');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const sourceLabel = useSourceLabel();
  const age = ageParts(deal.createdAt);
  const due = deal.status === 'open' ? dueState(deal.expectedCloseDate) : null;
  const wonStage = stages.find((s) => s.kind === 'won');
  const lostStage = stages.find((s) => s.kind === 'lost');
  const contactName = deal.contact?.name || deal.contact?.phone || '';
  const closed = deal.status !== 'open';

  return (
    <article
      data-deal-id={deal.id}
      draggable={canWrite}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', deal.id);
        onDragStart(deal.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(deal.id)}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-background p-3 shadow-sm transition',
        'hover:border-primary/50 hover:shadow-md',
        canWrite && 'active:cursor-grabbing',
        dragging && 'opacity-40',
        deal.status === 'won' && 'border-success/40',
        deal.status === 'lost' && 'border-danger/30',
      )}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {closed ? (
          <StatusChip status={deal.status} />
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">
            {sourceLabel(deal.source)}
          </span>
        )}
        <span className="ms-auto tabular-nums">
          {age.unit === 'today' ? t('age.today') : t(`age.${age.unit}`, { n: age.n })}
        </span>
        {(canWrite || canDelete) && (
          // Stops the card's own click (open) and drag from reacting to the menu.
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Menu
              label={t('actions')}
              align="end"
              triggerClassName="size-7 border-transparent bg-transparent px-0 text-muted-foreground"
              triggerProps={{ 'aria-label': t('actions') }}
              trigger={<DotsIcon />}
            >
              <MenuItem onSelect={() => onOpen(deal.id)}>{t('open')}</MenuItem>
              {canWrite && (
                <>
                  <MenuSeparator />
                  <MenuLabel>{t('moveTo')}</MenuLabel>
                  {stages.map((s) => (
                    <MenuRadioItem
                      key={s.id}
                      checked={s.id === deal.stageId}
                      onSelect={() => s.id !== deal.stageId && onMove(deal, s.id)}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="truncate">{s.name}</span>
                      </span>
                    </MenuRadioItem>
                  ))}
                  {(wonStage || lostStage) && <MenuSeparator />}
                  {wonStage && deal.status !== 'won' && (
                    <MenuItem onSelect={() => onMove(deal, wonStage.id)}>{t('markWon')}</MenuItem>
                  )}
                  {lostStage && deal.status !== 'lost' && (
                    <MenuItem onSelect={() => onMove(deal, lostStage.id)}>{t('markLost')}</MenuItem>
                  )}
                </>
              )}
              {canDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem danger onSelect={() => onDelete(deal)}>
                    <TrashIcon /> {t('delete')}
                  </MenuItem>
                </>
              )}
            </Menu>
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(deal.id);
        }}
        draggable={false}
        className="mt-1.5 block w-full text-start text-sm font-semibold leading-snug outline-none focus-visible:underline"
      >
        <span className="line-clamp-2">{deal.title}</span>
      </button>

      <div className="mt-1 truncate text-xs text-muted-foreground">
        {contactName || t('noContact')}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {formatMoney(deal.valueMinor, deal.currency, locale)}
        </span>
        <span className="ms-auto flex items-center gap-2">
          {due && deal.expectedCloseDate && (
            <span
              title={t(`due.${due}`)}
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
                due === 'overdue' && 'bg-danger/15 text-danger',
                due === 'today' && 'bg-warning/15 text-warning',
                due === 'upcoming' && 'bg-muted text-muted-foreground',
              )}
            >
              <CalendarIcon className="size-3" />
              <span className="sr-only">{t(`due.${due}`)}: </span>
              {formatDay(deal.expectedCloseDate, locale, timeZone)}
            </span>
          )}
          {deal.owner ? (
            <span title={deal.owner.name}>
              <Avatar name={deal.owner.name} />
              <span className="sr-only">{deal.owner.name}</span>
            </span>
          ) : (
            <span
              title={t('unassigned')}
              className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground"
            >
              <span aria-hidden="true">?</span>
              <span className="sr-only">{t('unassigned')}</span>
            </span>
          )}
        </span>
      </div>

      {deal.status === 'open' && stage.probability > 0 && stage.probability < 100 && (
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 bg-muted"
          role="img"
          aria-label={t('probability', { n: stage.probability })}
        >
          <div
            className={cn('h-full', probabilityTone(stage.probability))}
            style={{ width: `${stage.probability}%` }}
          />
        </div>
      )}
    </article>
  );
}
