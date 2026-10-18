'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { CallLogDetail } from '@crm/contracts';
import { Alert, Badge, Button, Spinner, StatTile, cn } from '@crm/ui';
import { AGENT_IGNORE, AGENT_PII } from '@/lib/agent-marks';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { usePlanFeature } from '@/lib/plan-features';
import { useCallLog, useCallLogsLive } from '../api/call-logs';
import {
  WHATSAPP_CALLING,
  durationText,
  knownReason,
  knownStep,
  phoneText,
} from '../lib/call-logs';
import { StatusBadge } from './call-logs-screen';
import { RecordingLifecycleCard } from './recording-lifecycle-card';
import { RecordingPlayer } from './recording-player';
import { useErrorText } from './use-error-text';

/**
 * `/call-logs/:id` (TW-CALL-022): one call. Reference's page (who, when, how long, status, the reason a call failed, a link to the
 * conversation and the recording) with the AI-only panels left out (transcript, tool calls, tokens: the AI assistant is not built) and
 * the call's own timeline in their place, read from the event ledger.
 *
 * Without the plan feature `waba_calling` (BL-257) the recording column (the player and the consent and retention card) is left out:
 * a recording a person can play belongs to a WhatsApp call, and playing one needs the feature. The rest of the call reads the same.
 */
export function CallLogDetailScreen({ callId }: { callId: string }) {
  const t = useTranslations('calling-voice.logs.detail');
  const errorText = useErrorText();
  useCallLogsLive();
  const canPlay = useCan('call.recordings.play');
  const q = useCallLog(callId);
  const whatsapp = usePlanFeature(WHATSAPP_CALLING);

  if (q.isPending) {
    return (
      <main className="mx-auto max-w-[1100px] px-4 py-7 sm:px-6 lg:px-7">
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner label={t('loading')} /> {t('loading')}
        </div>
      </main>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <main className="mx-auto max-w-[1100px] px-4 py-7 sm:px-6 lg:px-7">
        <Back />
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
          <span>{gone ? t('notFound') : `${t('loadFailed')} ${errorText(q.error)}`}</span>
          {!gone && (
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              {t('retry')}
            </Button>
          )}
        </Alert>
      </main>
    );
  }
  return <Detail data={q.data} canPlay={canPlay} whatsapp={whatsapp} />;
}

function Back() {
  const t = useTranslations('calling-voice.logs.detail');
  return (
    <nav aria-label={t('breadcrumb')} className="mb-3 text-xs text-muted-foreground">
      <Link href="/call-logs" className="hover:text-primary">
        {t('back')}
      </Link>
    </nav>
  );
}

function Detail({
  data,
  canPlay,
  whatsapp,
}: {
  data: CallLogDetail;
  canPlay: boolean;
  whatsapp: boolean;
}) {
  const t = useTranslations('calling-voice.logs.detail');
  const tt = useTranslations('calling-voice.logs.table');
  const ts = useTranslations('calling-voice.logs.source');
  const format = useFormatter();
  const { call } = data;
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : tt('none');
  const reason = knownReason(call.failureReason);
  const endReason = knownReason(call.endReason);
  const who =
    call.handlerName ??
    (call.handlerType === 'ai_agent'
      ? t('handler.ai')
      : call.handlerType === 'voicemail'
        ? t('handler.voicemail')
        : null);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-7 sm:px-6 lg:px-7">
      <Back />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {tt(call.direction)} · {when(call.startedAt)}
          </div>
          <h1
            className="mt-2 break-words text-2xl leading-tight sm:text-3xl"
            {...AGENT_IGNORE}
            {...AGENT_PII}
          >
            {call.contactName || phoneText(call.customerPhone)}
          </h1>
          {call.contactName && (
            <p className="font-mono text-sm text-muted-foreground" {...AGENT_PII}>
              {phoneText(call.customerPhone)}
            </p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={call.status} />
            {call.source && call.source !== 'whatsapp' && (
              <Badge tone="neutral">{ts(call.source)}</Badge>
            )}
            <span>
              {who ? t('handledBy', { name: who }) : t('handler.none')}
              {' · '}
              <span className="font-mono">{durationText(call.durationSec)}</span>
            </span>
          </p>
          {call.status === 'failed' && (
            <Alert tone="danger" className="mt-3 max-w-2xl text-xs">
              {reason ? t(`reasons.${reason}`) : (call.failureReason ?? t('reasons.unknown'))}
            </Alert>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {call.contactId && (
            <Link
              href={`/contacts/${call.contactId}`}
              className="rounded-full border border-border px-4 py-2 text-xs hover:bg-muted"
            >
              {t('openContact')}
            </Link>
          )}
          {call.conversationId && (
            <Link
              href={`/inbox?c=${call.conversationId}`}
              className="rounded-full border border-border px-4 py-2 text-xs hover:bg-muted"
            >
              {t('openInbox')}
            </Link>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t('tiles.duration')} value={durationText(call.durationSec)} />
        <StatTile
          label={t('tiles.number')}
          value={<span className="text-lg">{call.numberLabel || tt('none')}</span>}
          hint={phoneText(call.ourPhone)}
        />
        <StatTile
          label={t('tiles.answered')}
          value={<span className="text-lg">{when(call.answeredAt)}</span>}
        />
        <StatTile
          label={t('tiles.ended')}
          value={<span className="text-lg">{when(call.endedAt)}</span>}
          hint={endReason ? t(`reasons.${endReason}`) : (call.endReason ?? undefined)}
        />
      </div>

      {call.notes && (
        <section
          aria-labelledby="call-notes-title"
          className="mb-5 rounded-xl border border-border bg-background p-5"
        >
          <h2 id="call-notes-title" className="text-base font-medium">
            {t('notes')}
          </h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm" {...AGENT_PII}>
            {call.notes}
          </p>
        </section>
      )}

      <div
        className={cn('grid grid-cols-1 gap-5', whatsapp && 'lg:grid-cols-[1fr_340px]')}
        data-testid="call-detail-body"
      >
        <section
          aria-labelledby="timeline-title"
          className="rounded-xl border border-border bg-background"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 id="timeline-title" className="text-base font-medium">
              {t('timeline.title')}
            </h2>
            <span className="font-mono text-xs text-muted-foreground">
              {t('timeline.count', { count: data.timeline.length })}
            </span>
          </div>
          {data.timeline.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm italic text-muted-foreground">
              {t('timeline.empty')}
            </p>
          ) : (
            <ol className="space-y-4 p-5">
              {data.timeline.map((e, i) => {
                const step = knownStep(e.type);
                return (
                  <li key={`${e.type}-${i}`} className="border-s-2 border-primary ps-3">
                    <div className="text-sm font-medium">{step ? t(`steps.${step}`) : e.type}</div>
                    <time className="font-mono text-xs text-muted-foreground" dateTime={e.at}>
                      {format.dateTime(new Date(e.at), {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}
                    </time>
                    {e.note && <div className="mt-0.5 text-xs text-muted-foreground">{e.note}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {whatsapp && (
          <aside className="space-y-4">
            {data.recording.available ? (
              <RecordingPlayer callId={call.id} canPlay={canPlay} />
            ) : (
              <section className="rounded-xl border border-border bg-background p-5">
                <h3 className="text-base font-medium">{t('noRecording.title')}</h3>
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {t('noRecording.message')}
                </p>
              </section>
            )}
            <RecordingLifecycleCard
              callId={call.id}
              hasRecording={data.recording.available}
              lifecycle={data.recording.lifecycle}
            />
          </aside>
        )}
      </div>
    </main>
  );
}
