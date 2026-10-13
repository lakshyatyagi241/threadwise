'use client';

import { useTranslations } from 'next-intl';
import type { GrowthAudience } from '@crm/contracts';
import { Button, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useAudiences, useSyncAudience } from '../api/hooks';
import { errorKey } from '../lib/errors';
import {
  LoadError,
  Nothing,
  SectionCard,
  SkeletonRows,
  useFormatDate,
  useFormatNumber,
} from './parts';

/**
 * Audiences worked out from what contacts really did (opened, wrote, went quiet, look likely to convert). Syncing one fills a contact
 * group of the same name, so a campaign can be sent to it; the group is rebuilt on each sync and kept fresh daily once it exists.
 */
export function AudiencesTab() {
  const t = useTranslations('growth.audiences');
  const { toast } = useToast();
  const fmt = useFormatDate();
  const num = useFormatNumber();
  const canRun = useCan('lsc.contacts.score');
  const q = useAudiences(true);
  const sync = useSyncAudience();

  const run = (a: GrowthAudience) =>
    sync.mutate(a.key, {
      onSuccess: (r) => toast(t('synced', { name: r.groupName, count: r.members }), 'success'),
      onError: (e) =>
        toast(t(`errors.${errorKey(e) === 'forbidden' ? 'forbidden' : 'failed'}`), 'danger'),
    });

  return (
    <SectionCard id="growth-audiences" title={t('title')} hint={t('hint')}>
      {q.isPending && <SkeletonRows rows={4} />}
      {q.isError && (
        <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      )}
      {q.isSuccess && q.data.data.length === 0 && <Nothing>{t('empty')}</Nothing>}
      <ul className="divide-y divide-border">
        {q.data?.data.map((a) => (
          <li key={a.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {a.kind === 'service_due' ? a.label : t(`kinds.${a.kind}.label`)}{' '}
                <span className="text-muted-foreground">({num.count(a.count)})</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {a.kind === 'service_due' ? a.description : t(`kinds.${a.kind}.description`)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {a.syncedAt
                  ? t('lastSync', { name: a.groupName, when: fmt(a.syncedAt) })
                  : t('notSynced', { name: a.groupName })}
              </p>
            </div>
            {canRun && (
              <Button
                size="sm"
                variant="secondary"
                disabled={sync.isPending}
                onClick={() => run(a)}
              >
                {sync.isPending && sync.variables === a.key && <Spinner />}
                {a.syncedAt ? t('resync') : t('sync')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
