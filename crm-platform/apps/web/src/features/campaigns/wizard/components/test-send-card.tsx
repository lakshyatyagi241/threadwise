'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  WIZARD_TEST_MAX_RECIPIENTS,
  parseTestRecipients,
  type WizardTestResult,
} from '@crm/contracts';
import { Alert, Button, Field, Spinner, Textarea } from '@crm/ui';
import { KEYS, sendTest, useTestLog } from '../api/wizard';
import { errorKind, requestIdOf } from '../lib/errors';
import { formatMinor } from '../lib/money';
import { testTone } from '../lib/test-log';
import { Chip, ErrorBlock, WizardCard } from './parts';

const NOTE_KEYS = ['multiple', 'tracking', 'credits', 'format'] as const;

function ResultRow({
  r,
  currency,
  when,
}: {
  r: WizardTestResult;
  currency: string | null;
  when?: string;
}) {
  const t = useTranslations('campaigns.wizard.test');
  const locale = useLocale();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <span dir="ltr" className="font-mono">
        {r.to}
      </span>
      <Chip tone={testTone(r.status)}>{t(`status.${r.status}`)}</Chip>
      {when && <span className="text-xs text-muted-foreground">{when}</span>}
      {r.chargedMinor > 0 && currency && (
        <span className="text-xs text-muted-foreground">
          {t('charged', { amount: formatMinor(r.chargedMinor, currency, locale) })}
        </span>
      )}
      {r.status === 'failed' && (r.errorMessage || r.errorCode) && (
        <span className="basis-full text-xs text-danger">
          {r.errorMessage ?? r.errorCode}
          {r.errorMessage && r.errorCode ? ` (${r.errorCode})` : ''}
        </span>
      )}
    </li>
  );
}

/**
 * "Send a test WhatsApp message": validates the numbers while typing with the shared parser, saves the draft first so the test
 * uses what is on screen, then lists what happened to each number. A recent-test log follows delivery for a short while.
 */
export function TestSendCard({
  draftId,
  canTest,
  ensureSaved,
  currency,
  initialRecipients = '',
}: {
  draftId: string | null;
  canTest: boolean;
  /** Saves the draft now; false when it could not be saved (the test would use an old version). */
  ensureSaved: () => Promise<boolean>;
  currency: string | null;
  /** What the box starts with (the screens leave it empty). */
  initialRecipients?: string;
}) {
  const t = useTranslations('campaigns.wizard.test');
  const format = useFormatter();
  const qc = useQueryClient();
  const [raw, setRaw] = useState(initialRecipients);
  const [sinceMs, setSinceMs] = useState<number | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const parsed = useMemo(() => parseTestRecipients(raw), [raw]);
  const log = useTestLog(draftId ?? undefined, sinceMs);

  const send = useMutation({
    mutationFn: async () => {
      setNotSaved(false);
      if (!draftId || !(await ensureSaved())) {
        setNotSaved(true);
        throw new Error('not saved');
      }
      return sendTest(draftId, parsed.valid.join(','));
    },
    onSuccess: () => {
      setSinceMs(Date.now());
      if (draftId) void qc.invalidateQueries({ queryKey: KEYS.tests(draftId) });
    },
  });

  const canSend =
    canTest &&
    parsed.valid.length > 0 &&
    parsed.invalid.length === 0 &&
    !parsed.tooMany &&
    !send.isPending &&
    Boolean(draftId);

  const fresh = send.data?.results ?? [];
  const logRows = log.data?.data ?? [];
  const byId = new Map(logRows.map((r) => [r.id, r]));
  // The newest status of this send's rows comes from the log once it has them.
  const latest = fresh.map((r) => byId.get(r.id) ?? r);
  const freshIds = new Set(fresh.map((r) => r.id));
  const earlier = logRows.filter((r) => !freshIds.has(r.id));
  const reason =
    raw.trim() === ''
      ? null
      : parsed.invalid.length > 0
        ? 'invalid'
        : parsed.tooMany
          ? 'tooMany'
          : null;

  return (
    <WizardCard title={t('title')} hint={t('hint')} id="send-test">
      {!canTest ? (
        <Alert tone="info">{t('noPermission')}</Alert>
      ) : (
        <div className="space-y-4">
          <Alert tone="info" className="text-sm">
            <ul className="list-disc space-y-1 ps-5">
              {NOTE_KEYS.map((k) => (
                <li key={k}>{t(`notes.${k}`)}</li>
              ))}
            </ul>
          </Alert>
          <Field
            label={t('recipients')}
            htmlFor="wizard-test-recipients"
            hint={t('recipientsHint', { max: WIZARD_TEST_MAX_RECIPIENTS })}
            error={
              reason === 'invalid'
                ? t('invalidNumbers', {
                    count: parsed.invalid.length,
                    numbers: parsed.invalid.join(', '),
                  })
                : reason === 'tooMany'
                  ? t('tooMany', { max: WIZARD_TEST_MAX_RECIPIENTS })
                  : undefined
            }
          >
            <Textarea
              id="wizard-test-recipients"
              value={raw}
              rows={3}
              dir="ltr"
              onChange={(e) => setRaw(e.target.value)}
              invalid={reason !== null}
              placeholder="+919800000001,+919800000002"
              className="font-mono"
            />
          </Field>
          {parsed.valid.length > 0 && reason === null && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t('validCount', { count: parsed.valid.length })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRaw('');
                send.reset();
                setNotSaved(false);
              }}
              disabled={send.isPending || (raw === '' && !send.data)}
            >
              {t('reset')}
            </Button>
            <Button onClick={() => send.mutate()} disabled={!canSend}>
              {send.isPending && <Spinner />}
              {t('send')}
            </Button>
          </div>
          {notSaved && <Alert tone="danger">{t('notSaved')}</Alert>}
          {send.isError && !notSaved && (
            <Alert tone="danger">
              {t(`sendError.${errorKind(send.error)}`)}
              {requestIdOf(send.error) && (
                <span className="mt-1 block font-mono text-xs">{requestIdOf(send.error)}</span>
              )}
            </Alert>
          )}
          {latest.length > 0 && (
            <div aria-live="polite">
              <h3 className="text-sm font-semibold">{t('results')}</h3>
              <ul className="divide-y divide-border">
                {latest.map((r) => (
                  <ResultRow key={r.id} r={r} currency={currency} />
                ))}
              </ul>
              {send.data?.renderedBody && (
                <p className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  {t('rendered')} {send.data.renderedBody}
                </p>
              )}
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold">{t('recent')}</h3>
            {log.isPending && draftId ? (
              <p className="text-sm text-muted-foreground">{t('recentLoading')}</p>
            ) : log.isError ? (
              <ErrorBlock error={log.error} onRetry={() => void log.refetch()} />
            ) : earlier.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('recentEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {earlier.map((r) => (
                  <ResultRow
                    key={r.id}
                    r={r}
                    currency={currency}
                    when={format.dateTime(new Date(r.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </WizardCard>
  );
}
