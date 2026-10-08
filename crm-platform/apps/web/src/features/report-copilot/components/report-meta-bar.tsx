'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import type { ReportMeta } from '../lib/canvas';

/** "Generated 14:05 from 3 documents" and the Refresh data button, which asks the assistant the original question again. */
export function ReportMetaBar({
  meta,
  running,
  onRefresh,
}: {
  meta: ReportMeta;
  running: boolean;
  onRefresh: (prompt: string) => void;
}) {
  const t = useTranslations('report-copilot.report.meta');
  const locale = useLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(meta.generatedAt),
  );
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
      data-testid="report-meta"
    >
      <span>{t('generated', { time, count: meta.documents })}</span>
      <Button
        size="sm"
        variant="secondary"
        disabled={running || !meta.prompt}
        title={t('refreshHint')}
        onClick={() => meta.prompt && onRefresh(meta.prompt)}
      >
        {running ? t('refreshing') : t('refresh')}
      </Button>
    </div>
  );
}
