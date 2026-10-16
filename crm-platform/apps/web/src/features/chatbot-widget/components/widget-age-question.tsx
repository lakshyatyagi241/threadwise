'use client';

import { useTranslations } from 'next-intl';
import { AGE_GATE_MODES, MAX_GATE_AGE, MIN_GATE_AGE } from '@crm/contracts';
import { cn } from '@crm/ui';
import type { BuilderState } from '../lib/builder-model';
import { ToggleRow } from './toggle-row';

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand';
const CAPTION =
  'mb-1 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground';

/**
 * The optional age question of the chat's intake form (BL-218, spec docs/specs/privacy-and-data-governance.md 11.10). Off by default and
 * worded so nobody turns it on without a reason: it is for workspaces whose rules ask for it or whose visitors may be minors. The chat
 * never tells the visitor which answer passes. A chat has no second screen, so there is no guardian action.
 */
export function WidgetAgeQuestion({
  s,
  set,
}: {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
}) {
  const t = useTranslations('chatbotWidget.builder.age');
  const gate = s.ageGate;
  const change = (patch: Partial<BuilderState['ageGate']>) =>
    set({ ageGate: { ...gate, ...patch } });
  return (
    <div data-testid="widget-age-question" className="space-y-2">
      <ToggleRow
        id="wgt-f-ageGate"
        checked={gate.enabled}
        label={t('enable')}
        hint={t('enableHint')}
        onChange={(enabled) => change({ enabled })}
      />
      {gate.enabled && (
        <div className="space-y-3 ps-1">
          <div>
            <label htmlFor="wgt-f-ageMode" className={CAPTION}>
              {t('mode')}
            </label>
            <select
              id="wgt-f-ageMode"
              value={gate.mode}
              onChange={(e) =>
                change({ mode: AGE_GATE_MODES.find((m) => m === e.target.value) ?? 'declaration' })
              }
              className={INPUT}
            >
              {AGE_GATE_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`modes.${m}`)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {t(`modeHints.${gate.mode}`)}
            </p>
          </div>
          <div>
            <label htmlFor="wgt-f-ageMin" className={CAPTION}>
              {t('minAge')}
            </label>
            <input
              id="wgt-f-ageMin"
              type="number"
              min={MIN_GATE_AGE}
              max={MAX_GATE_AGE}
              value={gate.minAge ?? ''}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value));
                change({
                  minAge:
                    e.target.value === '' || !Number.isFinite(n)
                      ? null
                      : Math.min(MAX_GATE_AGE, Math.max(MIN_GATE_AGE, n)),
                });
              }}
              className={cn(INPUT, 'max-w-[120px]')}
            />
            <p className="mt-1 text-[11.5px] text-muted-foreground">{t('minAgeHint')}</p>
          </div>
          <div>
            <label htmlFor="wgt-f-ageAction" className={CAPTION}>
              {t('whenUnder')}
            </label>
            <select
              id="wgt-f-ageAction"
              value={gate.whenUnder === 'block' ? 'block' : 'flag'}
              onChange={(e) => change({ whenUnder: e.target.value === 'block' ? 'block' : 'flag' })}
              className={INPUT}
            >
              <option value="block">{t('actions.block')}</option>
              <option value="flag">{t('actions.flag')}</option>
            </select>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {t(`actionHints.${gate.whenUnder === 'block' ? 'block' : 'flag'}`)}
            </p>
          </div>
          <p className="text-[11.5px] text-muted-foreground">{t('contactNote')}</p>
        </div>
      )}
    </div>
  );
}
