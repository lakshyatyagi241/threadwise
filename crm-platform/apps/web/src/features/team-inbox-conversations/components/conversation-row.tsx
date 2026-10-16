'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { memo, useState } from 'react';
import { Popover, cn } from '@crm/ui';
import {
  CONVERSATION_PRIORITIES,
  type ConversationPriority,
  type ConversationSummary,
} from '@crm/contracts';
import { badgeText } from '../lib/list';
import { fullStamp, listTime } from '../lib/time';
import { formatWindowLeft, rowWindowChip } from '../lib/window';
import { TagChip } from './tag-chip';
import { SlaBadge } from './sla-badge';
import { Avatar, ChannelTag } from './parts';
import { FlagIcon, MoreIcon, PinIcon } from './icons';

export interface ConversationRowProps {
  row: ConversationSummary;
  active: boolean;
  nowMs: number;
  showChannel: boolean;
  onOpen: (id: string) => void;
  /** Selection mode: a click picks the row (shift picks the run up to it) instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (id: string, shift: boolean) => void;
  /** Present when the caller may change priority: shows the row's three-dot menu. */
  onPriority?: (row: ConversationSummary, priority: ConversationPriority) => void;
}

/** True when the last message in the thread went out (so the preview starts with "You:"). */
export function lastWasOutbound(
  row: Pick<ConversationSummary, 'lastInboundAt' | 'lastOutboundAt'>,
): boolean {
  if (!row.lastOutboundAt) return false;
  if (!row.lastInboundAt) return true;
  return row.lastOutboundAt >= row.lastInboundAt;
}

/**
 * One conversation in the list: avatar, name, time, the last message with who said it, the unread badge and the chips that
 * matter (window closing, snoozed, assignee, priority). Memoised: a list of hundreds re-renders only the row that changed.
 */
export const ConversationRow = memo(function ConversationRow({
  row,
  active,
  nowMs,
  showChannel,
  onOpen,
  selecting = false,
  selected = false,
  onSelect,
  onPriority,
}: ConversationRowProps) {
  const [menu, setMenu] = useState(false);
  const t = useTranslations('team-inbox-conversations.list');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const unread = row.unreadCount > 0;
  const outbound = lastWasOutbound(row);
  const chip = rowWindowChip(row.windowExpiresAt, nowMs);
  const left = chip?.msLeft != null ? formatWindowLeft(chip.msLeft) : null;
  const assignee = row.assignment.user?.name ?? row.assignment.team?.name ?? null;

  const label = [
    row.title,
    unread ? t('unreadCount', { count: row.unreadCount }) : null,
    row.imported ? t('imported') : null,
    row.preview,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li className="group relative">
      <button
        type="button"
        data-testid="inbox-row"
        data-conversation-id={row.id}
        {...(selecting
          ? { role: 'checkbox' as const, 'aria-checked': selected }
          : { 'aria-current': active ? ('true' as const) : undefined })}
        aria-label={label}
        onClick={(e) => (selecting ? onSelect?.(row.id, e.shiftKey) : onOpen(row.id))}
        className={cn(
          'flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
          selected ? 'bg-primary/10' : active && !selecting ? 'bg-muted' : 'hover:bg-muted/60',
        )}
      >
        {selecting && (
          <span
            aria-hidden="true"
            data-testid="inbox-row-check"
            className={cn(
              'mt-2.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background',
            )}
          >
            {selected ? '✓' : ''}
          </span>
        )}
        <Avatar id={row.id} name={row.title} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              dir="auto"
              className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}
            >
              {row.title}
            </span>
            {showChannel && (
              <ChannelTag decorative kind={row.channel.kind} name={row.channel.name} />
            )}
            <span className="ms-auto flex shrink-0 items-center gap-1.5">
              {row.pinned && <PinIcon width={12} height={12} className="text-primary" />}
              {unread && (
                <span
                  data-testid="inbox-unread-badge"
                  aria-hidden="true"
                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                >
                  {badgeText(row.unreadCount)}
                </span>
              )}
              <time
                dateTime={row.lastMessageAt ?? undefined}
                title={fullStamp(row.lastMessageAt, locale, timeZone)}
                className={cn(
                  'whitespace-nowrap text-[11px]',
                  unread ? 'font-medium text-primary' : 'text-muted-foreground',
                )}
              >
                {listTime(row.lastMessageAt, nowMs, locale, timeZone)}
              </time>
            </span>
          </span>
          <span
            className={cn(
              'mt-0.5 flex items-center gap-1 text-xs',
              unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {outbound && <span className="shrink-0 text-muted-foreground">{t('you')}</span>}
            <span dir="auto" className="truncate">
              {row.preview ?? t('noMessages')}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {showChannel && (
              <span
                data-testid="inbox-row-channel"
                className="max-w-[9rem] truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {row.channel.name}
              </span>
            )}
            {row.imported && (
              <span
                data-testid="inbox-row-imported"
                title={t('importedHint')}
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {t('imported')}
              </span>
            )}
            <SlaBadge status={row.slaStatus} nowMs={nowMs} compact />
            {row.labels.slice(0, 2).map((l) => (
              <TagChip key={l.id} tag={l} />
            ))}
            {row.labels.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{row.labels.length - 2}</span>
            )}
            {chip && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  chip.state === 'closed'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-warning/15 text-warning',
                )}
              >
                {chip.state === 'closed'
                  ? t('windowClosed')
                  : left && left.hours >= 1
                    ? t('windowLeftHours', { hours: left.hours, minutes: left.minutes })
                    : t('windowLeftMinutes', { minutes: left?.minutes ?? 0 })}
              </span>
            )}
            {row.status !== 'open' && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t(`status.${row.status}`)}
              </span>
            )}
            {row.priority !== 'normal' && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {t(`priority.${row.priority}`)}
              </span>
            )}
            {assignee ? (
              <span className="max-w-[9rem] truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {assignee}
              </span>
            ) : (
              <span className="rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t('unassigned')}
              </span>
            )}
            {row.needsContact && (
              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                {t('needsContact')}
              </span>
            )}
          </span>
        </span>
      </button>
      {onPriority && !selecting && (
        <div className="absolute end-2 top-8">
          <button
            type="button"
            data-testid="inbox-row-more"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={t('rowMenu', { name: row.title })}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMenu((v) => !v)}
            className={cn(
              'grid size-6 place-items-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary',
              menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 max-md:opacity-100',
            )}
          >
            <MoreIcon className="size-3.5" />
          </button>
          <Popover
            open={menu}
            onClose={() => setMenu(false)}
            label={t('priorityMenu')}
            className="w-40 space-y-0.5 p-1"
          >
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('priorityMenu')}
            </p>
            {CONVERSATION_PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={row.priority === p}
                data-testid={`inbox-row-priority-${p}`}
                onClick={() => {
                  setMenu(false);
                  onPriority(row, p);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
                  row.priority === p && 'font-semibold',
                )}
              >
                <FlagIcon
                  className={cn(
                    'size-4',
                    p === 'urgent'
                      ? 'text-danger'
                      : p === 'high'
                        ? 'text-warning'
                        : p === 'low'
                          ? 'text-muted-foreground'
                          : 'text-primary',
                  )}
                />
                <span className="flex-1">{t(`priority.${p}`)}</span>
                {row.priority === p && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </Popover>
        </div>
      )}
    </li>
  );
});
