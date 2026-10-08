'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WabaGroup } from '@crm/contracts';
import { Button, useToast } from '@crm/ui';
import { useHandleJoinRequests } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import type { GroupNotice } from './groups-model';

/**
 * "Waiting to join": one row per person with Approve and Reject (Reference), each acting on that one id, showing "…" while it works and
 * dropping the row on success. A failure shows Meta's own wording in a toast (Reference used alert()). A caller who may read but not manage
 * sees only how many are waiting: the numbers are personal data.
 */
export function JoinRequests({
  number,
  group,
  canManage,
  onNotice,
}: {
  number: string;
  group: WabaGroup;
  canManage: boolean;
  onNotice: (n: GroupNotice) => void;
}) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups');
  const errorText = useErrorText();
  const { toast } = useToast();
  const act = useHandleJoinRequests(number);
  const [working, setWorking] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  if (group.pendingJoinRequestCount === 0) return null;
  if (!canManage) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {t('joinRequests.hidden', { count: group.pendingJoinRequestCount })}
      </p>
    );
  }
  const rows = group.pendingJoinRequests.filter((r) => !done.has(r.id));
  if (rows.length === 0) return null;

  const decide = (id: string, action: 'approve' | 'reject') => {
    setWorking(id);
    act.mutate(
      { group: group.id, input: { action, ids: [id] } },
      {
        onSuccess: () => {
          setDone((prev) => new Set(prev).add(id));
          onNotice({
            tone: 'success',
            text: t(action === 'approve' ? 'notice.approved' : 'notice.rejected', { count: 1 }),
          });
        },
        onError: (err) => toast(errorText(err).text, 'danger'),
        onSettled: () => setWorking(null),
      },
    );
  };

  return (
    <div
      className="mt-3 rounded-md border border-border bg-muted/40 p-3"
      data-testid="join-requests"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('joinRequests.title')}
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span dir="ltr" className="font-mono">
              {r.waId}
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" disabled={working !== null} onClick={() => decide(r.id, 'approve')}>
                {working === r.id ? t('joinRequests.working') : t('joinRequests.approve')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={working !== null}
                onClick={() => decide(r.id, 'reject')}
              >
                {working === r.id ? t('joinRequests.working') : t('joinRequests.reject')}
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
