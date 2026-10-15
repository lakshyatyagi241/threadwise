'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  WA_DEVICE_GROUP_JOIN_REQUESTS_PER_CALL_MAX,
  type WaDeviceGroup,
  type WaGroupParticipantResults,
} from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { useHandleWaJoinRequests, useWaGroupJoinRequests } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { formatWhen } from '../lib/format';
import { useGroupsCtx } from './groups-context';
import { personLabel, rowAccess, summarizeResults } from './groups-model';
import { OutcomeList } from './outcome-list';

/**
 * "Waiting to join": one row per person with Approve and Reject, each acting on that one WhatsApp id, plus approve or reject
 * everyone (at most 50 a call). A reader who may not manage the group sees only how many are waiting: the numbers are personal data
 * and the API does not send them. A number that is not an admin cannot decide: the queue is shown, the buttons are off.
 */
export function JoinRequests({ group }: { group: WaDeviceGroup }) {
  const t = useTranslations('whatsapp-devices-baileys.groups.requests');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const errorText = useErrorText();
  const { device, online, perms, waitSeconds, notify, fail } = useGroupsCtx();
  const access = rowAccess(group, perms, online);
  const canSee = access.canSeeMembers && !group.left;
  const query = useWaGroupJoinRequests(
    device.id,
    group.id,
    canSee && group.pendingRequestCount > 0,
  );
  const act = useHandleWaJoinRequests(device.id);
  const [last, setLast] = useState<WaGroupParticipantResults | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  if (group.pendingRequestCount === 0 || group.left) return null;
  if (!canSee) {
    return (
      <p className="mt-3 text-xs text-muted-foreground" data-testid="groups-requests-count">
        {t('hidden', { count: group.pendingRequestCount })}
      </p>
    );
  }

  const rows = query.data?.requests ?? [];
  const canDecide = access.canAdminister && waitSeconds === 0;

  const decide = (action: 'approve' | 'reject', jids: string[], key: string) => {
    setWorking(key);
    act.mutate(
      {
        group: group.id,
        input: { action, jids: jids.slice(0, WA_DEVICE_GROUP_JOIN_REQUESTS_PER_CALL_MAX) },
      },
      {
        onSuccess: (r) => {
          setLast(r);
          if (r.failCount === 0) {
            notify({
              tone: 'success',
              text: t(action === 'approve' ? 'approved' : 'rejected', { count: r.okCount }),
            });
          }
        },
        onError: fail,
        onSettled: () => setWorking(null),
      },
    );
  };

  return (
    <div
      className="mt-3 rounded-md border border-border bg-muted/40 p-3"
      data-testid="join-requests"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('title', { count: group.pendingRequestCount })}
        </p>
        {canDecide && rows.length > 1 && (
          <span className="flex gap-1.5">
            <Button
              size="sm"
              disabled={working !== null}
              onClick={() =>
                decide(
                  'approve',
                  rows.map((r) => r.jid),
                  'all',
                )
              }
            >
              {working === 'all' ? t('working') : t('approveAll')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={working !== null}
              onClick={() =>
                decide(
                  'reject',
                  rows.map((r) => r.jid),
                  'all',
                )
              }
            >
              {t('rejectAll')}
            </Button>
          </span>
        )}
      </div>
      {!access.canAdminister && access.blockedBy && (
        <p className="mt-1 text-xs text-muted-foreground">{t(`readOnly.${access.blockedBy}`)}</p>
      )}
      <div className="mt-2 space-y-2">
        {query.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </p>
        ) : query.isError ? (
          <Alert tone="danger">{errorText(query.error).text}</Alert>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          rows.map((r) => {
            const when = formatWhen(r.requestedAt, locale, timeZone);
            return (
              <div
                key={r.jid}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate" dir="auto">
                    {personLabel(r) ?? t('someone')}
                  </span>
                  {r.name && r.phone && (
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      {r.phone}
                    </span>
                  )}
                  {when && <span className="block text-xs text-muted-foreground">{when}</span>}
                </span>
                {canDecide && (
                  <span className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={working !== null}
                      onClick={() => decide('approve', [r.jid], r.jid)}
                    >
                      {working === r.jid ? t('working') : t('approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={working !== null}
                      onClick={() => decide('reject', [r.jid], r.jid)}
                    >
                      {t('reject')}
                    </Button>
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      {last && last.failCount > 0 && (
        <div className="mt-2" data-testid="groups-requests-result">
          <p className="text-xs text-danger">
            {t('someFailed', { ok: last.okCount, failed: last.failCount })}
          </p>
          <OutcomeList results={summarizeResults(last.results).failed} />
        </div>
      )}
    </div>
  );
}
