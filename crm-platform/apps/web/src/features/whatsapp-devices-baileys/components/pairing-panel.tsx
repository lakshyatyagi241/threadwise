'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useTranslations } from 'next-intl';
import { Spinner, cn } from '@crm/ui';
import {
  QR_ROTATE_MS,
  codeSecondsLeft,
  formatClock,
  progressStrip,
  qrWindow,
  secondsUntil,
  type PairingPhase,
  type StripStep,
} from '../lib/pairing-model';
import { formatPairingCode } from '../lib/phone-model';

const NS = 'whatsapp-devices-baileys.wizard.link';

/** The rotation ring beside the QR: full when a new code appears, empty when it is about to change. */
function Ring({ fraction, seconds }: { fraction: number; seconds: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-border" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        data-seconds={seconds}
      />
    </svg>
  );
}

/** Code shown, Scanned, Ready: where the link is now. */
export function ProgressStrip({ phase }: { phase: PairingPhase }) {
  const t = useTranslations(NS);
  const steps = progressStrip(phase);
  const order: StripStep[] = ['shown', 'scanned', 'ready'];
  return (
    <ol aria-label={t('stripLabel')} className="flex flex-wrap items-center gap-2 text-xs">
      {order.map((k, i) => (
        <li key={k} className="flex items-center gap-2" data-step={k} data-status={steps[k]}>
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold',
              steps[k] === 'done' && 'border-success bg-success text-white',
              steps[k] === 'current' && 'border-primary text-primary',
              steps[k] === 'todo' && 'border-border text-muted-foreground',
            )}
          >
            {steps[k] === 'done' ? '✓' : i + 1}
          </span>
          <span className={steps[k] === 'todo' ? 'text-muted-foreground' : 'font-medium'}>
            {t(`strip.${k}`)}
          </span>
          {i < order.length - 1 && <span className="h-px w-4 bg-border" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function Steps({ kind }: { kind: 'qrSteps' | 'codeSteps' }) {
  const t = useTranslations(NS);
  return (
    <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
      <li>{t(`${kind}.one`)}</li>
      <li>{t(`${kind}.two`)}</li>
      <li>{t(`${kind}.three`)}</li>
    </ol>
  );
}

/**
 * The QR the person scans (spec 13.2). Drawn client-side from the polled string; the string is never put in an attribute, a log
 * or storage. A light background in the dark theme too, so a camera can read it.
 */
export function QrPanel({
  qr,
  qrAgeMs,
  receivedAt,
  now,
  deadlineMs,
  linking,
}: {
  qr: string | null;
  qrAgeMs: number | null;
  receivedAt: number;
  now: number;
  deadlineMs: number | null;
  linking: boolean;
}) {
  const t = useTranslations(NS);
  const win = qrWindow(qrAgeMs, receivedAt, now);
  const left = secondsUntil(deadlineMs, now);
  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr]" data-testid="qr-panel">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-md border border-border bg-white p-3">
          {qr ? (
            <QRCodeSVG
              value={qr}
              size={208}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
              title={t('qrAlt')}
              className={linking ? 'opacity-30' : undefined}
            />
          ) : (
            <div className="flex size-[208px] items-center justify-center text-sm text-muted-foreground">
              <Spinner label={t('reading')} />
            </div>
          )}
        </div>
        {qr && !linking && (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="qr-ring"
          >
            <Ring fraction={win.fraction} seconds={win.seconds} />
            <span>{t('qrRefresh', { seconds: Math.min(win.seconds, QR_ROTATE_MS / 1000) })}</span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <Steps kind="qrSteps" />
        {linking ? (
          <p className="flex items-center gap-2 text-sm" role="status">
            <Spinner label={t('linking')} /> {t('linking')}
          </p>
        ) : (
          left !== null && (
            <p className="text-xs text-muted-foreground" data-testid="qr-expires">
              {t('qrExpires', { time: formatClock(left) })}
            </p>
          )
        )}
      </div>
    </div>
  );
}

/** The 8-character pairing code, with copy, the steps and the warning that this code links a whole account. */
export function CodePanel({
  code,
  codeExpiresIn,
  receivedAt,
  now,
  linking,
  copied,
  copyFailed,
  onCopy,
}: {
  code: string | null;
  codeExpiresIn: number | null;
  receivedAt: number;
  now: number;
  linking: boolean;
  copied: boolean;
  copyFailed: boolean;
  onCopy: () => void;
}) {
  const t = useTranslations(NS);
  const left = codeSecondsLeft(codeExpiresIn, receivedAt, now);
  return (
    <div className="space-y-4" data-testid="code-panel">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="rounded-md border border-border bg-muted px-4 py-3"
          aria-label={t('codeLabel')}
        >
          {code ? (
            <span dir="ltr" className="font-mono text-3xl font-semibold tracking-[0.2em]">
              {formatPairingCode(code)}
            </span>
          ) : (
            <Spinner label={t('reading')} />
          )}
        </div>
        {code && (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            {copied ? t('copied') : t('copy')}
          </button>
        )}
      </div>
      {copyFailed && (
        <p role="alert" className="text-xs text-danger">
          {t('copyFailed')}
        </p>
      )}
      <Steps kind="codeSteps" />
      <p className="text-xs text-muted-foreground">
        {left !== null ? t('codeExpires', { time: formatClock(left) }) : t('codeValid')}
      </p>
      {linking && (
        <p className="flex items-center gap-2 text-sm" role="status">
          <Spinner label={t('linking')} /> {t('linking')}
        </p>
      )}
    </div>
  );
}
