'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { AuditLogEntry } from '@crm/contracts';
import { Badge, cn } from '@crm/ui';
import { fieldSummary } from '../lib/format';
import { ActorCell, SupportBadge, useAuditWords } from './audit-labels';

const ACTION_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  insert: 'success',
  delete: 'danger',
  update: 'neutral',
};

/**
 * The entries as a table: time in the viewer's time zone, who, what, which record (a link when the record has a screen), the request
 * it belongs to, the fields that changed (names only; the values are in the side panel) and a Details button.
 */
export function AuditTable({
  entries,
  selected,
  onOpen,
  timeZone,
}: {
  entries: AuditLogEntry[];
  selected: string;
  onOpen: (id: string) => void;
  timeZone: string;
}) {
  const t = useTranslations('audit-log');
  const locale = useLocale();
  const words = useAuditWords();
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[860px] text-sm">
        <caption className="sr-only">{t('table.caption', { zone: timeZone })}</caption>
        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
          <tr>
            {(['time', 'actor', 'action', 'record', 'changed', 'request'] as const).map((k) => (
              <th key={k} scope="col" className="px-3 py-2.5 text-start font-medium">
                {t(`table.${k}`)}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5 text-end font-medium">
              <span className="sr-only">{t('table.details')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((e) => {
            const fields = fieldSummary(e.changedFields);
            const label = `${words.action(e.action)} ${words.module(e.module)}`;
            return (
              <tr
                key={e.id}
                data-testid="audit-row"
                className={cn('hover:bg-muted/50', selected === e.id && 'bg-brand/5')}
              >
                <td className="whitespace-nowrap px-3 py-2.5 align-top">
                  <time dateTime={e.at} title={e.at}>
                    {fmt.format(new Date(e.at))}
                  </time>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <div className="space-y-1">
                    <ActorCell entry={e} compact={!e.actAs} />
                    <SupportBadge actAs={e.actAs} />
                  </div>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <Badge tone={ACTION_TONE[e.action] ?? 'neutral'}>{words.action(e.action)}</Badge>
                  <div dir="auto" className="mt-1 text-xs text-muted-foreground">
                    {words.module(e.module)}
                  </div>
                </td>
                <td className="px-3 py-2.5 align-top">
                  {e.record.href ? (
                    <Link
                      href={e.record.href}
                      className="font-mono text-xs text-brand hover:underline"
                    >
                      {e.recordId}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{e.recordId}</span>
                  )}
                </td>
                <td className="max-w-[16rem] px-3 py-2.5 align-top text-xs text-muted-foreground">
                  {fields.shown.length === 0 ? (
                    '-'
                  ) : (
                    <span dir="ltr" className="font-mono">
                      {fields.shown.join(', ')}
                      {fields.more > 0 ? ` +${fields.more}` : ''}
                    </span>
                  )}
                </td>
                <td className="max-w-[10rem] px-3 py-2.5 align-top">
                  <span
                    className="block truncate font-mono text-xs text-muted-foreground"
                    title={e.requestId ?? undefined}
                  >
                    {e.requestId ?? '-'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-end align-top">
                  <button
                    type="button"
                    onClick={() => onOpen(e.id)}
                    aria-label={t('table.openDetails', { what: label })}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('table.details')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
