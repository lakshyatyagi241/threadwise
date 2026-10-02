'use client';

import { useTranslations } from 'next-intl';
import { Input, cn } from '@crm/ui';
import type { ComposeSender } from '@crm/contracts';
import { sharePercents } from '../lib/compose-model';

/**
 * "Send from device(s)" (WD-BCAST-006). One connected number is shown as a fixed row and always used; two or more are a tick
 * list, grouped by engine when there is more than one engine, each with a share weight and its live percentage. The share
 * weights decide how the audience is split across the ticked numbers.
 */
export function SenderPicker({
  senders,
  checked,
  shares,
  onChecked,
  onShare,
}: {
  senders: ComposeSender[];
  checked: string[];
  shares: Record<string, number>;
  onChecked: (key: string, on: boolean) => void;
  onShare: (key: string, weight: number) => void;
}) {
  const t = useTranslations('broadcasts.compose');
  const pcts = sharePercents(
    senders.map((s) => s.key),
    checked,
    shares,
  );
  const engines = [...new Set(senders.map((s) => s.engine))];
  const multiEngine = engines.length > 1;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11.5px] font-semibold">
        <span>
          {senders.length > 1 ? t('devices') : t('device')} <span className="text-danger">*</span>
        </span>
        {senders.length > 1 && (
          <span className="font-mono text-[10px] font-normal text-brand">{t('multiDevice')}</span>
        )}
      </div>
      {senders.length === 0 ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
          {t('noDevices')}
        </div>
      ) : senders.length === 1 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2">
          <span className="text-[12.5px] font-medium">{senders[0]!.label}</span>
          <span className="ms-auto font-mono text-[10.5px] text-muted-foreground">
            {senders[0]!.phone}
          </span>
        </div>
      ) : (
        <>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-background">
            {engines.map((engine) => (
              <div key={engine}>
                {multiEngine && (
                  <div className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    {senders.find((s) => s.engine === engine)?.engineLabel}
                  </div>
                )}
                {senders
                  .filter((s) => s.engine === engine)
                  .map((s) => {
                    const on = checked.includes(s.key);
                    return (
                      <label
                        key={s.key}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-[12.5px] last:border-b-0 hover:bg-muted/50',
                          on && 'bg-muted',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-[var(--brand)]"
                          checked={on}
                          onChange={(e) => onChecked(s.key, e.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{s.label}</span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {s.phone}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'flex shrink-0 items-center gap-1 transition',
                            !on && 'pointer-events-none opacity-50',
                          )}
                        >
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {t('share')}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`${t('share')} ${s.label}`}
                            disabled={!on}
                            value={shares[s.key] ?? 1}
                            onChange={(e) => onShare(s.key, e.target.valueAsNumber)}
                            className="h-7 w-14 px-2 text-end font-mono text-xs"
                          />
                          <span className="w-10 text-end font-mono text-[10px] text-brand">
                            {pcts[s.key] === null || pcts[s.key] === undefined
                              ? '—'
                              : `${pcts[s.key]}%`}
                          </span>
                        </span>
                      </label>
                    );
                  })}
              </div>
            ))}
          </div>
          <div className="mt-1 text-[10.5px] text-muted-foreground">{t('shareHint')}</div>
        </>
      )}
    </div>
  );
}
