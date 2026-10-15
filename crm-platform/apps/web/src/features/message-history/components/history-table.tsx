'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { MessageHistoryRow } from '@crm/contracts';
import { dayLabel, timeLabel } from '../lib/format';
import { Avatar, DirectionMark, EyeIcon, StatusMark, TypePill, rowName } from './parts';

/** Reference's "Open" eye: a campaign, broadcast or scheduled row goes to that screen, everything else to the conversation. */
export function openHref(row: MessageHistoryRow): string | null {
  if (row.entity) {
    const base = { broadcast: '/broadcasts', campaign: '/campaigns', scheduled: '/scheduled' }[
      row.entity.kind
    ];
    return `${base}/${row.entity.id}`;
  }
  return row.conversationId ? `/inbox?c=${row.conversationId}` : null;
}

interface Props {
  rows: MessageHistoryRow[];
  tz: string;
  selected: string;
  onOpen: (id: string) => void;
}

/**
 * The message table: When, Dir, Contact, Message, Type, Status, Open (Reference's columns, minus its select-all box, which had no
 * action). A row opens the drawer; the eye goes to the source. The number is already masked by the API for a caller who may not read
 * the contact. The text is customer-written, so it is marked for the help assistant to leave out.
 */
export function HistoryTable({ rows, tz, selected, onOpen }: Props) {
  const t = useTranslations('message-history.table');
  const locale = useLocale();
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]" data-testid="history-table">
        <thead className="border-b border-border bg-muted/50 text-muted-foreground">
          <tr>
            {(['when', 'dir', 'contact', 'message', 'type', 'status'] as const).map((c) => (
              <th
                key={c}
                scope="col"
                className="px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
              >
                {t(`col.${c}`)}
              </th>
            ))}
            <th
              scope="col"
              className="px-3 py-2.5 text-end font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
            >
              {t('col.open')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const name = rowName(r, t('unknown'));
            const href = openHref(r);
            return (
              <tr
                key={r.id}
                data-testid="history-row"
                data-id={r.id}
                aria-selected={selected === r.id}
                onClick={() => onOpen(r.id)}
                className="cursor-pointer hover:bg-muted/50 aria-selected:bg-muted"
              >
                <td className="px-3 py-3 font-mono text-[11px]">
                  <div>{timeLabel(r.at, locale, tz)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {dayLabel(r.at, now, locale, tz)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <DirectionMark row={r} />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={name} seed={r.id} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r.id);
                        }}
                        className="block max-w-[200px] truncate text-start font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span data-agent-ignore>{name}</span>
                      </button>
                      <div
                        className="font-mono text-[10.5px] text-muted-foreground"
                        title={r.recipient.masked ? t('masked') : undefined}
                      >
                        {r.recipient.value ?? '—'}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="max-w-[280px] truncate px-3 py-3 text-foreground/80">
                  {r.mediaName && (
                    <span className="me-1.5 inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {r.mediaName}
                    </span>
                  )}
                  <span data-agent-ignore>
                    {r.preview ??
                      (r.entity ? t(`entity.${r.entity.kind}`, { name: r.entity.name }) : '—')}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <TypePill type={r.type} />
                </td>
                <td className="px-3 py-3">
                  <StatusMark status={r.status} />
                </td>
                <td className="px-3 py-3 text-end">
                  {href && (
                    <Link
                      href={href}
                      onClick={(e) => e.stopPropagation()}
                      title={t('openSource')}
                      aria-label={t('openSourceFor', { name })}
                      className="inline-flex size-7 items-center justify-center rounded-full text-brand hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <EyeIcon />
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
