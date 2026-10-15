'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  PERSONAL_WA_NOTICE_VERSION,
  type HistoryImportMode,
  type PairingMethod,
  type PersonalDevice,
} from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Modal, Spinner } from '@crm/ui';
import {
  KEYS,
  useAcknowledgeRisk,
  useCreateDevice,
  useEndPairing,
  useStartPairing,
} from '../api/devices';
import {
  attemptDeadlineMs,
  failureKind,
  isTerminalPhase,
  pairingPhase,
  type PairingPhase,
} from '../lib/pairing-model';
import { canUsePairingCode, readDevicePhone } from '../lib/phone-model';
import {
  EMPTY_DRAFT,
  WIZARD_STEPS,
  allAcknowledged,
  canContinue,
  firstStep,
  isDirty,
  type WizardDraft,
  type WizardStep,
} from '../lib/wizard-model';
import { DEFAULT_HISTORY_CHOICE } from '../lib/history-model';
import { HistoryChoice } from './history-choice';
import { CodePanel, ProgressStrip, QrPanel } from './pairing-panel';
import {
  MethodChoice,
  NoticeStep,
  NumberStep,
  ResultStep,
  Starting,
  type Outcome,
} from './wizard-steps';
import { ErrorNotice } from './error-notice';
import { useErrorText, type ErrorText } from './use-error-text';
import { useNow, usePairingPoll } from './use-pairing-poll';

const NS = 'whatsapp-devices-baileys';

interface Props {
  /** The number to link again (Reconnect, Link again, Try again). Omitted for a new number. */
  existing?: PersonalDevice | null;
  noticeVersion: string | null;
  noticeAccepted: boolean;
  /** The plan has the full-history feature; otherwise that choice is shown disabled with an upgrade hint. */
  historyFullAllowed?: boolean;
  onClose: () => void;
}

/**
 * "Connect a number" (spec 13.2): 1 the risk notice, 2 the number, 3 the QR or the pairing code, 4 the result.
 * Mount it only while it is open: closing unmounts it, which stops the polling and drops the QR from memory. Closing asks first
 * when there is something to lose, and a link in progress is ended on the server.
 */
