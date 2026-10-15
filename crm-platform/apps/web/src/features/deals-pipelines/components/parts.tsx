'use client';

import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import type { DealSource, DealStatus } from '../api/schemas';
import { avatarColor, initials } from '../lib/format';
import { errorKind } from '../lib/errors';

/** Two-letter circle for a person; the colour follows the name so it is the same everywhere. */
export function Avatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: avatarColor(name) }}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function useSourceLabel() {
  const t = useTranslations('deals-pipelines.sources');
  return (source: DealSource) => t(source);
}

export function StatusChip({ status }: { status: DealStatus }) {
  const t = useTranslations('deals-pipelines.status');
  return (
    <Badge tone={status === 'won' ? 'success' : status === 'lost' ? 'danger' : 'neutral'}>
      {t(status)}
    </Badge>
  );
}

/** A failed call, in our words (chosen by error code) plus the request id for support. */
export function ErrorLine({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('deals-pipelines.errors');
  const kind = errorKind(error);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{t(kind)}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** The sentence for a failed call, chosen by its error code (for toasts and inline lines). */
export function useErrorText() {
  const t = useTranslations('deals-pipelines.errors');
  return (error: unknown) => t(errorKind(error));
}

/**
 * What the signed-in person may do, from the permission keys the API defines: `record.deals.*` for deals and
 * `record.pipelines.*` for the pipeline editor. The server stays the authority and answers 403 where it must.
 */
export function useDealsCan() {
  const { permissions } = useSession();
  const has = (key: string) => key in permissions;
  return {
    read: has('record.deals.read'),
    create: has('record.deals.create'),
    update: has('record.deals.update'),
    remove: has('record.deals.delete'),
    report: has('record.deals.report'),
    editPipelines: has('record.pipelines.update'),
    createPipelines: has('record.pipelines.create'),
    deletePipelines: has('record.pipelines.delete'),
  };
}
