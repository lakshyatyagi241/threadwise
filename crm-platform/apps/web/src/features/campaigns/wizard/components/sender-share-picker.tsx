'use client';

import { useTranslations } from 'next-intl';
import { Input, cn } from '@crm/ui';
import { BROADCAST_SHARE_MAX, senderSplit, type WizardSender } from '@crm/contracts';

/** What the picker needs of a number (the wizard's and the classic builder's lists both have it). */
export type SharableSender = Pick<
  WizardSender,
  'key' | 'label' | 'phone' | 'engine' | 'engineLabel'
>;

/**
 * "Send from several numbers" (Reference TW-BCAST-006, carried into the wizard's step 1). Every connected number the guided flow can
 * send from is a tick box with a share weight and the live percentage of the audience it will get; the audience is split by those
 * weights and each contact is messaged from one number only. At least one number stays ticked. A weight that is empty or 0 counts
 * as 1, exactly as the server counts it, so the percentage shown is the share that will be sent.
 */
export function SenderSharePicker({
  senders,
  keys,
  share,
  disabled,
  onChange,
}: {
  /** The numbers that can be ticked (the guided ones). */
  senders: readonly SharableSender[];
  /** The ticked numbers, in the order they were picked. The first is the primary. */
  keys: readonly string[];
  share: Readonly<Record<string, number>>;
  disabled?: boolean | undefined;
  onChange: (keys: string[], share: Record<string, number>) => void;
}) {
  const t = useTranslations('campaigns.wizard.template');
  const percents = new Map(senderSplit(100, keys, share).map((s) => [s.key, s.percent]));
  const engines = [...new Set(senders.map((s) => s.engine))];
  const multiEngine = engines.length > 1;

  const tick = (key: string, on: boolean) => {
    const next = on ? [...keys, key] : keys.filter((k) => k !== key);
    if (next.length === 0) return;
    onChange(next, { ...share });
  };
  const weigh = (key: string, value: number) => {
    const next = { ...share };
    if (Number.isFinite(value)) next[key] = Math.min(Math.max(value, 0), BROADCAST_SHARE_MAX);
    else delete next[key];
    onChange([...keys], next);
  };

  return (
    <div data-testid="sender-share-picker">
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-background">
        {engines.map((engine) => (
          <div key={engine}>
            {multiEngine && (
              <div className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {senders.find((s) => s.engine === engine)?.engineLabel}
              </div>
            )}
            {senders
              .filter((s) => s.engine === engine)
              .map((s) => {
                const on = keys.includes(s.key);
                const only = on && keys.length === 1;
                const pct = percents.get(s.key);
                return (
                  <label
                    key={s.key}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50',
                      on && 'bg-muted',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[var(--brand)]"
                      checked={on}
                      disabled={disabled || only}
                      title={only ? t('shareKeepOne') : undefined}
                      aria-label={`${s.label}${s.phone ? ` (${s.phone})` : ''}`}
                      onChange={(e) => tick(s.key, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.label}</span>
                      {s.phone && (
                        <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                          {s.phone}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1.5',
                        !on && 'pointer-events-none opacity-50',
                      )}
                    >
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('shareWeight')}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={BROADCAST_SHARE_MAX}
                        step={1}
                        aria-label={t('shareWeightLabel', { name: s.label })}
                        disabled={disabled || !on}
                        value={on ? (share[s.key] ?? 1) : ''}
                        onChange={(e) => weigh(s.key, e.target.valueAsNumber)}
                        className="h-7 w-16 px-2 text-end text-xs"
                      />
                      <span
                        data-testid={`share-percent-${s.key}`}
                        className="w-10 text-end text-xs text-brand"
                      >
                        {on && pct !== undefined ? `${pct}%` : '-'}
                      </span>
                    </span>
                  </label>
                );
              })}
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('shareHint')}</p>
    </div>
  );
}
