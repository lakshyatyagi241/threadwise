'use client';

import { useTranslations } from 'next-intl';
import { Button, Card } from '@crm/ui';

/** The shipped colour of every token: what the preview shows for a token left blank. Mirrors the API's palette. */
export const PALETTE_DEFAULTS: Record<string, string> = {
  'wa-deep': '#075E54',
  'wa-teal': '#128C7E',
  'wa-green': '#25D366',
  'wa-mint': '#DCF8C6',
  'wa-bubble': '#E7FFDB',
  'paper-0': '#FBFAF6',
  'paper-50': '#F5F3EC',
  'paper-100': '#EFEBE0',
  'paper-200': '#E5DFD0',
  'ink-500': '#6B807C',
  'ink-700': '#1F4540',
  'ink-900': '#0B1F1C',
  'accent-coral': '#E87A5D',
  'accent-amber': '#E5A04E',
  'accent-plum': '#5B3D8A',
  'accent-sky': '#3E7AA1',
};

/** A small mock of the dashboard that follows the draft colours, size and opacity as they change (before any save). */
export function AppearancePreview({ fields }: { fields: Record<string, string | boolean> }) {
  const t = useTranslations('platform-settings-branding-storage.appearance');
  const c = (token: string) => {
    const v = String(fields[`colors.${token}`] ?? '').trim();
    return /^#[0-9A-Fa-f]{3,8}$/.test(v) ? v : PALETTE_DEFAULTS[token]!;
  };
  const scale = Math.min(130, Math.max(80, Number(fields.fontScale) || 100));
  const opacity = Math.min(100, Math.max(55, Number(fields.uiOpacity) || 100)) / 100;
  return (
    <Card className="space-y-3" data-testid="appearance-preview">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('previewKicker')}
        </p>
        <h2 className="text-lg font-semibold leading-tight">{t('previewTitle')}</h2>
      </header>
      <div
        className="space-y-3 rounded-lg border p-3"
        style={{
          background: c('paper-0'),
          borderColor: c('paper-200'),
          color: c('ink-900'),
          fontSize: `${scale}%`,
          opacity,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: c('wa-deep'), color: '#fff' }}
          >
            {t('active')}
          </span>
          <span className="text-[10px]" style={{ color: c('ink-500') }}>
            Campaigns
          </span>
          <span className="ms-auto h-3 w-3 rounded-full" style={{ background: c('wa-green') }} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div
            className="rounded-md border p-2"
            style={{ background: c('paper-50'), borderColor: c('paper-200') }}
          >
            <p className="text-[9px]" style={{ color: c('ink-500') }}>
              Sent
            </p>
            <p className="font-semibold" style={{ color: c('ink-700') }}>
              1,284
            </p>
          </div>
          <div className="rounded-md p-2" style={{ background: c('wa-bubble') }}>
            <p className="text-[9px]" style={{ color: c('ink-500') }}>
              Replies
            </p>
            <p className="font-semibold" style={{ color: c('ink-700') }}>
              312
            </p>
          </div>
        </div>
        <div className="flex h-10 items-end gap-1">
          {['wa-deep', 'wa-teal', 'wa-green', 'wa-teal', 'accent-amber', 'accent-sky'].map(
            (k, i) => (
              <span
                key={`${k}${i}`}
                className="flex-1 rounded-sm"
                style={{ background: c(k), height: `${35 + ((i * 17) % 60)}%` }}
              />
            ),
          )}
        </div>
        <div className="flex gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: c('wa-deep'), color: '#fff' }}
          >
            {t('primary')}
          </span>
          <span
            className="rounded-full border px-2 py-0.5 text-[10px]"
            style={{ borderColor: c('paper-200'), background: c('paper-100') }}
          >
            {t('cancel')}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px]"
            style={{ background: c('wa-mint'), color: c('wa-deep') }}
          >
            {t('active')}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('previewNote')}</p>
    </Card>
  );
}

/** "Reset to defaults": clears every colour override in the draft (the person still has to save). */
export function ResetColours({ onReset, disabled }: { onReset: () => void; disabled: boolean }) {
  const t = useTranslations('platform-settings-branding-storage.appearance');
  return (
    <Card className="space-y-2">
      <p className="text-sm font-semibold">{t('resetTitle')}</p>
      <p className="text-xs text-muted-foreground">{t('resetBody')}</p>
      <Button
        type="button"
        variant="secondary"
        className="w-full text-danger"
        disabled={disabled}
        onClick={onReset}
      >
        {t('reset')}
      </Button>
    </Card>
  );
}
