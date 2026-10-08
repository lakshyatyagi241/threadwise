'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@crm/ui';

/** Print / Save as PDF, Copy as Markdown, Download JSON for the report on screen. */
export function ReportActions({
  markdown,
  json,
  fileName,
}: {
  markdown: string;
  json: unknown;
  fileName: string;
}) {
  const t = useTranslations('report-copilot.report');
  const [note, setNote] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (n: 'copied' | 'failed') => {
    setNote(n);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), 2500);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      flash('copied');
    } catch {
      flash('failed');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div role="group" aria-label={t('actions.label')} className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => window.print()}>
        {t('actions.print')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void copy()}>
        {t('actions.copy')}
      </Button>
      <Button size="sm" variant="secondary" onClick={download}>
        {t('actions.download')}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {note === 'copied' ? t('actions.copied') : note === 'failed' ? t('actions.copyFailed') : ''}
      </span>
    </div>
  );
}
