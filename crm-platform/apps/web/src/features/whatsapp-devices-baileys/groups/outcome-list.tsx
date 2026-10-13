'use client';

import { useTranslations } from 'next-intl';
import type { WaGroupParticipantResult } from '@crm/contracts';

/**
 * What became of each person a call could not finish (privacy settings, not on WhatsApp, already in, group full...), in words that say
 * what to do. WhatsApp's own status code is shown small for support, never branched on. A number is shown left to right.
 */
export function OutcomeList({ results }: { results: readonly WaGroupParticipantResult[] }) {
  const t = useTranslations('whatsapp-devices-baileys.groups.outcome');
  if (results.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm" data-testid="groups-outcomes">
      {results.map((r, i) => (
        <li key={`${r.number ?? 'id'}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
          <span dir="ltr" className="font-mono text-xs">
            {r.number ?? t('someone')}
          </span>
          <span className="text-muted-foreground">
            {t(r.outcome === 'ok' ? 'done' : r.outcome)}
          </span>
          {r.code && r.outcome !== 'ok' && (
            <span className="text-[11px] text-muted-foreground" dir="ltr">
              ({r.code})
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
