'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CALL_RECORDING_HOLD_REASON_MAX, type CallRecordingLifecycle } from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Input, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useDeleteRecording, useSetRecordingHold } from '../api/recording';
import { useErrorText } from './use-error-text';

/**
 * What the log says about one call's recording beyond playing it (BL-144): the consent evidence (answer, how, when, which notice
 * version), when it will be deleted, a legal hold, and the buttons to delete it or hold it. Deleting needs `call.recordings.manage`;
 * a hold needs `privacy.requests.manage`. The server enforces both; the buttons only hide what a person cannot do.
 */
export function RecordingLifecycleCard({
  callId,
  hasRecording,
  lifecycle: l,
}: {
  callId: string;
  hasRecording: boolean;
  lifecycle: CallRecordingLifecycle;
}) {
  const t = useTranslations('calling-voice.recording.lifecycle');
  const format = useFormatter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const canDelete = useCan('call.recordings.manage');
  const canHold = useCan('privacy.requests.manage');
  const del = useDeleteRecording(callId);
  const hold = useSetRecordingHold(callId);
  const [confirming, setConfirming] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : null;

  const consentText =
    l.consent.status === 'granted'
      ? t('consentGranted')
      : l.consent.status === 'declined'
        ? t('consentDeclined')
        : t('consentNone');

  return (
    <section
      aria-labelledby="rec-lifecycle-title"
      className="rounded-xl border border-border bg-background p-5"
    >
      <h3 id="rec-lifecycle-title" className="text-base font-medium">
        {t('title')}
      </h3>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">{t('consent')}</dt>
          <dd className="font-medium">{consentText}</dd>
          {l.consent.method && (
            <dd className="text-muted-foreground">
              {t(`method.${l.consent.method}`)}
              {l.consent.at ? ` · ${when(l.consent.at)}` : ''}
            </dd>
          )}
          {l.consent.noticeVersion && (
            <dd className="font-mono text-muted-foreground">
              {t('noticeVersion', { version: l.consent.noticeVersion })}
              {l.consent.noticeSha256 ? ` · ${l.consent.noticeSha256.slice(0, 12)}` : ''}
            </dd>
          )}
        </div>
        {l.storedAt && (
          <div>
            <dt className="text-muted-foreground">{t('storedAt')}</dt>
            <dd>{when(l.storedAt)}</dd>
          </div>
        )}
        {hasRecording && (
          <div>
            <dt className="text-muted-foreground">{t('expiresAt')}</dt>
            <dd>{l.legalHold ? t('heldNoExpiry') : (when(l.expiresAt) ?? t('none'))}</dd>
          </div>
        )}
        {l.deletedAt && (
          <div>
            <dt className="text-muted-foreground">{t('deleted')}</dt>
            <dd>
              {when(l.deletedAt)}
              {l.deletedReason ? ` · ${t(`deletedReason.${l.deletedReason}`)}` : ''}
            </dd>
          </div>
        )}
        {l.legalHold && (
          <div>
            <dt className="text-muted-foreground">
              <Badge>{t('holdOn')}</Badge>
            </dt>
            <dd>{l.holdReason}</dd>
          </div>
        )}
      </dl>

      {failure && (
        <Alert tone="danger" role="alert" className="mt-3 text-xs">
          {failure}
        </Alert>
      )}

      {hasRecording && (canDelete || canHold) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canHold && !l.legalHold && !asking && (
            <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
              {t('placeHold')}
            </Button>
          )}
          {canHold && l.legalHold && (
            <Button
              size="sm"
              variant="secondary"
              disabled={hold.isPending}
              onClick={() => {
                setFailure(null);
                hold.mutate(
                  { hold: false },
                  {
                    onSuccess: () => toast(t('holdLifted'), 'success'),
                    onError: (e) => setFailure(errorText(e)),
                  },
                );
              }}
            >
              {t('liftHold')}
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="danger"
              disabled={l.legalHold || del.isPending}
              title={l.legalHold ? t('deleteBlockedByHold') : undefined}
              onClick={() => setConfirming(true)}
            >
              {t('delete')}
            </Button>
          )}
        </div>
      )}

      {asking && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFailure(null);
            hold.mutate(
              { hold: true, reason: reason.trim() },
              {
                onSuccess: () => {
                  setAsking(false);
                  setReason('');
                  toast(t('holdPlaced'), 'success');
                },
                onError: (err) => setFailure(errorText(err)),
              },
            );
          }}
        >
          <label htmlFor="rec-hold-reason" className="block text-xs font-medium">
            {t('holdReasonLabel')}
          </label>
          <Input
            id="rec-hold-reason"
            value={reason}
            maxLength={CALL_RECORDING_HOLD_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit" variant="brand" disabled={!reason.trim() || hold.isPending}>
              {t('placeHold')}
            </Button>
            <Button size="sm" type="button" variant="secondary" onClick={() => setAsking(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirming}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={del.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setFailure(null);
          del.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              toast(t('deletedToast'), 'success');
            },
            onError: (e) => {
              setConfirming(false);
              setFailure(errorText(e));
            },
          });
        }}
      />
    </section>
  );
}
