'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { cancelRun, refreshAll, useRun } from '../api/flow-runtime';
import { contactLabel, detailPairs, isLive, secondsBetween, shortId } from '../lib/model';
import {
  CARD,
  Denied,
  KICKER,
  RunStatusChip,
  TH,
  useDateTime,
  useDuration,
  useErrorText,
  useReasonText,
  useSourceLabel,
} from './parts';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={KICKER}>{label}</dt>
      <dd className="mt-1 break-words text-sm">{children}</dd>
    </div>
  );
}

/** `/flow-runtime/runs/[id]`: where one run stands, why it ended, what it waits for, its step log and its variables. */
export function RunDetailScreen({ id }: { id: string }) {
  const t = useTranslations('flr');
  const canRead = useCan('flr.runs.read');
  const canManage = useCan('flr.runs.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const when = useDateTime();
  const dur = useDuration();
  const errText = useErrorText();
  const reasonText = useReasonText();
  const sourceLabel = useSourceLabel();
  const run = useRun(id);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canRead) return <Denied />;

  const back = (
    <Link href="/flow-runtime" className="text-xs font-semibold text-brand hover:underline">
      ← {t('run.back')}
    </Link>
  );

  if (run.isPending)
    return (
      <main className="flex justify-center px-4 py-16">
        <Spinner label={t('common.loading')} />
      </main>
    );

  if (run.isError) {
    const gone = run.error instanceof ApiError && run.error.status === 404;
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-4">{back}</div>
        <EmptyState
          title={gone ? t('run.notFoundTitle') : t('run.loadError')}
          message={gone ? t('run.notFoundBody') : errText(run.error, t('common.loadError'))}
          actions={
            !gone && (
              <Button variant="secondary" onClick={() => void run.refetch()}>
                {t('common.retry')}
              </Button>
            )
          }
        />
      </main>
    );
  }

  const r = run.data;
  const live = isLive(r.status);
  const flow = r.flowName || t('common.unknownFlow', { id: shortId(r.flowId) });
  const contact = contactLabel(r.contact, r.peerKey || t('common.unknownContact'));
  const vars = Object.entries(r.variables);

  const doCancel = async () => {
    setBusy(true);
    try {
      await cancelRun(r.id);
      toast(t('run.cancelled'), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
      setConfirm(false);
      void refreshAll(qc);
    }
  };

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="mb-4">{back}</div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`mb-2 ${KICKER}`}>
            {t('run.kicker')} · {shortId(r.id)}
          </div>
          <h1 className="break-words text-2xl leading-tight tracking-tight lg:text-4xl">{flow}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RunStatusChip status={r.status} />
            <span className="text-sm text-muted-foreground">{contact}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/flow-runtime/flows/${r.flowId}`}
            className="inline-flex h-10 items-center rounded-full border border-border px-4 text-xs font-semibold hover:bg-muted"
          >
            {t('subs.title')}
          </Link>
          {canManage && live && (
            <Button variant="danger" className="rounded-full" onClick={() => setConfirm(true)}>
              {t('run.cancel')}
            </Button>
          )}
        </div>
      </div>

      <section className={`${CARD} mb-5 p-5`}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t('run.contact')}>{contact}</Fact>
          <Fact label={t('run.flow')}>
            <Link href={`/flow-runtime/flows/${r.flowId}`} className="text-brand hover:underline">
              {flow}
            </Link>
          </Fact>
          <Fact label={t('run.channel')}>
            {r.channel ? `${r.channel.name} (${r.channel.kind})` : t('common.noValue')}
          </Fact>
          <Fact label={t('run.source')}>{sourceLabel(r.source)}</Fact>
          <Fact label={t('run.started')}>{when(r.startedAt)}</Fact>
          <Fact label={t('run.lastActivity')}>{when(r.lastActivityAt)}</Fact>
          <Fact label={t('run.ended')}>{when(r.endedAt)}</Fact>
          <Fact label={t('run.duration')}>{dur(secondsBetween(r.startedAt, r.endedAt))}</Fact>
          <Fact label={t('run.steps')}>{r.steps}</Fact>
          <Fact label={t('run.currentNode')}>{r.currentNodeId ?? t('common.noValue')}</Fact>
          <Fact label={t('run.peer')}>
            <span className="font-mono text-xs">{r.peerKey || t('common.noValue')}</span>
          </Fact>
          {r.triggerText && <Fact label={t('run.trigger')}>{r.triggerText}</Fact>}
          {r.resumeAt && <Fact label={t('run.resumeAt')}>{when(r.resumeAt)}</Fact>}
          {r.endReason && <Fact label={t('run.whyEnded')}>{t(`endReason.${r.endReason}`)}</Fact>}
          {r.failureReason && <Fact label={t('run.failure')}>{reasonText(r.failureReason)}</Fact>}
          {r.haltReason && <Fact label={t('run.halt')}>{reasonText(r.haltReason)}</Fact>}
        </dl>
        {r.waiting && (
          <div className="mt-5 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
            <div className="font-semibold">{t('run.waitsTitle')}</div>
            <p className="text-muted-foreground">
              {t('run.waitsBody', { node: r.waiting.nodeId, kind: r.waiting.kind })}
              {r.waiting.expiresAt
                ? ` ${t('run.waitsExpires', { at: when(r.waiting.expiresAt) })}`
                : ''}
            </p>
          </div>
        )}
      </section>

      <section className={`${CARD} mb-5 overflow-hidden`}>
        <div className="border-b border-border px-5 py-4">
          <div className={KICKER}>{t('run.kicker')}</div>
          <h2 className="mt-0.5 text-xl leading-tight">{t('run.logTitle')}</h2>
        </div>
        {r.log.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t('run.logEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead className="border-b border-border bg-muted text-muted-foreground">
                <tr>
                  <th className={TH}>{t('run.colSeq')}</th>
                  <th className={TH}>{t('run.colAt')}</th>
                  <th className={TH}>{t('run.colEvent')}</th>
                  <th className={TH}>{t('run.colNode')}</th>
                  <th className={TH}>{t('run.colNotes')}</th>
                  <th className={TH}>{t('run.colError')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {r.log.map((s) => (
                  <tr key={s.seq}>
                    <td className="px-3 py-2.5 font-mono tabular-nums">{s.seq}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{when(s.at)}</td>
                    <td className="px-3 py-2.5">
                      {t.has(`event.${s.event}`) ? t(`event.${s.event}`) : s.event}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {s.nodeId ?? t('common.noValue')}
                      {s.nodeType && (
                        <span className="block text-muted-foreground">{s.nodeType}</span>
                      )}
                    </td>
                    <td className="max-w-[320px] px-3 py-2.5">
                      {detailPairs(s.detail).map(([k, v]) => (
                        <div key={k} className="break-words">
                          <span className="text-muted-foreground">{k}:</span> {v}
                        </div>
                      ))}
                    </td>
                    <td className="max-w-[260px] break-words px-3 py-2.5 text-danger">
                      {s.error ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${CARD} overflow-hidden`}>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-xl leading-tight">{t('run.varsTitle')}</h2>
        </div>
        {vars.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            {t('run.varsEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-border bg-muted text-muted-foreground">
                <tr>
                  <th className={TH}>{t('run.colName')}</th>
                  <th className={TH}>{t('run.colValue')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {vars.map(([k, v]) => (
                  <tr key={k}>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{k}</td>
                    <td className="break-words px-3 py-2.5">
                      {typeof v === 'string' ? v : JSON.stringify(v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        title={t('run.cancelTitle')}
        message={t('run.cancelBody')}
        confirmLabel={t('run.cancelConfirm')}
        cancelLabel={t('run.cancelKeep')}
        tone="danger"
        busy={busy}
        onConfirm={() => void doCancel()}
        onClose={() => setConfirm(false)}
      />
    </main>
  );
}