export function ConnectWizard({
  existing = null,
  noticeVersion,
  noticeAccepted,
  historyFullAllowed = false,
  onClose,
}: Props) {
  const t = useTranslations(NS);
  const tw = useTranslations(`${NS}.wizard`);
  const locale = useLocale();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const version = noticeVersion ?? PERSONAL_WA_NOTICE_VERSION;

  const [stepState, setStep] = useState<WizardStep>(
    firstStep({ noticeAccepted, existingDevice: existing !== null }),
  );
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT);
  const [showProblems, setShowProblems] = useState(false);
  const [device, setDevice] = useState<{ id: string; name: string; phone: string } | null>(
    existing ? { id: existing.id, name: existing.name, phone: existing.phone } : null,
  );
  const [method, setMethod] = useState<PairingMethod>('qr');
  // Chosen before the scan and sent with the start: WhatsApp sends history only right after a link. Never pre-selected.
  const [importHistory, setImportHistory] = useState<HistoryImportMode>(DEFAULT_HISTORY_CHOICE);
  const [attempt, setAttempt] = useState<{
    method: PairingMethod;
    deadlineMs: number | null;
  } | null>(null);
  const [needRelink, setNeedRelink] = useState(false);
  const [error, setError] = useState<ErrorText | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Bumped to re-open the dialog after "Keep going": the native dialog was already closed by Escape or the backdrop.
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [wasNoticeStep] = useState(!noticeAccepted);

  const ack = useAcknowledgeRisk();
  const create = useCreateDevice();
  const start = useStartPairing(device?.id ?? '');
  const endPairing = useEndPairing();

  // The attempt's ending is derived from what the poll says, so the screen cannot show a stale "waiting".
  const live = device !== null && stepState === 'link' && attempt !== null;
  const poll = usePairingPoll(device?.id ?? '', live);
  const now = useNow(live);
  const phase: PairingPhase = !attempt
    ? 'starting'
    : poll.gone
      ? 'failed'
      : pairingPhase(poll.data, now, true, attempt.deadlineMs);
  const outcome: Outcome | null =
    live && isTerminalPhase(phase)
      ? phase === 'connected'
        ? { kind: 'connected' }
        : {
            kind: 'failure',
            failure: failureKind(phase, poll.data?.state, poll.data?.reason),
            reason: poll.data?.reason ?? null,
          }
      : null;
  const step: WizardStep = outcome ? 'done' : stepState;

  const phoneRead = device ? readDevicePhone(device.phone) : readDevicePhone(draft.e164);
  const phoneLabel = device?.phone ?? (phoneRead.ok ? phoneRead.e164 : '');
  const attemptActive = attempt !== null && outcome === null;
  const dirty = isDirty({
    draft,
    step,
    attemptActive,
    deviceCreated: device !== null && existing === null,
  });

  // The browser's own "leave this page?" while something would be lost.
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);

  const leave = () => {
    if (attemptActive && device) endPairing.mutate(device.id);
    qc.removeQueries({ queryKey: device ? KEYS.pairing(device.id) : KEYS.all });
    onClose();
  };
  const requestClose = () => (dirty ? setConfirmLeave(true) : leave());

  const patchDraft = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const acceptNotice = () => {
    setError(null);
    ack.mutate(
      { version, items: [true, true, true], locale },
      {
        onSuccess: () => setStep(device ? 'link' : 'number'),
        onError: (e) => setError(errorText(e)),
      },
    );
  };

  const submitNumber = () => {
    setShowProblems(true);
    setError(null);
    setExistingId(null);
    if (!canContinue('number', draft) || !phoneRead.ok) return;
    create.mutate(
      {
        name: draft.name.trim(),
        countryCode: `+${phoneRead.callingCode}`,
        phone: phoneRead.nationalDigits,
        ...(phoneRead.region ? { region: phoneRead.region } : {}),
        activateAfterPairing: draft.activateAfterPairing,
      },
      {
        onSuccess: (d) => {
          setDevice({ id: d.id, name: d.name, phone: d.phone });
          setStep('link');
        },
        onError: (e) => {
          const et = errorText(e);
          setError(et);
          if (et.code === 'DEVICE_ALREADY_EXISTS') {
            setExistingId(et.fieldErrors.find((f) => f.path === 'existingId')?.message ?? null);
          }
          if (et.code === 'PERSONAL_WA_NOTICE_REQUIRED') setStep('notice');
        },
      },
    );
  };

  const startPairing = () => {
    if (!device) return;
    setError(null);
    start.mutate(
      { method, input: { relink: needRelink, importHistory } },
      {
        onSuccess: (answer) => {
          // Seed the poll with the answer so the QR or the code shows at once.
          qc.setQueryData(KEYS.pairing(device.id), answer);
          setNeedRelink(false);
          setAttempt({ method, deadlineMs: attemptDeadlineMs(answer, Date.now()) });
        },
        onError: (e) => {
          const et = errorText(e);
          setNeedRelink(et.relinkable);
          if (et.code === 'PERSONAL_WA_NOTICE_REQUIRED') setStep('notice');
          setError(et);
        },
      },
    );
  };

  const stopAttempt = () => {
    if (device) endPairing.mutate(device.id);
    qc.removeQueries({ queryKey: KEYS.pairing(device?.id ?? '') });
    setAttempt(null);
    setCopied(false);
  };

  const tryAgain = () => {
    setAttempt(null);
    setError(null);
    setCopied(false);
    setStep('link');
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const shown = WIZARD_STEPS.indexOf(step) + 1;
  const title = existing ? tw('relinkTitle', { name: existing.name }) : tw('title');
  const linking = phase === 'linking';

  return (
    <>
      <Modal
        key={nonce}
        open
        onClose={requestClose}
        size="lg"
        title={title}
        closeLabel={t('common.close')}
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2 normal-case tracking-normal">
            <Badge tone="warning">{t('common.unofficial')}</Badge>
            <span>{tw('stepOf', { step: shown, total: WIZARD_STEPS.length })}</span>
          </span>
        }
      >
        <div className="space-y-4" data-testid="connect-wizard" data-step={step}>
          <p className="text-xs text-muted-foreground">{t('common.reminder')}</p>

          {step === 'notice' && (
            <NoticeStep
              version={version}
              acks={draft.acks}
              onAcks={(acks) => patchDraft({ acks })}
              busy={ack.isPending}
              error={error}
            />
          )}

          {step === 'number' && (
            <NumberStep
              draft={draft}
              onDraft={patchDraft}
              showProblems={showProblems}
              error={error}
              existingHref={existingId ? `/devices/${existingId}` : null}
            />
          )}

          {step === 'link' && device && (
            <div className="space-y-4">
              {!attempt ? (
                <>
                  <MethodChoice
                    phoneLabel={phoneLabel}
                    method={method}
                    onMethod={setMethod}
                    codeAllowed={canUsePairingCode(phoneRead)}
                  />
                  <HistoryChoice
                    value={importHistory}
                    onChange={setImportHistory}
                    fullAllowed={historyFullAllowed}
                  />
                  {start.isPending && <Starting label={tw('link.starting')} />}
                  {error && <ErrorNotice error={error} />}
                </>
              ) : (
                <div className="space-y-4">
                  <ProgressStrip phase={phase} />
                  {attempt.method === 'qr' ? (
                    <QrPanel
                      qr={poll.data?.qr ?? null}
                      qrAgeMs={poll.data?.qrAgeMs ?? null}
                      receivedAt={poll.receivedAt}
                      now={now}
                      deadlineMs={attempt.deadlineMs}
                      linking={linking}
                    />
                  ) : (
                    <>
                      <CodePanel
                        code={poll.data?.code ?? null}
                        codeExpiresIn={poll.data?.codeExpiresIn ?? null}
                        receivedAt={poll.receivedAt}
                        now={now}
                        linking={linking}
                        copied={copied}
                        copyFailed={copyFailed}
                        onCopy={() => poll.data?.code && void copy(poll.data.code)}
                      />
                      <Alert tone="warning">{tw('link.someoneElse')}</Alert>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'done' && outcome && (
            <ResultStep
              outcome={outcome}
              phoneLabel={phoneLabel}
              warmerHref="/warmer"
              inboxHref="/inbox"
              importHref={importHistory !== 'none' && device ? `/devices/${device.id}` : null}
            />
          )}

          {error && step === 'done' && <ErrorNotice error={error} />}

          <div className="flex flex-wrap justify-end gap-2" data-testid="wizard-footer">
            {step === 'notice' && (
              <>
                <Button variant="secondary" onClick={requestClose}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={acceptNotice}
                  disabled={!allAcknowledged(draft.acks) || ack.isPending}
                >
                  {ack.isPending && <Spinner />}
                  {ack.isPending ? t('notice.accepting') : t('notice.accept')}
                </Button>
              </>
            )}
            {step === 'number' && (
              <>
                {wasNoticeStep && (
                  <Button variant="secondary" onClick={() => setStep('notice')}>
                    {t('common.back')}
                  </Button>
                )}
                <Button variant="secondary" onClick={requestClose}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={submitNumber} disabled={create.isPending}>
                  {create.isPending && <Spinner />}
                  {create.isPending ? tw('creating') : tw('continue')}
                </Button>
              </>
            )}
            {step === 'link' && !attempt && (
              <>
                <Button variant="secondary" onClick={requestClose}>
                  {t('common.cancel')}
                </Button>
                {needRelink ? (
                  <Button onClick={startPairing} disabled={start.isPending}>
                    {t('wizard.link.relinkAction')}
                  </Button>
                ) : (
                  <Button onClick={startPairing} disabled={start.isPending}>
                    {start.isPending && <Spinner />}
                    {start.isPending
                      ? tw('link.starting')
                      : method === 'qr'
                        ? tw('link.startQr')
                        : tw('link.startCode')}
                  </Button>
                )}
              </>
            )}
            {step === 'link' && attempt && (
              <Button variant="secondary" onClick={stopAttempt}>
                {tw('link.cancelAttempt')}
              </Button>
            )}
            {step === 'done' && outcome?.kind === 'connected' && (
              <Button onClick={leave}>{tw('result.list')}</Button>
            )}
            {step === 'done' && outcome?.kind === 'failure' && (
              <>
                <Button variant="secondary" onClick={leave}>
                  {t('common.close')}
                </Button>
                <Button onClick={tryAgain}>{tw('result.tryAgain')}</Button>
              </>
            )}
          </div>
          {step === 'done' && outcome?.kind === 'failure' && (
            <p className="text-xs text-muted-foreground">
              <Link href="/help/personal-whatsapp-connect" className="underline">
                {t('common.readGuide')}
              </Link>
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmLeave}
        title={tw('discard.title')}
        message={tw('discard.message')}
        confirmLabel={tw('discard.leave')}
        cancelLabel={tw('discard.stay')}
        tone="danger"
        onConfirm={() => {
          setConfirmLeave(false);
          leave();
        }}
        onClose={() => {
          setConfirmLeave(false);
          setNonce((n) => n + 1);
        }}
      />
    </>
  );
}
