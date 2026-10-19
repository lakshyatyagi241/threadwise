'use client';

import { useTranslations } from 'next-intl';
import { LinkButton } from './parts';
import { SettingsCard } from './settings-parts';

/** The way from Appointment settings to the booking page's look (BL-355): a screen of its own, with a live preview. */
export function AppearanceLinkCard() {
  const t = useTranslations('appointments.appearance.card');
  return (
    <SettingsCard id="appearance" title={t('title')} description={t('description')}>
      <LinkButton href="/appointments/settings/appearance" variant="brand">
        {t('open')}
      </LinkButton>
    </SettingsCard>
  );
}
