'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@crm/ui';

/** TW-WABA-013: green = wired, coral = known broken, grey = not proven yet. The tooltip says what to do. */
export function InboundBadge({ wired }: { wired: boolean | null }) {
  const t = useTranslations('whatsapp-cloud-api-waba.card');
  if (wired === true)
    return (
      <Badge tone="success" title={t('inboundWiredHint')}>
        {t('inboundWired')}
      </Badge>
    );
  if (wired === false)
    return (
      <Badge tone="danger" title={t('inboundNotWiredHint')}>
        {t('inboundNotWired')}
      </Badge>
    );
  return (
    <Badge tone="neutral" title={t('inboundUnknownHint')}>
      {t('inboundUnknown')}
    </Badge>
  );
}
