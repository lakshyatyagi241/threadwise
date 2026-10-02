'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, Spinner, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { exportBroadcast } from '../api/broadcasts';
import { useBroadcastRecipients } from '../api/detail';
import { RECIPIENT_STATUSES } from '../lib/detail-model';
import { downloadBlob } from '../lib/download';
import { DownloadIcon } from './icons';
import { RecipientsTable } from './recipients-table';

/** Recipients tab (WD-BCAST-032): name/phone search and a status filter (both applied by the API), the export, and the rows. */
export function RecipientsTab({
  id,
  timezone,
  canExport,
}: {
  id: string;
  timezone: string | null;
  canExport: boolean;
}) {
  const t = useTranslations('broadcasts.detail.recipients');
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('');

  // The search applies 220 ms after typing stops, without a reload.
  useEffect(() => {
    const h = window.setTimeout(() => setApplied(q.trim()), 220);
    return () => window.clearTimeout(h);
  }, [q]);

  const list = useBroadcastRecipients(id, { status, q: applied });

  const exportRows = async () => {
    try {
      const { blob, filename } = await exportBroadcast(id);
      downloadBlob(filename, blob);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('exportFailed'), 'danger');
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h2 className="mt-1 text-[22px] leading-tight">{t('title')}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-9 w-full rounded-full text-xs sm:w-[240px]"
          />
          {canExport && (
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => void exportRows()}
            >
              <DownloadIcon className="size-3.5" />
              {t('export')}
            </Button>
          )}
          <Select
            aria-label={t('status')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 w-auto rounded-full text-xs"
          >
            <option value="">{t('allStatuses')}</option>
            {RECIPIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {list.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner label={t('loading')} />
        </div>
      ) : (
        <RecipientsTable rows={list.items} timezone={timezone} empty={t('empty')} />
      )}
      {list.hasNextPage && (
        <div className="flex justify-center border-t border-border p-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? t('loading') : t('more')}
          </Button>
        </div>
      )}
    </div>
  );
}
