'use client';

import { useTranslations } from 'next-intl';
import { intakeSummary, type BuilderState } from '../lib/builder-model';
import { LauncherPreview, type PreviewDevice } from './launcher-preview';

const MODE_KEY = { ai: 'ai', whatsapp: 'whatsapp', both: 'both' } as const;

/**
 * The live preview of the four-step builder (TW-WGT-002): the shared open messenger panel, drawn from the wizard's fields
 * and repainted on every input, plus four cards for the settings a picture cannot show (engine, placement, auto-open, intake).
 */
export function BuilderPreview({
  s,
  device,
  onDevice,
  showEngine = true,
}: {
  s: BuilderState;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  /** A flow bot's widget has no engine to name: the bot answers. */
  showEngine?: boolean;
}) {
  const t = useTranslations('chatbotWidget.builder.preview');
  const engine = t(`engine.${MODE_KEY[s.mode]}`);
  const intake = intakeSummary(s);

  return (
    <LauncherPreview s={s} device={device} onDevice={onDevice}>
      <div className="grid grid-cols-2 gap-2">
        {showEngine ? <Meta label={t('metaEngine')} value={engine} /> : null}
        <Meta
          label={t('metaPlacement')}
          value={s.position === 'bottom_left' ? t('left') : t('right')}
        />
        <Meta label={t('metaAutoOpen')} value={s.autoOpen ? t('on') : t('off')} />
        <Meta label={t('metaIntake')} value={intake.length ? intake.join(' + ') : t('none')} />
      </div>
    </LauncherPreview>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/60 p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base leading-tight">{value}</div>
    </div>
  );
}
