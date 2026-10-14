'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  PRIVACY_EXPORT_TTL_DAYS,
  PRIVACY_VERIFICATION_METHODS,
  type PrivacyExport,
  type PrivacyRequest,
  type PrivacyRequestEvent,
  type PrivacyVerificationMethod,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@crm/ui';
import { KEYS } from '../api/hooks';
import { privacyApi, privacyExportFileUrl } from '../api/service';
import { errorKey } from '../lib/errors';

const CARD = 'space-y-3 rounded-xl border border-border bg-background p-4';

/** Every action refreshes the request, its list and its timeline, and says what went wrong in the section. */
function useAction<V>(fn: (v: V) => Promise<unknown>, done?: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.all });
      if (done) toast(done, 'success');
    },
  });
}

function ErrorLine({ error }: { error: unknown }) {
  const t = useTranslations('privacy-requests');
  if (!error) return null;
  return (
    <Alert tone="danger" role="alert">
      {t(`errors.${errorKey(error)}`)}
    </Alert>
  );
}

const EVENT_TYPES = [
  'created',
  'verification_started',
  'verified',
  'verification_failed',
  'hold_set',
  'hold_released',
  'rejected',
  'export_requested',
  'export_downloaded',
  'erase_previewed',
  'erased',
  'completed',
] as const;

