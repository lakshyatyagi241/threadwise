'use client';

import { useEffect, useRef } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { CallingCheck, CallingMetaReason, CallingReadiness } from '@crm/contracts';
import { Alert, Badge, Button, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useCallingReadiness, useCheckReadiness } from '../api/readiness';
import { STATUS_TONE, canTestCall, isStale } from '../lib/readiness';
import { TestCallButton } from './test-call-button';
import { useErrorText } from './use-error-text';

const MARK: Record<CallingCheck['state'], string> = { ok: '✓', warn: '!', fail: '✕' };
const MARK_TONE: Record<CallingCheck['state'], string> = {
  ok: 'bg-success/15 text-success',
  warn: 'bg-warning/10 text-warning',
  fail: 'bg-danger/15 text-danger',
};

/**
 * What stands between a connected WhatsApp number and a working call (EXT-CALL-007 to 010): one row per prerequisite with what was
 * found and, when it is not fine, what to do. The server sends codes; every word here is chosen by the code, in the person's language.
 * It shows the last result at once and, for someone who may change calling, looks again when that result is old (opening the card is
 * the "health page runs it" trigger). Placed on the calling settings page and on the number's health page.
 */
export function ReadinessCard({ numberId }: { numberId: string }) {
  const readiness = useCallingReadiness();
  const row = readiness.data?.rows.find((r) => r.numberId === numberId);
  if (!row) return null;
  return <Card row={row} />;
}

function Card({ row }: { row: CallingReadiness }) {
  const t = useTranslations('calling-voice.readiness');
  const format = useFormatter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const canManage = useCan('call.calling.manage');
  const check = useCheckReadiness();
  const asked = useRef(false);

  // Once per card: a result older than a quarter of an hour is looked at again by someone who may act on it.
  useEffect(() => {
    if (asked.current || !canManage || !isStale(row.checkedAt)) return;
    asked.current = true;
    // The automatic look is a `health` check (the server shares one look at Meta between openings within a minute); only the button is `manual`.
    check.mutate({ id: row.numberId, source: 'health' });
  }, [canManage, row.checkedAt, row.numberId, check]);

  const again = () =>
    check.mutate(
      { id: row.numberId, source: 'manual' },
      { onSuccess: () => toast(t('checkedDone'), 'success') },
    );

  const checking = check.isPending;
  const off = row.checks.find((c) => c.key === 'calling_enabled' && c.code === 'calling_off');
  const refused = off?.params?.refused as CallingMetaReason | undefined;

  return (
    <div
      data-testid="readiness-card"
      data-status={row.status}
      className="mt-4 rounded-lg border border-border bg-muted/30 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t('title')}</span>
            <Badge tone={STATUS_TONE[row.status]} data-testid="readiness-status">
              {t(`status.${row.status}`)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t(`statusHint.${row.status}`)}</p>
          {row.checkedAt && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('checkedAt', {
                date: format.dateTime(new Date(row.checkedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </p>
          )}
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={checking}
            aria-busy={checking}
            onClick={again}
          >
            {checking && <Spinner label={t('checking')} />}
            {checking ? t('checking') : t('checkAgain')}
          </Button>
        )}
      </div>

      {check.isError && (
        <Alert tone="danger" className="mt-3">
          {t('checkFailed')} {errorText(check.error, { reasons: true })}
        </Alert>
      )}

      {row.checks.length > 0 && (
        <details className="mt-3" open={row.status !== 'ready'}>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {t('details')}
          </summary>
          <ul className="mt-2 space-y-2">
            {row.checks.map((c) => (
              <li
                key={c.key}
                className="flex items-start gap-2"
                data-check={c.key}
                data-state={c.state}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold ${MARK_TONE[c.state]}`}
                >
                  {MARK[c.state]}
                </span>
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {t(`checks.${c.key}`)}
                    <span className="sr-only"> - {t(`state.${c.state}`)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(`codes.${c.code}.detail`, c.params ?? {})}
                  </p>
                  {c.state !== 'ok' && (
                    <p className="text-xs">
                      <span className="font-medium">{t('fixLabel')}</span>{' '}
                      {t(`codes.${c.code}.fix`, c.params ?? {})}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {refused && refused !== 'unknown' && (
        <Alert tone="danger" className="mt-3" data-testid="readiness-refused">
          {t('refusedBecause', { reason: t(`reasons.${refused}`) })}
        </Alert>
      )}

      {canTestCall(row) && <TestCallButton numberId={row.numberId} />}
    </div>
  );
}
