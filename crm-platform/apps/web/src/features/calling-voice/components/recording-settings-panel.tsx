'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CALL_RECORDING_CONSENT_MODES,
  CALL_RECORDING_NOTICE_MAX,
  CALL_RECORDING_NOTICE_MIN,
  CALL_RECORDING_RETENTION_MAX_DAYS,
  CALL_RECORDING_RETENTION_MIN_DAYS,
  type CallRecordingConsentMode,
  type CallRecordingSettings,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, Switch, Textarea, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useRecordingSettings, useSaveRecordingSettings } from '../api/recording';
import { useErrorText } from './use-error-text';

/**
 * The workspace's call recording rules (BL-144): the switch (off by default), how the person's agreement is obtained, the notice the
 * teammate reads out (every edit is a new version, kept with its hash), and how many days a recording is kept. Anyone who takes calls
 * sees the rules; `call.recordings.manage` edits them. Not a Reference screen: Reference recorded every inbound call with no notice.
 */
export function RecordingSettingsPanel() {
  const t = useTranslations('calling-voice.recording.settings');
  const errorText = useErrorText();
  const rules = useRecordingSettings();

  return (
    <section
      aria-labelledby="recording-rules-title"
      className="mt-8 rounded-xl border border-border bg-background p-4 sm:p-5"
    >
      <h2 id="recording-rules-title" className="text-xl font-normal tracking-tight">
        {t('title')}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      {rules.isPending && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={t('loading')} /> {t('loading')}
        </div>
      )}
      {rules.isError && (
        <Alert tone="danger" className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span>
            {t('loadFailed')} {errorText(rules.error)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void rules.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      )}
      {rules.isSuccess && <RulesForm key={rules.data.rowVersion ?? 0} saved={rules.data} />}
    </section>
  );
}

function RulesForm({ saved }: { saved: CallRecordingSettings }) {
  const t = useTranslations('calling-voice.recording.settings');
  const format = useFormatter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const canManage = useCan('call.recordings.manage');
  const save = useSaveRecordingSettings();
  const [enabled, setEnabled] = useState(saved.enabled);
  const [mode, setMode] = useState<CallRecordingConsentMode>(saved.consentMode);
  const [days, setDays] = useState(String(saved.retentionDays));
  const [notice, setNotice] = useState(saved.noticeText ?? '');
  const [failure, setFailure] = useState<string | null>(null);

  const daysNumber = Number(days);
  const daysOk =
    Number.isInteger(daysNumber) &&
    daysNumber >= CALL_RECORDING_RETENTION_MIN_DAYS &&
    daysNumber <= CALL_RECORDING_RETENTION_MAX_DAYS;
  const noticeLength = notice.trim().length;
  const noticeOk = enabled
    ? noticeLength >= CALL_RECORDING_NOTICE_MIN && noticeLength <= CALL_RECORDING_NOTICE_MAX
    : noticeLength <= CALL_RECORDING_NOTICE_MAX;
  const dirty =
    enabled !== saved.enabled ||
    mode !== saved.consentMode ||
    daysNumber !== saved.retentionDays ||
    notice.trim() !== (saved.noticeText ?? '');

  const submit = () => {
    setFailure(null);
    save.mutate(
      {
        enabled,
        consentMode: mode,
        retentionDays: daysNumber,
        noticeText: notice.trim(),
        ...(saved.rowVersion ? { rowVersion: saved.rowVersion } : {}),
      },
      {
        onSuccess: () => toast(t('saved'), 'success'),
        onError: (e) => setFailure(errorText(e)),
      },
    );
  };

  return (
    <div className="mt-5 space-y-5">
      {!canManage && (
        <Alert tone="info" data-testid="recording-view-only">
          {t('viewOnly')}
        </Alert>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium">{t('enabled')}</div>
          <p className="text-xs text-muted-foreground">
            {enabled ? t('enabledOn') : t('enabledOff')}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          label={t('enabled')}
          disabled={!canManage || save.isPending}
        />
      </div>

      <Field label={t('mode')} htmlFor="rec-mode" hint={t(`modeHint.${mode}`)}>
        <Select
          id="rec-mode"
          value={mode}
          disabled={!canManage || save.isPending}
          onChange={(e) => setMode(e.target.value as CallRecordingConsentMode)}
        >
          {CALL_RECORDING_CONSENT_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`modeOption.${m}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t('retention')}
        htmlFor="rec-days"
        hint={t('retentionHint', {
          min: CALL_RECORDING_RETENTION_MIN_DAYS,
          max: CALL_RECORDING_RETENTION_MAX_DAYS,
        })}
        error={daysOk ? undefined : t('retentionInvalid')}
      >
        <Input
          id="rec-days"
          type="number"
          inputMode="numeric"
          min={CALL_RECORDING_RETENTION_MIN_DAYS}
          max={CALL_RECORDING_RETENTION_MAX_DAYS}
          value={days}
          invalid={!daysOk}
          disabled={!canManage || save.isPending}
          onChange={(e) => setDays(e.target.value)}
          className="max-w-32"
        />
      </Field>

      <Field
        label={t('notice')}
        htmlFor="rec-notice"
        hint={t('noticeHint', { max: CALL_RECORDING_NOTICE_MAX })}
        error={
          enabled && noticeLength < CALL_RECORDING_NOTICE_MIN
            ? t('noticeRequired', { min: CALL_RECORDING_NOTICE_MIN })
            : undefined
        }
      >
        <Textarea
          id="rec-notice"
          rows={4}
          maxLength={CALL_RECORDING_NOTICE_MAX}
          value={notice}
          invalid={!noticeOk}
          disabled={!canManage || save.isPending}
          onChange={(e) => setNotice(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {saved.noticeVersion > 0
            ? t('noticeVersion', { version: saved.noticeVersion })
            : t('noticeNone')}
          {saved.updatedAt
            ? ` · ${t('updatedAt', {
                date: format.dateTime(new Date(saved.updatedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}`
            : ''}
        </span>
        {canManage && notice.trim() === '' && (
          <Button size="sm" variant="secondary" onClick={() => setNotice(t('noticeSuggestion'))}>
            {t('useSuggestion')}
          </Button>
        )}
      </div>

      {failure && (
        <Alert tone="danger" role="alert">
          {failure}
        </Alert>
      )}
      {canManage && (
        <div className="flex justify-end">
          <Button
            variant="brand"
            className="rounded-full"
            disabled={!dirty || !daysOk || !noticeOk || save.isPending}
            aria-busy={save.isPending}
            onClick={submit}
          >
            {save.isPending && <Spinner label={t('saving')} />}
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    </div>
  );
}
