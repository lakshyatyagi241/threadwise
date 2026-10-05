'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { StoreDashboard } from '@crm/contracts';
import { formatRelative } from '@/features/auth-registration-security/shared/relative-time';
import { money } from '../../lib/model';
import { EmptyRow, Pill, ROW, TD, TH, TableFrame } from '../ui';

/** The orders tab (TW-ECOM-023): order, customer, status, total and when it was placed. */
export function OrdersTab({ data }: { data: StoreDashboard }) {
  const t = useTranslations('ecom.orders');
  const locale = useLocale();
  const [now] = useState(() => new Date().getTime());
  return (
    <TableFrame>
      <thead>
        <tr>
          <th className={TH}>{t('order')}</th>
          <th className={TH}>{t('customer')}</th>
          <th className={TH}>{t('status')}</th>
          <th className={TH}>{t('total')}</th>
          <th className={TH}>{t('placed')}</th>
        </tr>
      </thead>
      <tbody>
        {data.orders.length === 0 ? (
          <EmptyRow cols={5}>{t('none')}</EmptyRow>
        ) : (
          data.orders.map((o, i) => (
            <tr key={`${o.name}-${i}`} className={ROW}>
              <td className={`${TD} font-medium`}>{o.name}</td>
              <td className={TD}>{o.customer}</td>
              <td className={TD}>
                <Pill status={o.status ?? ''} label={o.status ?? '—'} />
              </td>
              <td className={`${TD} tabular-nums`}>
                {money(o.total, o.currency || data.currency)}
              </td>
              <td className={`${TD} text-muted-foreground`}>
                {o.createdAt ? formatRelative(o.createdAt, now, locale) : '—'}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </TableFrame>
  );
}
