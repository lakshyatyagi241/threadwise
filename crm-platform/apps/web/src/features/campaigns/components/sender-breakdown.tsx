'use client';

import { useTranslations } from 'next-intl';
import type { SenderBreakdownLine } from '@crm/contracts';

/**
 * A send that was shared across several numbers, number by number: how many recipients each was given and how many of them were sent,
 * delivered and failed. Nothing is shown for a send from one number (the API sends no lines then).
 */
export function SenderBreakdown({ lines }: { lines: readonly SenderBreakdownLine[] | undefined }) {
  const t = useTranslations('campaigns.senderBreakdown');
  if (!lines || lines.length < 2) return null;
  return (
    <div
      className="overflow-x-auto rounded-2xl border border-border bg-background p-5 shadow-sm"
      data-testid="sender-breakdown"
    >
      <h3 className="mb-1 text-lg">{t('title')}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('hint')}</p>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-start text-muted-foreground">
            {(['number', 'recipients', 'sent', 'delivered', 'failed'] as const).map((k) => (
              <th
                key={k}
                className="px-3 py-2 text-start font-mono text-[10px] uppercase tracking-wide"
              >
                {t(`cols.${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key ?? `gone-${i}`} className="border-t border-border/60">
              <td className="px-3 py-2 font-semibold">{l.key === null ? t('removed') : l.label}</td>
              <td className="px-3 py-2 tabular-nums">{l.recipients}</td>
              <td className="px-3 py-2 tabular-nums">{l.sent}</td>
              <td className="px-3 py-2 tabular-nums">{l.delivered}</td>
              <td className="px-3 py-2 tabular-nums">{l.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
