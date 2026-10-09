'use client';

import { useTranslations } from 'next-intl';
import type { TplMetaCategory, TplStatus } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { categoryTone, qualityTone, statusTone } from '../lib/status-model';

export function StatusBadge({ status }: { status: TplStatus }) {
  const t = useTranslations('message-templates.status');
  return (
    <Badge tone={statusTone(status)} data-testid="status-badge" data-status={status}>
      {t(status)}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: TplMetaCategory | null }) {
  const t = useTranslations('message-templates.category');
  if (!category) return null;
  return (
    <Badge tone={categoryTone(category)} data-testid="category-badge">
      {t(category)}
    </Badge>
  );
}

/** Meta's quality score. Shown only when Meta has rated the template. */
export function QualityBadge({ score }: { score: string | null }) {
  const t = useTranslations('message-templates.quality');
  const key = (score ?? '').toUpperCase();
  if (!key) return null;
  return (
    <Badge tone={qualityTone(score)} data-testid="quality-badge">
      {t.has(key) ? t(key) : key}
    </Badge>
  );
}

const PILL: Record<TplMetaCategory, string> = {
  MARKETING: 'bg-warning/15 text-warning',
  UTILITY: 'bg-success/15 text-success',
  AUTHENTICATION: 'bg-primary/15 text-primary',
};

/** Reference's small category tag in the corner of a card. */
export function CategoryPill({ category }: { category: TplMetaCategory | null }) {
  const t = useTranslations('message-templates.category');
  if (!category) return null;
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${PILL[category]}`}
      data-testid="category-badge"
    >
      {t(category)}
    </span>
  );
}
