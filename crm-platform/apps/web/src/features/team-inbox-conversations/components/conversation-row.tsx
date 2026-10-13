'use client';

import { useLocale, useTranslations } from 'next-intl';
import { memo } from 'react';
import { cn } from '@crm/ui';
import type { ConversationSummary } from '@crm/contracts';
import { badgeText } from '../lib/list';
import { fullStamp, listTime } from '../lib/time';
import { formatWindowLeft, rowWindowChip } from '../lib/window';
import { Avatar, ChannelTag } from './parts';
import { PinIcon } from './icons';

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
}: ConversationRowProps) {
  const t = useTranslations('team-inbox-conversations.list');
  const locale = useLocale();
  const unread = row.unreadCount > 0;
  const outbound = lastWasOutbound(row);
  const chip = rowWindowChip(row.windowExpiresAt, nowMs);
  const left = chip?.msLeft != null ? formatWindowLeft(chip.msLeft) : null;
  const assignee = row.assignment.user?.name ?? row.assignment.team?.name ?? null;

  const label = [
    row.title,
    unread ? t('unreadCount', { count: row.unreadCount }) : null,
    row.preview,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li>
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
                title={fullStamp(row.lastMessageAt, locale)}
                className={cn(
                  'whitespace-nowrap text-[11px]',
                  unread ? 'font-medium text-primary' : 'text-muted-foreground',
                )}
              >
                {listTime(row.lastMessageAt, nowMs, locale)}
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
    </li>
  );
});
