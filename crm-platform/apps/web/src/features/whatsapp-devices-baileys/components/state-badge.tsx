'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@crm/ui';
import { reasonKey, stateBadge } from '../lib/state-model';

/** The status pill of a number, from the eight connection states (spec 8). A state this build does not know reads "Unknown". */
export function StateBadge({ state }: { state: string }) {
  const t = useTranslations('whatsapp-devices-baileys');
  const b = stateBadge(state);
  return (
    <Badge tone={b.tone} data-state={state}>
      {t(b.labelKey)}
    </Badge>
  );
}

/** The honest sentence for why a number is in its state (spec 8.3), or nothing when the server gave no reason we have words for. */
export function ReasonText({
  reason,
  className,
}: {
  reason: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations('whatsapp-devices-baileys');
  const key = reasonKey(reason);
  if (!key) return null;
  return <p className={className ?? 'text-xs text-muted-foreground'}>{t(key)}</p>;
}
