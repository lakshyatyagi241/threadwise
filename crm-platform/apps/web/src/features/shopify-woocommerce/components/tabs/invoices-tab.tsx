'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ECOM_INVOICE_TRIGGERS,
  type EcomInvoiceTrigger,
  type InvoiceSummary,
} from '@crm/contracts';
import { Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, saveInvoicePolicy, useInvoicePolicy, useStoreInvoices } from '../../api/ecom';
import type { Kind } from '../../lib/model';
import { EmptyRow, Pill, ROW, TD, TH, TableFrame, Panel, pillLink } from '../ui';

/** The invoice's derived status as the shared pill reads it. */
const STATUS_TONE: Record<string, string> = {
  paid: 'sent',
  issued: 'received',
  partially_paid: 'received',
  draft: 'skipped',
  overdue: 'failed',
  void: 'skipped',
};

function amount(inv: InvoiceSummary, locale: string): string {
  const n = Number(inv.amounts.total);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: inv.currency }).format(n);
  } catch {
    return `${inv.amounts.total} ${inv.currency}`;
  }
}

/**
 * The Invoices tab of a store (TW-ECOM-035): the workspace's invoice settings for this store type (automatic invoices on or off, the
 * event that makes one) and the invoices that came from the store's orders, read from the invoicing API filtered by source. Each row
 * opens the invoice in the invoicing screens.
 */
export function InvoicesTab({ kind, storeId }: { kind: Kind; storeId: string }) {
  const t = useTranslations('ecom.invoices');
  const locale = useLocale();
  const canRead = useCan('record.invoices.read');
  const canEdit = useCan('ecom.connect');
  const list = useStoreInvoices(kind, canRead);
  const rows = list.data?.data ?? [];
  const label = (s: string): string => t(`status_${s}` as never);

  return (
    <div className="space-y-5">
      <PolicyPanel kind={kind} storeId={storeId} canEdit={canEdit} />
      {!canRead ? (
        <Panel>
          <p className="text-sm text-muted-foreground">{t('forbidden')}</p>
        </Panel>
      ) : list.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <Panel>
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
            {t('error')}
            <button type="button" className={pillLink} onClick={() => void list.refetch()}>
              {t('retry')}
            </button>
          </div>
        </Panel>
      ) : (
        <>
          <TableFrame>
            <thead>
              <tr>
                <th className={TH}>{t('number')}</th>
                <th className={TH}>{t('buyer')}</th>
                <th className={TH}>{t('type')}</th>
                <th className={TH}>{t('status')}</th>
                <th className={TH}>{t('total')}</th>
                <th className={TH}>{t('issued')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow cols={6}>{t('none')}</EmptyRow>
              ) : (
                rows.map((inv) => (
                  <tr key={inv.id} className={ROW}>
                    <td className={`${TD} font-mono text-[12px]`}>
                      <Link href={`/invoices/${inv.id}`} className="text-brand hover:underline">
                        {inv.number ?? t('draft')}
                      </Link>
                    </td>
                    <td className={TD}>{inv.buyerName ?? inv.buyerEmail ?? '—'}</td>
                    <td className={TD}>{t(inv.docType)}</td>
                    <td className={TD}>
                      <Pill
                        status={STATUS_TONE[inv.status] ?? 'received'}
                        label={label(inv.status)}
                      />
                    </td>
                    <td className={`${TD} tabular-nums`}>{amount(inv, locale)}</td>
                    <td className={`${TD} text-muted-foreground`}>{inv.issueDate ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </TableFrame>
          <div>
            <Link href="/invoices" className={pillLink}>
              {t('viewAll')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function PolicyPanel({
  kind,
  storeId,
  canEdit,
}: {
  kind: Kind;
  storeId: string;
  canEdit: boolean;
}) {
  const t = useTranslations('ecom.invoices');
  const policy = useInvoicePolicy(kind, storeId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const save = async (body: { autoInvoice?: boolean; trigger?: EcomInvoiceTrigger }) => {
    setBusy(true);
    try {
      const next = await saveInvoicePolicy(kind, storeId, body);
      qc.setQueryData(KEYS.invoicePolicy(kind, storeId), next);
      toast(t('saved'), 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('saveFailed'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('policyTitle')}>
      {policy.isPending ? (
        <Spinner />
      ) : policy.isError ? (
        <div role="alert" className="text-sm text-danger">
          {t('policyLoadFailed')}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={policy.data.autoInvoice}
              disabled={!canEdit || busy}
              onChange={(e) => void save({ autoInvoice: e.target.checked })}
            />
            <span>
              <span className="block font-medium">{t('autoInvoice')}</span>
              <span className="block text-xs text-muted-foreground">{t('autoInvoiceHint')}</span>
            </span>
          </label>
          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{t('trigger')}</span>
            <select
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
              value={policy.data.trigger}
              disabled={!canEdit || busy || !policy.data.autoInvoice}
              onChange={(e) => void save({ trigger: e.target.value as EcomInvoiceTrigger })}
            >
              {ECOM_INVOICE_TRIGGERS.map((x) => (
                <option key={x} value={x}>
                  {t(x)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </Panel>
  );
}
