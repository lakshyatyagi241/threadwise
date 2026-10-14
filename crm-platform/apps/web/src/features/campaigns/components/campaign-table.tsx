'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { Campaign } from '@crm/contracts';
import { can, deliveryRate } from '../lib/list-model';
import { LOOK, ROUND } from './campaign-card';
import {
  ChartIcon,
  DownloadIcon,
  EditIcon,
  PlayIcon,
  ResendIcon,
  StopIcon,
  TrashIcon,
} from './icons';

const TH =
  'whitespace-nowrap border-b border-border bg-muted px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-muted-foreground';
const NUM = 'px-3 py-3 text-end font-mono tabular-nums';
const SMALL = cn(ROUND, 'size-7');

/** The campaigns as a table (the "List" view): one row each with its numbers and the same actions as the block card. */
export function CampaignTable({
  items,
  picked,
  busy,
  canControl,
  canUpdate,
  canDelete,
  canExport,
  onSelect,
  onSelectAll,
  onCancel,
  onResume,
  onResend,
  onDelete,
  onExport,
}: {
  items: Campaign[];
  picked: string[];
  busy: string | null;
  canControl: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
  onSelect: (c: Campaign, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onCancel: (c: Campaign) => void;
  onResume: (c: Campaign) => void;
  onResend: (c: Campaign) => void;
  onDelete: (c: Campaign) => void;
  onExport: (c: Campaign) => void;
}) {
  const t = useTranslations('campaigns.list');
  const tc = useTranslations('campaigns.list.card');
  const deletable = items.filter((c) => can.delete(c.status));
  return (
    <div
      data-testid="campaigns-table"
      className="overflow-x-auto rounded-2xl border border-border bg-background shadow-sm"
    >
      <table className="w-full min-w-[60rem] border-collapse text-sm">
        <caption className="sr-only">{t('title')}</caption>
        <thead>
          <tr>
            {canDelete && (
              <th scope="col" className={cn(TH, 'w-10')}>
                {deletable.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label={t('selectPage')}
                    className="size-4 accent-[var(--primary)]"
                    checked={deletable.every((c) => picked.includes(c.id))}
                    onChange={(e) => onSelectAll(e.target.checked)}
                  />
                )}
              </th>
            )}
            <th scope="col" className={TH}>
              {t('col.name')}
            </th>
            <th scope="col" className={TH}>
              {t('col.status')}
            </th>
            <th scope="col" className={cn(TH, 'text-end')}>
              {tc('sent')}
            </th>
            <th scope="col" className={cn(TH, 'text-end')}>
              {tc('delivered')}
            </th>
            <th scope="col" className={cn(TH, 'text-end')}>
              {tc('read')}
            </th>
            <th scope="col" className={cn(TH, 'text-end')}>
              {tc('replied')}
            </th>
            <th scope="col" className={cn(TH, 'text-end')}>
              {tc('failed')}
            </th>
            <th scope="col" className={cn(TH, 'text-end')}>
              {tc('delivery')}
            </th>
            <th scope="col" className={TH}>
              {t('col.schedule')}
            </th>
            <th scope="col" className={cn(TH, 'text-end')}>
              <span className="sr-only">{t('col.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((c) => {
            const look = LOOK[c.status];
            const n = c.counts;
            const wizardDraft = c.wizard && c.status === 'draft';
            const editHref = wizardDraft
              ? `/campaigns/create?draft=${c.id}`
              : `/campaigns/${c.id}/edit`;
            const editable = c.wizard ? wizardDraft : can.edit(c.status);
            const off = busy === c.id || busy === 'bulk';
            return (
              <tr key={c.id} data-campaign-id={c.id} className="hover:bg-muted/50">
                {canDelete && (
                  <td className="px-3 py-3">
                    {can.delete(c.status) && (
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={picked.includes(c.id)}
                        aria-label={tc('select', { name: c.name })}
                        onChange={(e) => onSelect(c, e.target.checked)}
                      />
                    )}
                  </td>
                )}
                <td className="max-w-[16rem] px-3 py-3">
                  <Link
                    href={wizardDraft ? editHref : `/campaigns/${c.id}`}
                    className="block truncate font-semibold hover:underline"
                  >
                    {c.name}
                  </Link>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {tc(`type.${c.type}`)}
                    {c.templateName ? ` · ${c.templateName}` : ''}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11px]',
                      look.pill,
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', look.dot)} />
                    {tc(`status.${c.status}`)}
                  </span>
                </td>
                <td className={NUM}>{n.sent.toLocaleString()}</td>
                <td className={NUM}>{n.delivered.toLocaleString()}</td>
                <td className={NUM}>{n.read.toLocaleString()}</td>
                <td className={NUM}>{n.replies.toLocaleString()}</td>
                <td className={cn(NUM, n.failed > 0 && 'text-danger')}>
                  {n.failed.toLocaleString()}
                </td>
                <td className={cn(NUM, 'text-success')}>{deliveryRate(n).toFixed(1)}%</td>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-muted-foreground">
                  {c.scheduleType === 'scheduled' && c.sendDate
                    ? `${c.sendDate}${c.sendTime ? ` · ${c.sendTime}` : ''}`
                    : c.createdAt.slice(0, 10)}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {canControl && can.cancel(c.status) && (
                      <button
                        type="button"
                        disabled={off}
                        className={cn(SMALL, 'text-danger')}
                        title={tc('cancel')}
                        aria-label={tc('cancel')}
                        onClick={() => onCancel(c)}
                      >
                        <StopIcon className="size-3.5" />
                      </button>
                    )}
                    {canControl && can.resume(c.status) && (
                      <button
                        type="button"
                        disabled={off}
                        className={cn(SMALL, 'bg-brand text-brand-foreground hover:bg-brand/90')}
                        title={tc('resume')}
                        aria-label={tc('resume')}
                        onClick={() => onResume(c)}
                      >
                        <PlayIcon className="size-3" />
                      </button>
                    )}
                    <Link
                      href={`/campaigns/${c.id}`}
                      className={SMALL}
                      title={tc('analytics')}
                      aria-label={tc('analytics')}
                    >
                      <ChartIcon className="size-3.5" />
                    </Link>
                    {canExport && (
                      <button
                        type="button"
                        className={SMALL}
                        title={tc('export')}
                        aria-label={tc('export')}
                        onClick={() => onExport(c)}
                      >
                        <DownloadIcon className="size-3.5" />
                      </button>
                    )}
                    {canUpdate && editable && (
                      <Link
                        href={editHref}
                        className={cn(SMALL, 'text-foreground')}
                        title={tc('edit')}
                        aria-label={tc('edit')}
                      >
                        <EditIcon className="size-3.5" />
                      </Link>
                    )}
                    {canControl && can.resend(c.status) && (
                      <button
                        type="button"
                        disabled={off}
                        className={SMALL}
                        title={tc('resend')}
                        aria-label={tc('resend')}
                        onClick={() => onResend(c)}
                      >
                        <ResendIcon className="size-3.5" />
                      </button>
                    )}
                    {canDelete && can.delete(c.status) && (
                      <button
                        type="button"
                        disabled={off}
                        className={cn(
                          SMALL,
                          'text-muted-foreground hover:border-danger hover:bg-danger/10 hover:text-danger',
                        )}
                        title={tc('delete')}
                        aria-label={tc('delete')}
                        onClick={() => onDelete(c)}
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
