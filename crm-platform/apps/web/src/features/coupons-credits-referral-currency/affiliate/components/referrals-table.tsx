'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { ReferralRow } from '@crm/contracts';
import { Button, EmptyState, cn } from '@crm/ui';
import { AVATAR_GRADIENTS, avatarIndex, initialsOf, plusMoney, txLabel } from '../lib/format';

/** Five gradient pairs from the colour tokens (Reference picked from a five-entry palette by the referee's id). */
const GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['--brand', '--primary'],
  ['--primary', '--success'],
  ['--warning', '--danger'],
  ['--sidebar-active', '--brand'],
  ['--success', '--brand'],
];
if (GRADIENTS.length !== AVATAR_GRADIENTS) throw new Error('avatar palette out of step');

export function Avatar({ id, name }: { id: string; name: string }) {
  const [from, to] = GRADIENTS[avatarIndex(id)]!;
  return (
    <span
      aria-hidden="true"
      data-avatar={avatarIndex(id)}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-brand-foreground"
      style={{ backgroundImage: `linear-gradient(135deg, var(${from}), var(${to}))` }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Paid / No payout. The account tab's "active" pill told nothing about the payout; both screens show this one. */
export function StatusPill({ status }: { status: ReferralRow['status'] }) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.table.status');
  const paid = status === 'paid';
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        paid ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 rounded-full', paid ? 'bg-success' : 'bg-border')}
      />
      {paid ? t('paid') : t('noPayout')}
    </span>
  );
}

/** The rows of the history table, or the empty state with its Reset. */
export function ReferralsTable({
  rows,
  currency,
  now,
  onReset,
}: {
  rows: ReferralRow[];
  currency: string;
  now: Date;
  onReset: () => void;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.table');
  const format = useFormatter();
  const locale = useLocale();
  return (
    <div className="flex-1 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-start font-medium">
              {t('when')}
            </th>
            <th scope="col" className="px-2 py-2.5 text-start font-medium">
              {t('referee')}
            </th>
            <th scope="col" className="px-2 py-2.5 text-start font-medium">
              {t('codeUsed')}
            </th>
            <th scope="col" className="px-2 py-2.5 text-start font-medium">
              {t('credits')}
            </th>
            <th scope="col" className="px-2 py-2.5 text-start font-medium">
              {t('statusHeading')}
            </th>
            <th scope="col" className="px-4 py-2.5 text-end font-medium">
              {t('walletTx')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-4">
                <EmptyState
                  title={t('empty')}
                  actions={
                    <Button variant="secondary" size="sm" onClick={onReset}>
                      {t('reset')}
                    </Button>
                  }
                />
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const tx = txLabel(r.walletTxId);
              const at = new Date(r.createdAt);
              return (
                <tr key={r.id} data-row={r.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    <div>{format.dateTime(at, { dateStyle: 'medium' })}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {format.relativeTime(at, now)}
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar id={r.id} name={r.refereeName} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.refereeName}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {r.refereeEmail ?? '—'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3 font-mono text-xs">{r.codeUsed}</td>
                  <td className="px-2 py-3 font-mono text-sm font-semibold text-success">
                    {plusMoney(r.creditsAwardedMinor, currency, locale)}
                  </td>
                  <td className="px-2 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-end font-mono text-xs text-muted-foreground">
                    {tx ?? '—'}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
