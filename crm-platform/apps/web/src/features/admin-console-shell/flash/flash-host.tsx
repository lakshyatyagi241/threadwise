'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { cn } from '@crm/ui';
import { dismissFlash, useShellFlash, type FlashTone } from './flash-store';

/** How long the toast stays once it is on screen (WaDesk's toaster uses 3 seconds; a warning needs time to be read). */
const SHOW_MS: Record<FlashTone, number> = {
  success: 3000,
  info: 3000,
  warning: 6000,
  danger: 6000,
};

/** WaDesk's toast palette: green success, coral error, amber warning, plain info. */
const TONES: Record<FlashTone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  info: 'border-border bg-background text-foreground',
  warning: 'border-warning/40 bg-warning/15 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

/** Renders the pending flash as a toast at the bottom end of the screen; mount once inside the shell. */
export function FlashHost() {
  const t = useTranslations('admin-console-shell.flash');
  const f = useShellFlash();
  const id = f?.id;
  const tone = f?.tone;

  useEffect(() => {
    if (id === undefined || !tone) return;
    const timer = setTimeout(() => dismissFlash(id), SHOW_MS[tone]);
    return () => clearTimeout(timer);
  }, [id, tone]);

  if (!f) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex justify-center sm:inset-x-auto sm:end-6 sm:bottom-6 sm:justify-end">
      <div
        role={f.tone === 'danger' || f.tone === 'warning' ? 'alert' : 'status'}
        data-testid="shell-flash"
        data-tone={f.tone}
        className={cn(
          'pointer-events-auto flex min-w-[260px] max-w-md items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-[13px] leading-snug shadow-lg',
          TONES[f.tone],
        )}
      >
        <span className="min-w-0 flex-1 font-semibold">{t(f.key, f.values)}</span>
        <button
          type="button"
          onClick={() => dismissFlash(f.id)}
          aria-label={t('dismiss')}
          className="-me-1 px-1 text-sm leading-none opacity-50 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
