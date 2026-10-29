'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { KEYS, customerApi } from '../../api';

/** Hides everything but the invoice when the page is printed, so Print and "save as PDF" give one clean document. */
const PRINT_CSS = `
@media print {
  @page { margin: 10mm; size: A4; }
  .no-print { display: none !important; }
  .legacy-invoice-frame { border: 0 !important; height: 1100px !important; }
}`;

/**
 * A migrated top-up's invoice, as the old system's billing provider issued it. It is a whole HTML page that came from outside this
 * application, so it is shown in a frame with every sandbox restriction on (no scripts, no forms, no navigation, no same-origin
 * access) and without a referrer: whatever the page contains cannot run or reach this one.
 */
export function LegacyInvoicePage({ id }: { id: string }) {
  const t = useTranslations('wallet-message-billing.legacyInvoice');
  const q = useQuery({
    queryKey: KEYS.legacyInvoice(id),
    queryFn: ({ signal }) => customerApi.legacyInvoice(id, signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      <style>{PRINT_CSS}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm underline" href="/billing/wallet/statement">
          {t('back')}
        </Link>
        <Button type="button" onClick={() => window.print()}>
          {t('print')}
        </Button>
      </div>
      <iframe
        className="legacy-invoice-frame h-[80vh] w-full rounded-md border border-border bg-white"
        title={q.data.number ? `${t('title')} ${q.data.number}` : t('title')}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={q.data.html}
        data-testid="legacy-invoice-frame"
      />
    </div>
  );
}
