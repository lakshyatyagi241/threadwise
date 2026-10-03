'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { StoreDashboard } from '@crm/contracts';
import { money, type Kind } from '../../lib/model';
import { EmptyRow, ROW, TD, TH, TableFrame } from '../ui';

/** The customers tab (TW-ECOM-023): name, email, phone, order count and spend. */
export function CustomersTab({ kind, data }: { kind: Kind; data: StoreDashboard }) {
  const t = useTranslations('ecom.customers');
  const locale = useLocale();
  return (
    <TableFrame>
      <thead>
        <tr>
          <th className={TH}>{t('name')}</th>
          <th className={TH}>{t('email')}</th>
          <th className={TH}>{t('phone')}</th>
          <th className={TH}>{t('orders')}</th>
          {kind === 'shopify' && <th className={TH}>{t('spent')}</th>}
        </tr>
      </thead>
      <tbody>
        {data.customers.length === 0 ? (
          <EmptyRow cols={kind === 'shopify' ? 5 : 4}>
            {kind === 'shopify' ? t('none') : t('noneWoo')}
          </EmptyRow>
        ) : (
          data.customers.map((c, i) => (
            <tr key={`${c.email ?? c.phone ?? c.name}-${i}`} className={ROW}>
              <td className={`${TD} font-medium`}>{c.name}</td>
              <td className={TD}>{c.email ?? '—'}</td>
              <td className={TD}>{c.phone ?? '—'}</td>
              <td className={`${TD} tabular-nums`}>{c.ordersCount.toLocaleString(locale)}</td>
              {kind === 'shopify' && (
                <td className={`${TD} tabular-nums`}>{money(c.totalSpent, data.currency)}</td>
              )}
            </tr>
          ))
        )}
      </tbody>
    </TableFrame>
  );
}