/** The history of the request, oldest first as the server sends it. */
export function Timeline({ events }: { events: readonly PrivacyRequestEvent[] }) {
  const t = useTranslations('privacy-requests.detail.timeline');
  const f = useFormatter();
  return (
    <section className={CARD}>
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-2 border-s border-border ps-4">
          {events.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="font-medium">
                {(EVENT_TYPES as readonly string[]).includes(e.eventType)
                  ? t(`event.${e.eventType as (typeof EVENT_TYPES)[number]}`)
                  : t('event.other')}
              </span>{' '}
              <span className="text-xs text-muted-foreground">
                {e.actor ? t('by', { actor: e.actor }) : t('system')}
                {' - '}
                {f.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Identity verification: how it was checked, a reference id of the evidence (never a document), and the outcome. */
export function VerifySection({ request }: { request: PrivacyRequest }) {
  const t = useTranslations('privacy-requests');
  const f = useFormatter();
  const [method, setMethod] = useState<PrivacyVerificationMethod | ''>(
    request.verificationMethod ?? '',
  );
  const [evidence, setEvidence] = useState(request.verificationEvidenceRef ?? '');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<'pending' | 'verified' | 'not_verified'>('verified');
  const [confirmFail, setConfirmFail] = useState(false);
  const save = useAction(
    () =>
      privacyApi.verify(request.id, {
        outcome,
        method: method || undefined,
        evidenceRef: evidence.trim() || undefined,
        note: note.trim() || undefined,
      }),
    t('detail.verify.saved'),
  );
  const submit = () => {
    if (outcome === 'not_verified') setConfirmFail(true);
    else save.mutate(undefined);
  };

  return (
    <section className={CARD}>
      <h2 className="text-sm font-semibold">{t('detail.verify.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('detail.verify.intro')}</p>
      <p className="text-sm">
        {request.verifiedAt
          ? t('detail.verify.state.verified', {
              date: f.dateTime(new Date(request.verifiedAt), { dateStyle: 'medium' }),
              method: request.verificationMethod ? t(`method.${request.verificationMethod}`) : '-',
            })
          : t('detail.verify.state.none')}
        {request.verificationEvidenceRef && (
          <> {t('detail.verify.state.evidence', { ref: request.verificationEvidenceRef })}</>
        )}
      </p>
      {request.allowed.verify && (
        <>
          <Field label={t('detail.verify.method')} htmlFor="pr-verify-method">
            <Select
              id="pr-verify-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PrivacyVerificationMethod | '')}
            >
              <option value="" />
              {PRIVACY_VERIFICATION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('detail.verify.evidence')}
            htmlFor="pr-verify-evidence"
            hint={t('detail.verify.evidenceHint')}
          >
            <Input
              id="pr-verify-evidence"
              maxLength={120}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={t('detail.verify.note')} htmlFor="pr-verify-note">
            <Textarea
              id="pr-verify-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('detail.verify.outcome')}</legend>
            {(['pending', 'verified', 'not_verified'] as const).map((o) => (
              <label
                key={o}
                htmlFor={`pr-verify-${o}`}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  id={`pr-verify-${o}`}
                  type="radio"
                  name="pr-verify-outcome"
                  className="accent-[var(--primary)]"
                  checked={outcome === o}
                  onChange={() => setOutcome(o)}
                />
                {o === 'pending'
                  ? t('detail.verify.pending')
                  : o === 'verified'
                    ? t('detail.verify.verified')
                    : t('detail.verify.notVerified')}
              </label>
            ))}
          </fieldset>
          {outcome === 'not_verified' && (
            <p className="text-xs text-warning">{t('detail.verify.notVerifiedWarn')}</p>
          )}
          <ErrorLine error={save.error} />
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending && <Spinner />}
            {t('detail.verify.submit')}
          </Button>
          <ConfirmDialog
            open={confirmFail}
            tone="danger"
            busy={save.isPending}
            title={t('detail.verify.notVerified')}
            message={t('detail.verify.notVerifiedWarn')}
            confirmLabel={t('detail.verify.submit')}
            cancelLabel={t('common.cancel')}
            onClose={() => setConfirmFail(false)}
            onConfirm={() => {
              setConfirmFail(false);
              save.mutate(undefined);
            }}
          />
        </>
      )}
    </section>
  );
}

/** Legal hold: while on, erasure is refused. Placing it needs a reason. */
export function HoldSection({ request }: { request: PrivacyRequest }) {
  const t = useTranslations('privacy-requests.detail.hold');
  const [reason, setReason] = useState('');
  const toggle = useAction(
    (held: boolean) =>
      privacyApi.hold(request.id, held ? { held: true, reason: reason.trim() } : { held: false }),
    t('saved'),
  );
  return (
    <section className={CARD}>
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {request.legalHold ? (
        <p className="text-sm font-medium">
          {t('active', { reason: request.legalHoldReason ?? '-' })}
        </p>
      ) : null}
      {request.allowed.hold && (
        <>
          {!request.legalHold && (
            <Field label={t('reason')} htmlFor="pr-hold-reason" hint={t('reasonHint')}>
              <Textarea
                id="pr-hold-reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          <ErrorLine error={toggle.error} />
          <Button
            variant="secondary"
            disabled={toggle.isPending || (!request.legalHold && reason.trim().length < 3)}
            onClick={() => toggle.mutate(!request.legalHold)}
          >
            {toggle.isPending && <Spinner />}
            {request.legalHold ? t('release') : t('apply')}
          </Button>
        </>
      )}
    </section>
  );
}

/** Export: a ZIP of the person's data. Nothing is emailed to the person; a finished file expires after a week. */
export function ExportSection({
  request,
  exports,
  canManage,
}: {
  request: PrivacyRequest;
  exports: readonly PrivacyExport[];
  canManage: boolean;
}) {
  const t = useTranslations('privacy-requests.detail.export');
  const f = useFormatter();
  const ask = useAction(() => privacyApi.requestExport(request.id), t('requested'));
  return (
    <section className={CARD}>
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <p className="text-xs text-muted-foreground">
        {t('expiry', { days: PRIVACY_EXPORT_TTL_DAYS })}
      </p>
      <p className="text-xs font-medium">{t('noEmail')}</p>
      {exports.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {exports.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <Badge
                  tone={
                    e.status === 'ready' ? 'success' : e.status === 'failed' ? 'danger' : 'neutral'
                  }
                >
                  {t(`status.${e.status}`)}
                </Badge>
                {e.fileBytes !== null && (
                  <span className="text-xs text-muted-foreground">
                    {t('size', { size: Math.max(1, Math.round(e.fileBytes / 1024)) })}
                  </span>
                )}
                {e.status === 'ready' && e.expiresAt && (
                  <span className="text-xs text-muted-foreground">
                    {t('expires', {
                      date: f.dateTime(new Date(e.expiresAt), { dateStyle: 'medium' }),
                    })}
                  </span>
                )}
              </span>
              {e.status === 'ready' && canManage && (
                <a
                  href={privacyExportFileUrl(request.id, e.id)}
                  download
                  className="text-primary hover:underline"
                >
                  {t('download')}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && request.allowed.export && (
        <>
          <ErrorLine error={ask.error} />
          <Button
            variant="secondary"
            disabled={ask.isPending}
            onClick={() => ask.mutate(undefined)}
          >
            {ask.isPending && <Spinner />}
            {ask.isPending ? t('requesting') : t('request')}
          </Button>
        </>
      )}
    </section>
  );
}

/** Close the request by hand: complete it (work done outside the screen) or reject it with a reason. */
export function CloseSection({ request }: { request: PrivacyRequest }) {
  const t = useTranslations('privacy-requests.detail.close');
  const tc = useTranslations('privacy-requests.common');
  const [reason, setReason] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const complete = useAction(() => privacyApi.complete(request.id), t('completed'));
  const reject = useAction(
    () => privacyApi.reject(request.id, { reason: reason.trim() }),
    t('rejected'),
  );
  return (
    <section className={CARD}>
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('completeHint')}</p>
      <ErrorLine error={complete.error ?? reject.error} />
      <div>
        <Button
          variant="secondary"
          disabled={complete.isPending || reject.isPending}
          onClick={() => complete.mutate(undefined)}
        >
          {complete.isPending && <Spinner />}
          {t('complete')}
        </Button>
      </div>
      {request.allowed.reject && (
        <div className="space-y-2 border-t border-border pt-3">
          <Field label={t('rejectReason')} htmlFor="pr-reject-reason">
            <Textarea
              id="pr-reject-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3 || reject.isPending}
            onClick={() => setConfirmReject(true)}
          >
            {t('reject')}
          </Button>
          <ConfirmDialog
            open={confirmReject}
            tone="danger"
            busy={reject.isPending}
            title={t('reject')}
            message={reason.trim()}
            confirmLabel={t('rejectConfirm')}
            cancelLabel={tc('cancel')}
            onClose={() => setConfirmReject(false)}
            onConfirm={() => {
              reject.mutate(undefined, { onSettled: () => setConfirmReject(false) });
            }}
          />
        </div>
      )}
    </section>
  );
}
