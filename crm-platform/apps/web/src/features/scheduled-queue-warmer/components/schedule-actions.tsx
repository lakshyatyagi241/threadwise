'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, Button, ConfirmDialog, Field, Input, Modal, Select, useToast } from '@crm/ui';
import { refresh, scheduleApi, type ScheduleAction } from '../api/schedules';
import { browserTimezone, localDateTime, timezoneList } from '../lib/time';
import { useErrorText } from './use-error-text';

export interface Target {
  id: string;
  name: string;
}

type Confirming = { target: Target; action: 'cancel' | 'run-now' | 'destroy' };

/**
 * The row and detail actions (TW-SCHED-013 to 017): pause and resume go straight through; cancel, run now and delete ask first;
 * retry asks for a new send time. `dialogs` is the markup to render once on the screen.
 */
export function useScheduleActions(onRemoved?: (id: string) => void): {
  act: (action: ScheduleAction | 'destroy', target: Target) => void;
  retry: (target: Target) => void;
  dialogs: ReactNode;
} {
  const t = useTranslations('scheduled-queue-warmer');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [retrying, setRetrying] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: ScheduleAction | 'destroy', target: Target) => {
    setBusy(true);
    try {
      if (action === 'destroy') {
        await scheduleApi.remove(target.id);
        onRemoved?.(target.id);
      } else {
        await scheduleApi.act(target.id, action);
      }
      toast(t(`actions.done.${action}`), 'success');
      setConfirming(null);
      await refresh(qc);
    } catch (e) {
      toast(errorText(e).text, 'danger');
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  return {
    act: (action, target) => {
      if (action === 'pause' || action === 'resume') void run(action, target);
      else setConfirming({ target, action });
    },
    retry: setRetrying,
    dialogs: (
      <>
        <ConfirmDialog
          open={confirming !== null}
          title={confirming ? t(`confirm.${confirming.action}.title`) : ''}
          message={
            confirming
              ? t(`confirm.${confirming.action}.body`, { name: confirming.target.name })
              : ''
          }
          confirmLabel={t('confirm.yes')}
          cancelLabel={t('confirm.keep')}
          tone={confirming?.action === 'run-now' ? 'default' : 'danger'}
          busy={busy}
          onConfirm={() => confirming && void run(confirming.action, confirming.target)}
          onClose={() => setConfirming(null)}
        />
        {retrying && (
          <RetryModal
            target={retrying}
            onClose={() => setRetrying(null)}
            onDone={() => {
              setRetrying(null);
              toast(t('actions.done.retry'), 'success');
              void refresh(qc);
            }}
          />
        )}
      </>
    ),
  };
}

/** "Retry with new time" (TW-SCHED-017): a fresh send date, time and zone for a failed schedule. */
function RetryModal({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('scheduled-queue-warmer.retry');
  const errorText = useErrorText();
  const [tz, setTz] = useState(browserTimezone);
  const [init] = useState(() => localDateTime(Date.now() + 10 * 60_000, tz));
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useState(timezoneList)[0];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await scheduleApi.retry(target.id, { sendDate: date, sendTime: time, timezone: tz });
      onDone();
    } catch (e) {
      const x = errorText(e);
      setError(x.fieldErrors[0]?.message ?? x.text);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('keep')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={busy || !date || !time}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('body', { name: target.name })}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('date')} htmlFor="retry-date">
          <Input
            id="retry-date"
            type="date"
            value={date}
            min={init.date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={t('time')} htmlFor="retry-time">
          <Input
            id="retry-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('timezone')} htmlFor="retry-tz" className="mt-3">
        <Select id="retry-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {[...new Set([tz, ...zones])].map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Modal>
  );
}
