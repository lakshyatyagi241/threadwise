'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCalling } from './calling-provider';
import { EndCallIcon, MicIcon, MicOffIcon, RecordIcon } from './icons';

const ROUND =
  'grid size-11 place-items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-80';

/**
 * The floating on-call panel (TW-CALL-018): who, the timer (only once audio is connected), "ringing..." while an outbound call
 * has not been answered, and Mute / End / Record. Record arms the recording and then stays on: stopping it mid-call would leave
 * a truncated file that reads as a whole one. While recording, the panel says so.
 */
export function OnCallPanel() {
  const t = useTranslations('calling-voice.panel');
  const { active, elapsed, hangup, toggleMute, record } = useCalling();
  if (!active || (active.state !== 'ringing' && active.state !== 'active')) return null;
  const ringing = active.state === 'ringing';

  return (
    <section
      aria-label={t('label')}
      className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-border bg-background p-4 shadow-lg"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('title')}
      </div>
      <div className="mt-1 truncate text-base font-semibold">{active.name}</div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
        {!ringing && (
          <span aria-label={t('timer')} className="font-mono tabular-nums">
            {elapsed}
          </span>
        )}
        <span>{ringing ? t('ringing') : t('connected')}</span>
      </div>

      <div className="mt-3 flex items-start justify-around">
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={toggleMute}
            disabled={ringing}
            aria-pressed={active.muted}
            className={cn(
              ROUND,
              active.muted
                ? 'border-danger bg-danger text-danger-foreground'
                : 'border-border bg-muted hover:bg-border',
            )}
          >
            {active.muted ? <MicOffIcon className="size-5" /> : <MicIcon className="size-5" />}
          </button>
          <span className="text-[11px] text-muted-foreground">
            {active.muted ? t('muted') : t('mute')}
          </span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => void hangup()}
            aria-label={t('end')}
            className={cn(ROUND, 'border-danger bg-danger text-danger-foreground hover:opacity-90')}
          >
            <EndCallIcon className="size-5" />
          </button>
          <span className="text-[11px] text-muted-foreground">{t('end')}</span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={record}
            disabled={ringing || active.recording}
            title={active.recording ? t('recordingTooltip') : t('recordTooltip')}
            className={cn(
              ROUND,
              active.recording
                ? 'animate-pulse border-danger bg-danger text-danger-foreground'
                : 'border-border bg-muted hover:bg-border',
            )}
          >
            <RecordIcon className="size-5" />
          </button>
          <span
            className={cn(
              'text-[11px]',
              active.recording ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {active.recording ? t('recording') : t('record')}
          </span>
        </div>
      </div>

      {active.recording && (
        <p role="status" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-danger">
          <span className="size-1.5 rounded-full bg-danger" aria-hidden="true" />
          {t('recordingNotice')}
        </p>
      )}
    </section>
  );
}
