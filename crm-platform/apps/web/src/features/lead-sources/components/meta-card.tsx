'use client';

import { useTranslations } from 'next-intl';
import { Badge, Button, Card } from '@crm/ui';
import { useMetaOverview } from '../meta-api';
import { metaSummary } from '../lib/meta-view';
import { META_PANEL_ID } from './meta-panel';

/**
 * The "Meta lead forms" card of the Ads tab. It is a real provider (unlike LinkedIn, TikTok and Google Ads, which are still coming
 * soon): it says how many Pages and forms are connected and opens or closes the panel below the cards.
 */
export function MetaCard({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useTranslations('lead-sources');
  const overview = useMetaOverview(true);
  const s = overview.data ? metaSummary(overview.data) : null;

  let status: string;
  if (overview.isPending) status = t('meta.card.checking');
  else if (overview.isError || !s) status = t('meta.card.unavailable');
  else if (!s.configured) status = t('meta.card.notConfigured');
  else if (s.pages === 0) status = t('meta.card.noPages');
  else status = t('meta.card.summary', { pages: s.pages, forms: s.forms });

  return (
    <Card className="flex h-full flex-col gap-3 p-5" data-testid="provider-meta">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">{t('ads.providers.meta.name')}</h2>
        <Badge tone="success">{t('ads.available')}</Badge>
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{t('ads.providers.meta.body')}</p>
      <p className="text-xs text-muted-foreground" data-testid="meta-card-status">
        {status}
      </p>
      {s && s.attention > 0 && (
        <Badge tone="warning" className="self-start" data-testid="meta-card-attention">
          {t('meta.card.attention', { count: s.attention })}
        </Badge>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          aria-expanded={open}
          aria-controls={META_PANEL_ID}
          onClick={onToggle}
          data-testid="meta-card-toggle"
        >
          {open ? t('meta.card.close') : t('meta.card.open')}
        </Button>
      </div>
    </Card>
  );
}
