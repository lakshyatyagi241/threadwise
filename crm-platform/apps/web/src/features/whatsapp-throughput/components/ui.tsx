'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { watErrorKey } from '../lib/errors';

const NS = 'whatsapp-throughput';

export function LoadingBlock() {
  const t = useTranslations(`${NS}.common`);
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
      <Spinner label={t('loading')} />
      <span className="text-sm">{t('loading')}</span>
    </div>
  );
}

/** A failed read or write, in the operator's language. A read offers a retry. */
export function Failure({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(NS);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{t(`errors.${watErrorKey(error)}`)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </Alert>
  );
}

/** A thin meter: `value` and `max` are numbers, the fill is clipped to the track. */
export function Meter({
  value,
  max,
  tone,
  label,
}: {
  value: number;
  max: number;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  const fill =
    tone === 'danger'
      ? 'bg-danger'
      : tone === 'warning'
        ? 'bg-warning'
        : tone === 'success'
          ? 'bg-success'
          : 'bg-muted-foreground/50';
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-border"
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
